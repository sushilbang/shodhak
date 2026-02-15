import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { Paper } from '../models/database.models';
import {
    PaperProvider,
    RawPaperResult,
    normalizeToInternalPaper,
    OpenAlexProvider,
    CrossrefProvider,
    SemanticScholarProvider,
    ArxivProvider,
    PubMedProvider,
} from '../providers';
import { getLimiter } from '../utils/concurrency-limiter';

type ProviderName = 'openalex' | 'semantic_scholar' | 'crossref' | 'arxiv' | 'pubmed';

class SearchService {
    private providers: Map<ProviderName, PaperProvider>;
    private primaryProvider: PaperProvider;

    constructor() {
        // Initialize all providers
        this.providers = new Map();
        this.providers.set('openalex', new OpenAlexProvider());
        this.providers.set('semantic_scholar', new SemanticScholarProvider());
        this.providers.set('crossref', new CrossrefProvider());
        this.providers.set('arxiv', new ArxivProvider());
        this.providers.set('pubmed', new PubMedProvider());

        // Select primary provider from env
        const primaryName = (process.env.PRIMARY_PAPER_PROVIDER || 'openalex') as ProviderName;

        if (!this.providers.has(primaryName)) {
            logger.warn(`Unknown PRIMARY_PAPER_PROVIDER: ${primaryName}, falling back to openalex`);
            this.primaryProvider = this.providers.get('openalex')!;
        } else {
            this.primaryProvider = this.providers.get(primaryName)!;
        }

        logger.info(`Search service initialized with primary provider: ${this.primaryProvider.name}`);
    }

    // Execute a provider operation with concurrency limiting
    private async withConcurrencyLimit<T>(
        provider: PaperProvider,
        operation: () => Promise<T>
    ): Promise<T> {
        const limiter = getLimiter(provider.name, provider.concurrencyConfig);
        return limiter.execute(operation);
    }

    // Search papers using the primary provider
    // Maintains the original contract: searchService.searchPapers(query, limit)
    async searchPapers(query: string, limit: number = 10): Promise<Paper[]> {
        try {
            logger.info('Searching papers', { query, limit, provider: this.primaryProvider.name });

            const rawResults = await this.withConcurrencyLimit(
                this.primaryProvider,
                () => this.primaryProvider.search(query, limit)
            );

            // Normalize and cache results
            const papers: Paper[] = [];
            for (const raw of rawResults) {
                const paper = normalizeToInternalPaper(raw);
                await this.savePaperIfNotExists(paper);
                papers.push(paper);
            }

            logger.info('Search completed', { resultCount: papers.length });
            return papers;
        } catch (error) {
            logger.error('Paper search failed', { error, query, provider: this.primaryProvider.name });
            throw error;
        }
    }

    // Try to enrich paper data using available providers
    // Priority: Semantic Scholar (for abstracts) -> Crossref (for metadata)
    private async tryEnrichPaper(paper: Paper): Promise<Partial<Paper> | null> {
        if (!paper.doi) return null;

        const enrichment: Partial<Paper> = {};

        // Try Semantic Scholar for abstract
        if (!paper.abstract) {
            const ssProvider = this.providers.get('semantic_scholar');
            if (ssProvider?.enrich) {
                try {
                    const ssEnrich = await this.withConcurrencyLimit(
                        ssProvider,
                        () => ssProvider.enrich!(paper)
                    );
                    if (ssEnrich?.abstract) {
                        enrichment.abstract = ssEnrich.abstract;
                    }
                    if (ssEnrich?.citationCount) {
                        enrichment.citation_count = ssEnrich.citationCount;
                    }
                } catch (err) {
                    logger.debug('Semantic Scholar enrichment failed', { doi: paper.doi });
                }
            }
        }

        // Try Crossref for missing venue/year
        if (!paper.venue || !paper.year) {
            const crProvider = this.providers.get('crossref');
            if (crProvider?.enrich) {
                try {
                    const crEnrich = await this.withConcurrencyLimit(
                        crProvider,
                        () => crProvider.enrich!(paper)
                    );
                    if (crEnrich?.venue && !paper.venue) {
                        enrichment.venue = crEnrich.venue;
                    }
                    if (crEnrich?.year && !paper.year) {
                        enrichment.year = crEnrich.year;
                    }
                } catch (err) {
                    logger.debug('Crossref enrichment failed', { doi: paper.doi });
                }
            }
        }

        return Object.keys(enrichment).length > 0 ? enrichment : null;
    }

    // Lookup a paper by DOI using available providers
    async lookupByDoi(doi: string): Promise<Paper | null> {
        // Try primary provider first
        if (this.primaryProvider.lookupByDoi) {
            try {
                const result = await this.withConcurrencyLimit(
                    this.primaryProvider,
                    () => this.primaryProvider.lookupByDoi!(doi)
                );
                if (result) {
                    const paper = normalizeToInternalPaper(result);
                    await this.savePaperIfNotExists(paper);
                    return paper;
                }
            } catch (err) {
                logger.debug('Primary provider DOI lookup failed', { doi });
            }
        }

        // Fallback to Crossref for DOI lookup
        const crProvider = this.providers.get('crossref');
        if (crProvider?.lookupByDoi) {
            try {
                const result = await this.withConcurrencyLimit(
                    crProvider,
                    () => crProvider.lookupByDoi!(doi)
                );
                if (result) {
                    const paper = normalizeToInternalPaper(result);
                    await this.savePaperIfNotExists(paper);
                    return paper;
                }
            } catch (err) {
                logger.debug('Crossref DOI lookup failed', { doi });
            }
        }

        return null;
    }

    //Save paper to database if it doesn't exist
    async savePaperIfNotExists(paper: Paper): Promise<number> {
        const existing = await pool.query(
            'SELECT id FROM papers WHERE external_id = $1',
            [paper.external_id]
        );

        if (existing.rows.length > 0) {
            return existing.rows[0].id;
        }

        const result = await pool.query(
            `INSERT INTO papers (external_id, title, authors, abstract, url, doi, year, venue, citation_count, source, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`,
            [
                paper.external_id,
                paper.title,
                JSON.stringify(paper.authors),
                paper.abstract,
                paper.url,
                paper.doi,
                paper.year,
                paper.venue,
                paper.citation_count,
                paper.source,
                JSON.stringify(paper.metadata || {}),
            ]
        );

        logger.info('Saved new paper', {
            id: result.rows[0].id,
            title: paper.title,
            source: paper.source,
        });

        return result.rows[0].id;
    }

    // Get the current primary provider name
    getPrimaryProviderName(): string {
        return this.primaryProvider.name;
    }
}

export const searchService = new SearchService();
