"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchService = void 0;
const database_1 = require("../config/database");
const logger_1 = require("../utils/logger");
const providers_1 = require("../providers");
const concurrency_limiter_1 = require("../utils/concurrency-limiter");
/**
 * SearchService orchestrates multiple paper providers.
 *
 * - Uses PRIMARY_PAPER_PROVIDER env var to select the main search backend (default: openalex)
 * - Semantic Scholar can be used for enrichment (adds abstracts/citations when missing)
 * - Crossref is used as DOI-based fallback for missing metadata
 * - All results are cached in the database with the normalized Paper shape
 */
class SearchService {
    constructor() {
        // Initialize all providers
        this.providers = new Map();
        this.providers.set('openalex', new providers_1.OpenAlexProvider());
        this.providers.set('semantic_scholar', new providers_1.SemanticScholarProvider());
        this.providers.set('crossref', new providers_1.CrossrefProvider());
        // Select primary provider from env
        const primaryName = (process.env.PRIMARY_PAPER_PROVIDER || 'openalex');
        if (!this.providers.has(primaryName)) {
            logger_1.logger.warn(`Unknown PRIMARY_PAPER_PROVIDER: ${primaryName}, falling back to openalex`);
            this.primaryProvider = this.providers.get('openalex');
        }
        else {
            this.primaryProvider = this.providers.get(primaryName);
        }
        logger_1.logger.info(`Search service initialized with primary provider: ${this.primaryProvider.name}`);
    }
    /**
     * Execute a provider operation with concurrency limiting
     */
    async withConcurrencyLimit(provider, operation) {
        const limiter = (0, concurrency_limiter_1.getLimiter)(provider.name, provider.concurrencyConfig);
        return limiter.execute(operation);
    }
    /**
     * Search papers using the primary provider
     * Maintains the original contract: searchService.searchPapers(query, limit)
     */
    async searchPapers(query, limit = 10) {
        try {
            logger_1.logger.info('Searching papers', { query, limit, provider: this.primaryProvider.name });
            const rawResults = await this.withConcurrencyLimit(this.primaryProvider, () => this.primaryProvider.search(query, limit));
            // Normalize and cache results
            const papers = [];
            for (const raw of rawResults) {
                const paper = (0, providers_1.normalizeToInternalPaper)(raw);
                await this.savePaperIfNotExists(paper);
                papers.push(paper);
            }
            logger_1.logger.info('Search completed', { resultCount: papers.length });
            return papers;
        }
        catch (error) {
            logger_1.logger.error('Paper search failed', { error, query, provider: this.primaryProvider.name });
            throw error;
        }
    }
    /**
     * Try to enrich paper data using available providers
     * Priority: Semantic Scholar (for abstracts) -> Crossref (for metadata)
     */
    async tryEnrichPaper(paper) {
        if (!paper.doi)
            return null;
        const enrichment = {};
        // Try Semantic Scholar for abstract
        if (!paper.abstract) {
            const ssProvider = this.providers.get('semantic_scholar');
            if (ssProvider?.enrich) {
                try {
                    const ssEnrich = await this.withConcurrencyLimit(ssProvider, () => ssProvider.enrich(paper));
                    if (ssEnrich?.abstract) {
                        enrichment.abstract = ssEnrich.abstract;
                    }
                    if (ssEnrich?.citationCount) {
                        enrichment.citation_count = ssEnrich.citationCount;
                    }
                }
                catch (err) {
                    logger_1.logger.debug('Semantic Scholar enrichment failed', { doi: paper.doi });
                }
            }
        }
        // Try Crossref for missing venue/year
        if (!paper.venue || !paper.year) {
            const crProvider = this.providers.get('crossref');
            if (crProvider?.enrich) {
                try {
                    const crEnrich = await this.withConcurrencyLimit(crProvider, () => crProvider.enrich(paper));
                    if (crEnrich?.venue && !paper.venue) {
                        enrichment.venue = crEnrich.venue;
                    }
                    if (crEnrich?.year && !paper.year) {
                        enrichment.year = crEnrich.year;
                    }
                }
                catch (err) {
                    logger_1.logger.debug('Crossref enrichment failed', { doi: paper.doi });
                }
            }
        }
        return Object.keys(enrichment).length > 0 ? enrichment : null;
    }
    /**
     * Lookup a paper by DOI using available providers
     */
    async lookupByDoi(doi) {
        // Try primary provider first
        if (this.primaryProvider.lookupByDoi) {
            try {
                const result = await this.withConcurrencyLimit(this.primaryProvider, () => this.primaryProvider.lookupByDoi(doi));
                if (result) {
                    const paper = (0, providers_1.normalizeToInternalPaper)(result);
                    await this.savePaperIfNotExists(paper);
                    return paper;
                }
            }
            catch (err) {
                logger_1.logger.debug('Primary provider DOI lookup failed', { doi });
            }
        }
        // Fallback to Crossref for DOI lookup
        const crProvider = this.providers.get('crossref');
        if (crProvider?.lookupByDoi) {
            try {
                const result = await this.withConcurrencyLimit(crProvider, () => crProvider.lookupByDoi(doi));
                if (result) {
                    const paper = (0, providers_1.normalizeToInternalPaper)(result);
                    await this.savePaperIfNotExists(paper);
                    return paper;
                }
            }
            catch (err) {
                logger_1.logger.debug('Crossref DOI lookup failed', { doi });
            }
        }
        return null;
    }
    /**
     * Get paper details by external ID (provider-specific ID)
     * For backwards compatibility with Semantic Scholar paper IDs
     */
    async getPaperDetails(paperId) {
        const ssProvider = this.providers.get('semantic_scholar');
        try {
            const result = await this.withConcurrencyLimit(ssProvider, () => ssProvider.getPaperById(paperId));
            if (result) {
                const paper = (0, providers_1.normalizeToInternalPaper)(result);
                await this.savePaperIfNotExists(paper);
                return paper;
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to get paper details', { error, paperId });
        }
        return null;
    }
    /**
     * Save paper to database if it doesn't exist
     */
    async savePaperIfNotExists(paper) {
        const existing = await database_1.pool.query('SELECT id FROM papers WHERE external_id = $1', [paper.external_id]);
        if (existing.rows.length > 0) {
            return existing.rows[0].id;
        }
        const result = await database_1.pool.query(`INSERT INTO papers (external_id, title, authors, abstract, url, doi, year, venue, citation_count, source, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`, [
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
        ]);
        logger_1.logger.info('Saved new paper', {
            id: result.rows[0].id,
            title: paper.title,
            source: paper.source,
        });
        return result.rows[0].id;
    }
    /**
     * Get paper from database by external ID
     */
    async getPaperByExternalId(external_id) {
        const result = await database_1.pool.query('SELECT * FROM papers WHERE external_id = $1', [external_id]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            id: row.id,
            external_id: row.external_id,
            title: row.title,
            authors: row.authors,
            abstract: row.abstract,
            url: row.url,
            doi: row.doi,
            year: row.year,
            venue: row.venue,
            citation_count: row.citation_count,
            source: row.source,
            metadata: row.metadata,
            created_at: row.created_at,
        };
    }
    /**
     * Get the current primary provider name
     */
    getPrimaryProviderName() {
        return this.primaryProvider.name;
    }
}
exports.searchService = new SearchService();
