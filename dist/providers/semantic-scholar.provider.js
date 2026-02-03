"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticScholarProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class SemanticScholarProvider {
    constructor() {
        this.name = 'semantic_scholar';
        this.capabilities = {
            search: true,
            lookupByDoi: true,
            enrichment: true,
        };
        this.BASE_URL = 'https://api.semanticscholar.org/graph/v1';
        this.FIELDS = 'paperId,title,authors,abstract,url,doi,year,venue,citationCount';
        this.MAX_RETRIES = 3;
        this.BASE_DELAY_MS = 2000;
        const headers = {
            'Content-Type': 'application/json',
        };
        const apiKey = process.env.SEMANTICSCHOLAR_API_KEY || process.env.SEMANTIC_SCHOLAR_API_KEY;
        if (apiKey) {
            headers['x-api-key'] = apiKey;
            logger_1.logger.info('Semantic Scholar API key configured');
            // Basic API key tier: 1 req/sec
            this.concurrencyConfig = {
                maxConcurrent: 1,
                requestsPerSecond: 1,
            };
        }
        else {
            logger_1.logger.warn('No Semantic Scholar API key found - using public rate limits');
            this.concurrencyConfig = {
                maxConcurrent: 1,
                requestsPerSecond: 0.5,
            };
        }
        this.client = axios_1.default.create({
            baseURL: this.BASE_URL,
            timeout: 10000,
            headers,
        });
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async withRetry(operation, context) {
        let lastError = null;
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                const axiosError = error;
                if (axiosError.response?.status === 429 ||
                    (axiosError.response?.status && axiosError.response.status >= 500)) {
                    const delay = this.BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    logger_1.logger.warn(`${context} failed (attempt ${attempt}/${this.MAX_RETRIES}), retrying in ${delay}ms`, {
                        status: axiosError.response?.status,
                    });
                    await this.sleep(delay);
                }
                else {
                    throw error;
                }
            }
        }
        throw lastError;
    }
    normalizePaper(ssPaper) {
        return {
            id: ssPaper.paperId,
            title: ssPaper.title,
            authors: ssPaper.authors.map(a => ({
                name: a.name,
                id: a.authorId,
            })),
            abstract: ssPaper.abstract || undefined,
            url: ssPaper.url,
            doi: ssPaper.doi,
            year: ssPaper.year,
            venue: ssPaper.venue,
            citationCount: ssPaper.citationCount,
            source: 'semantic_scholar',
        };
    }
    async search(query, limit) {
        const response = await this.withRetry(() => this.client.get('paper/search', {
            params: {
                query,
                limit: Math.min(limit, 100),
                fields: this.FIELDS,
            },
        }), 'Semantic Scholar search');
        logger_1.logger.debug('Semantic Scholar search completed', {
            query,
            resultCount: response.data.data.length,
            totalCount: response.data.total,
        });
        return response.data.data.map(p => this.normalizePaper(p));
    }
    async lookupByDoi(doi) {
        try {
            const cleanDoi = doi.replace('https://doi.org/', '');
            const response = await this.withRetry(() => this.client.get(`/paper/DOI:${cleanDoi}`, {
                params: { fields: this.FIELDS },
            }), 'Semantic Scholar DOI lookup');
            return this.normalizePaper(response.data);
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }
    async getPaperById(paperId) {
        try {
            const response = await this.withRetry(() => this.client.get(`/paper/${paperId}`, {
                params: { fields: this.FIELDS },
            }), 'Get paper details');
            return this.normalizePaper(response.data);
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response?.status === 404) {
                return null;
            }
            logger_1.logger.error('Failed to get paper details', {
                error, paperId,
            });
            return null;
        }
    }
    async enrich(paper) {
        if (!paper.doi) {
            return null;
        }
        try {
            const result = await this.lookupByDoi(paper.doi);
            if (!result)
                return null;
            const enrichment = {};
            if (!paper.abstract && result.abstract) {
                enrichment.abstract = result.abstract;
            }
            if (!paper.citation_count && result.citationCount) {
                enrichment.citationCount = result.citationCount;
            }
            return Object.keys(enrichment).length > 0 ? enrichment : null;
        }
        catch {
            return null;
        }
    }
}
exports.SemanticScholarProvider = SemanticScholarProvider;
