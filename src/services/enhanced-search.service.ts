/**
 * Enhanced Search Service
 *
 * Combines query expansion, multi-query search, and re-ranking
 * for improved search quality.
 */

import { searchService } from './search.service';
import { queryExpansionService } from './query-expansion.service';
import { rerankingService, RankedPaper } from './reranking.service';
import { Paper } from '../models/database.models';
import { logger } from '../utils/logger';
import {
    OpenAlexProvider,
    SemanticScholarProvider,
    normalizeToInternalPaper,
} from '../providers';
import { getLimiter } from '../utils/concurrency-limiter';

interface EnhancedSearchOptions {
    limit?: number;
    useExpansion?: boolean;
    useReranking?: boolean;
    parallelQueries?: number;
    deduplicateByDoi?: boolean;
    multiProvider?: boolean;
}

interface EnhancedSearchResult {
    papers: Paper[];
    rankedPapers?: RankedPaper[];
    metadata: {
        originalQuery: string;
        expandedQuery?: string;
        queryVariants?: string[];
        totalFound: number;
        deduplicated: number;
        reranked: boolean;
        latencyMs: number;
    };
}

const DEFAULT_OPTIONS: EnhancedSearchOptions = {
    limit: 20,
    useExpansion: true,
    useReranking: true,
    parallelQueries: 3,
    deduplicateByDoi: true,
    multiProvider: true,
};

class EnhancedSearchService {
    private openalexProvider: OpenAlexProvider;
    private semanticScholarProvider: SemanticScholarProvider;

    constructor() {
        this.openalexProvider = new OpenAlexProvider();
        this.semanticScholarProvider = new SemanticScholarProvider();
    }

    /**
     * Search with query expansion and re-ranking
     */
    async search(
        query: string,
        options: EnhancedSearchOptions = {}
    ): Promise<EnhancedSearchResult> {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const startTime = Date.now();

        logger.info('Enhanced search started', { query, options: opts });

        let expandedQuery: string | undefined;
        let queryVariants: string[] | undefined;
        let allPapers: Paper[] = [];

        try {
            // Step 1: Query Expansion
            if (opts.useExpansion) {
                const expansion = await queryExpansionService.expandQuery(query);
                expandedQuery = expansion.expanded;

                // Generate variants for parallel search
                queryVariants = await queryExpansionService.generateQueryVariants(
                    query,
                    opts.parallelQueries
                );

                logger.debug('Query expanded', {
                    original: query,
                    expanded: expandedQuery,
                    variants: queryVariants
                });
            } else {
                queryVariants = [query];
            }

            // Step 2: Parallel Search with Variants across multiple providers
            if (opts.multiProvider) {
                const searchPromises: Promise<Paper[]>[] = [];

                for (const variant of queryVariants) {
                    // OpenAlex
                    searchPromises.push(
                        this.searchProvider(this.openalexProvider, variant, opts.limit!)
                    );
                    // Semantic Scholar
                    searchPromises.push(
                        this.searchProvider(this.semanticScholarProvider, variant, opts.limit!)
                    );
                }

                const searchResults = await Promise.all(searchPromises);
                allPapers = searchResults.flat();
            } else {
                const searchPromises = queryVariants.map(variant =>
                    searchService.searchPapers(variant, opts.limit!)
                        .catch(err => {
                            logger.warn('Variant search failed', { variant, error: err.message });
                            return [] as Paper[];
                        })
                );

                const searchResults = await Promise.all(searchPromises);
                allPapers = searchResults.flat();
            }

            // Step 3: Deduplication
            const beforeDedup = allPapers.length;
            if (opts.deduplicateByDoi) {
                allPapers = this.deduplicatePapers(allPapers);
            }
            const afterDedup = allPapers.length;

            logger.debug('Papers deduplicated', {
                before: beforeDedup,
                after: afterDedup,
                removed: beforeDedup - afterDedup
            });

            // Step 4: Re-ranking
            let rankedPapers: RankedPaper[] | undefined;
            if (opts.useReranking && allPapers.length > 0) {
                rankedPapers = await rerankingService.rerankPapers(query, allPapers);
                allPapers = rankedPapers.map(rp => rp.paper);
            }

            // Limit results
            allPapers = allPapers.slice(0, opts.limit);
            if (rankedPapers) {
                rankedPapers = rankedPapers.slice(0, opts.limit);
            }

            const latencyMs = Date.now() - startTime;

            logger.info('Enhanced search completed', {
                query,
                resultsCount: allPapers.length,
                latencyMs
            });

            return {
                papers: allPapers,
                rankedPapers,
                metadata: {
                    originalQuery: query,
                    expandedQuery,
                    queryVariants,
                    totalFound: beforeDedup,
                    deduplicated: beforeDedup - afterDedup,
                    reranked: opts.useReranking!,
                    latencyMs
                }
            };

        } catch (error) {
            logger.error('Enhanced search failed', { error, query });

            // Fallback to basic search
            const papers = await searchService.searchPapers(query, opts.limit);

            return {
                papers,
                metadata: {
                    originalQuery: query,
                    totalFound: papers.length,
                    deduplicated: 0,
                    reranked: false,
                    latencyMs: Date.now() - startTime
                }
            };
        }
    }

    /**
     * Search a single provider, normalize results, and save to DB
     */
    private async searchProvider(
        provider: OpenAlexProvider | SemanticScholarProvider,
        query: string,
        limit: number
    ): Promise<Paper[]> {
        try {
            // Semantic Scholar is strict about query format — clean it up
            let cleanQuery = query;
            if (provider.name === 'semantic_scholar') {
                cleanQuery = query
                    .replace(/[^\w\s-]/g, ' ')  // strip special chars
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 200);  // S2 has query length limits
            }

            const limiter = getLimiter(provider.name, provider.concurrencyConfig);
            const rawResults = await limiter.execute(() => provider.search(cleanQuery, limit));

            const papers: Paper[] = [];
            for (const raw of rawResults) {
                const paper = normalizeToInternalPaper(raw);
                const id = await searchService.savePaperIfNotExists(paper);
                paper.id = id;
                papers.push(paper);
            }

            logger.debug('Provider search completed', {
                provider: provider.name,
                query,
                results: papers.length,
            });

            return papers;
        } catch (err: any) {
            logger.warn('Provider search failed', {
                provider: provider.name,
                query,
                error: err.message,
            });
            return [];
        }
    }

    /**
     * Compare basic vs enhanced search for benchmarking
     */
    async compareSearch(
        query: string,
        limit: number = 10
    ): Promise<{
        basic: { papers: Paper[]; latencyMs: number };
        enhanced: EnhancedSearchResult;
        comparison: {
            overlapCount: number;
            overlapPercent: number;
            uniqueToEnhanced: number;
            rankChanges: number;
        };
    }> {
        // Basic search
        const basicStart = Date.now();
        const basicPapers = await searchService.searchPapers(query, limit);
        const basicLatency = Date.now() - basicStart;

        // Enhanced search
        const enhanced = await this.search(query, { limit });

        // Compare results
        const basicDois = new Set(basicPapers.map(p => p.doi).filter(Boolean));
        const enhancedDois = new Set(enhanced.papers.map(p => p.doi).filter(Boolean));

        const overlap = [...basicDois].filter(doi => enhancedDois.has(doi));
        const uniqueToEnhanced = [...enhancedDois].filter(doi => !basicDois.has(doi));

        // Count rank changes
        let rankChanges = 0;
        for (let i = 0; i < Math.min(basicPapers.length, enhanced.papers.length); i++) {
            if (basicPapers[i]?.doi !== enhanced.papers[i]?.doi) {
                rankChanges++;
            }
        }

        return {
            basic: {
                papers: basicPapers,
                latencyMs: basicLatency
            },
            enhanced,
            comparison: {
                overlapCount: overlap.length,
                overlapPercent: basicDois.size > 0 ? (overlap.length / basicDois.size) * 100 : 0,
                uniqueToEnhanced: uniqueToEnhanced.length,
                rankChanges
            }
        };
    }

    /**
     * Deduplicate papers by DOI or title similarity
     */
    private deduplicatePapers(papers: Paper[]): Paper[] {
        const seen = new Map<string, Paper>();

        for (const paper of papers) {
            // Use DOI as primary key, fall back to normalized title
            const key = paper.doi?.toLowerCase() ||
                this.normalizeTitle(paper.title);

            if (!seen.has(key)) {
                seen.set(key, paper);
            } else {
                // Keep the one with more metadata
                const existing = seen.get(key)!;
                if (this.hasMoreMetadata(paper, existing)) {
                    seen.set(key, paper);
                }
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Normalize title for comparison
     */
    private normalizeTitle(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Check if paper a has more metadata than paper b
     */
    private hasMoreMetadata(a: Paper, b: Paper): boolean {
        let scoreA = 0;
        let scoreB = 0;

        if (a.abstract) scoreA++;
        if (b.abstract) scoreB++;
        if (a.doi) scoreA++;
        if (b.doi) scoreB++;
        if (a.citation_count) scoreA++;
        if (b.citation_count) scoreB++;
        if (a.venue) scoreA++;
        if (b.venue) scoreB++;

        return scoreA > scoreB;
    }
}

export const enhancedSearchService = new EnhancedSearchService();
