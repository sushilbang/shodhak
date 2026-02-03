"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAlexProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
/*
Reconstruct abstract from OpenAlex inverted index format
*/
function reconstructAbstract(invertedIndex) {
    if (!invertedIndex)
        return '';
    const words = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
        for (const pos of positions) {
            words.push([word, pos]);
        }
    }
    words.sort((a, b) => a[1] - b[1]);
    return words.map(w => w[0]).join(' ');
}
class OpenAlexProvider {
    constructor() {
        this.name = 'openalex';
        this.capabilities = {
            search: true,
            lookupByDoi: true,
            enrichment: false,
        };
        this.concurrencyConfig = {
            maxConcurrent: 5,
            requestsPerSecond: 10,
        };
        this.BASE_URL = 'https://api.openalex.org';
        const email = process.env.OPENALEX_EMAIL;
        const params = {};
        if (email) {
            params.mailto = email;
            logger_1.logger.info('OpenAlex configured with polite pool email');
        }
        else {
            logger_1.logger.warn('No OPENALEX_EMAIL configured - using lower rate limits');
            this.concurrencyConfig.requestsPerSecond = 1;
        }
        this.client = axios_1.default.create({
            baseURL: this.BASE_URL,
            timeout: 15000,
            params,
        });
    }
    normalizeWork(work) {
        const oaId = work.id?.replace('https://openalex.org/', '') || `unknown-${Date.now()}`;
        let doi = work.doi;
        if (doi?.startsWith('https://doi.org/')) {
            doi = doi.replace('https://doi.org/', '');
        }
        return {
            id: oaId,
            title: work.title || 'Untitled',
            authors: (work.authorships || [])
                .filter(a => a?.author?.display_name)
                .map(a => ({
                name: a.author.display_name,
                id: a.author.id?.replace('https://openalex.org/', '') || '',
            })),
            abstract: reconstructAbstract(work.abstract_inverted_index),
            url: work.primary_location?.landing_page_url ||
                work.open_access?.oa_url ||
                `https://openalex.org/${oaId}`,
            doi,
            year: work.publication_year,
            venue: work.primary_location?.source?.display_name,
            citationCount: work.cited_by_count,
            source: 'openalex',
            metadata: {
                openAccessUrl: work.open_access?.oa_url,
            },
        };
    }
    async search(query, limit) {
        try {
            const response = await this.client.get('/works', {
                params: {
                    search: query,
                    per_page: Math.min(limit, 200),
                    filter: 'has_abstract:true',
                    sort: 'relevance_score:desc',
                },
            });
            logger_1.logger.debug('OpenAlex search completed', {
                query,
                resultCount: response.data.results.length,
                totalCount: response.data.meta.count,
            });
            return response.data.results
                .filter(work => work && work.title)
                .map(work => this.normalizeWork(work));
        }
        catch (error) {
            const axiosError = error;
            logger_1.logger.error('OpenAlex search failed', {
                query,
                status: axiosError.response?.status,
                message: axiosError.message,
            });
            throw error;
        }
    }
    async lookupByDoi(doi) {
        try {
            // Normalize DOI format
            const cleanDoi = doi.replace('https://doi.org/', '');
            const response = await this.client.get(`/works/https://doi.org/${cleanDoi}`);
            return this.normalizeWork(response.data);
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response?.status === 404) {
                return null;
            }
            logger_1.logger.error('OpenAlex DOI lookup failed', {
                doi,
                status: axiosError.response?.status,
            });
            throw error;
        }
    }
}
exports.OpenAlexProvider = OpenAlexProvider;
