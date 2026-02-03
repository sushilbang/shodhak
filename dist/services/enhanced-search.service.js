"use strict";
/**
 * Enhanced Search Service
 *
 * Combines query expansion, multi-query search, and re-ranking
 * for improved search quality.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.enhancedSearchService = void 0;
const search_service_1 = require("./search.service");
const query_expansion_service_1 = require("./query-expansion.service");
const reranking_service_1 = require("./reranking.service");
const logger_1 = require("../utils/logger");
const DEFAULT_OPTIONS = {
    limit: 20,
    useExpansion: true,
    useReranking: true,
    parallelQueries: 3,
    deduplicateByDoi: true
};
class EnhancedSearchService {
    /**
     * Search with query expansion and re-ranking
     */
    async search(query, options = {}) {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const startTime = Date.now();
        logger_1.logger.info('Enhanced search started', { query, options: opts });
        let expandedQuery;
        let queryVariants;
        let allPapers = [];
        try {
            // Step 1: Query Expansion
            if (opts.useExpansion) {
                const expansion = await query_expansion_service_1.queryExpansionService.expandQuery(query);
                expandedQuery = expansion.expanded;
                // Generate variants for parallel search
                queryVariants = await query_expansion_service_1.queryExpansionService.generateQueryVariants(query, opts.parallelQueries);
                logger_1.logger.debug('Query expanded', {
                    original: query,
                    expanded: expandedQuery,
                    variants: queryVariants
                });
            }
            else {
                queryVariants = [query];
            }
            // Step 2: Parallel Search with Variants
            const searchPromises = queryVariants.map(variant => search_service_1.searchService.searchPapers(variant, opts.limit)
                .catch(err => {
                logger_1.logger.warn('Variant search failed', { variant, error: err.message });
                return [];
            }));
            const searchResults = await Promise.all(searchPromises);
            allPapers = searchResults.flat();
            // Step 3: Deduplication
            const beforeDedup = allPapers.length;
            if (opts.deduplicateByDoi) {
                allPapers = this.deduplicatePapers(allPapers);
            }
            const afterDedup = allPapers.length;
            logger_1.logger.debug('Papers deduplicated', {
                before: beforeDedup,
                after: afterDedup,
                removed: beforeDedup - afterDedup
            });
            // Step 4: Re-ranking
            let rankedPapers;
            if (opts.useReranking && allPapers.length > 0) {
                rankedPapers = await reranking_service_1.rerankingService.rerankPapers(query, allPapers);
                allPapers = rankedPapers.map(rp => rp.paper);
            }
            // Limit results
            allPapers = allPapers.slice(0, opts.limit);
            if (rankedPapers) {
                rankedPapers = rankedPapers.slice(0, opts.limit);
            }
            const latencyMs = Date.now() - startTime;
            logger_1.logger.info('Enhanced search completed', {
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
                    reranked: opts.useReranking,
                    latencyMs
                }
            };
        }
        catch (error) {
            logger_1.logger.error('Enhanced search failed', { error, query });
            // Fallback to basic search
            const papers = await search_service_1.searchService.searchPapers(query, opts.limit);
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
     * Compare basic vs enhanced search for benchmarking
     */
    async compareSearch(query, limit = 10) {
        // Basic search
        const basicStart = Date.now();
        const basicPapers = await search_service_1.searchService.searchPapers(query, limit);
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
    deduplicatePapers(papers) {
        const seen = new Map();
        for (const paper of papers) {
            // Use DOI as primary key, fall back to normalized title
            const key = paper.doi?.toLowerCase() ||
                this.normalizeTitle(paper.title);
            if (!seen.has(key)) {
                seen.set(key, paper);
            }
            else {
                // Keep the one with more metadata
                const existing = seen.get(key);
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
    normalizeTitle(title) {
        return title
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    /**
     * Check if paper a has more metadata than paper b
     */
    hasMoreMetadata(a, b) {
        let scoreA = 0;
        let scoreB = 0;
        if (a.abstract)
            scoreA++;
        if (b.abstract)
            scoreB++;
        if (a.doi)
            scoreA++;
        if (b.doi)
            scoreB++;
        if (a.citation_count)
            scoreA++;
        if (b.citation_count)
            scoreB++;
        if (a.venue)
            scoreA++;
        if (b.venue)
            scoreB++;
        return scoreA > scoreB;
    }
}
exports.enhancedSearchService = new EnhancedSearchService();
