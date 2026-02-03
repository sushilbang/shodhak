"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrossrefProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class CrossrefProvider {
    constructor() {
        this.name = 'crossref';
        this.capabilities = {
            search: true,
            lookupByDoi: true,
            enrichment: true,
        };
        this.concurrencyConfig = {
            maxConcurrent: 3,
            requestsPerSecond: 5,
        };
        this.BASE_URL = 'https://api.crossref.org';
        const email = process.env.OPENALEX_EMAIL;
        const headers = {
            'User-Agent': `Shodhak/1.0 (${email || 'https://github.com/shodhak'})`,
        };
        this.client = axios_1.default.create({
            baseURL: this.BASE_URL,
            timeout: 15000,
            headers,
            params: email ? { mailto: email } : {},
        });
    }
    extractYear(work) {
        const published = work['published-print'] || work['published-online'];
        if (published?.['date-parts']?.[0]?.[0]) {
            return published['date-parts'][0][0];
        }
        return undefined;
    }
    normalizeAuthor(author) {
        let name;
        if (author.name) {
            name = author.name;
        }
        else if (author.given && author.family) {
            name = `${author.given} ${author.family}`;
        }
        else {
            name = author.family || author.given || 'Unknown';
        }
        return {
            name,
            id: author.ORCID?.replace('http://orcid.org/', ''),
        };
    }
    normalizeWork(work) {
        const title = work.title?.[0] || 'Untitled';
        const authors = (work.author || []).map(a => this.normalizeAuthor(a));
        let url = work.URL;
        if (!url && work.link?.length) {
            const pdfLink = work.link.find(l => l['content-type'] === 'application/pdf');
            url = pdfLink?.URL || work.link[0].URL;
        }
        return {
            id: work.DOI,
            title,
            authors,
            abstract: work.abstract ? this.cleanAbstract(work.abstract) : undefined,
            url: url || `https://doi.org/${work.DOI}`,
            doi: work.DOI,
            year: this.extractYear(work),
            venue: work['container-title']?.[0],
            citationCount: work['is-referenced-by-count'],
            source: 'crossref',
        };
    }
    cleanAbstract(abstract) {
        return abstract
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async search(query, limit) {
        try {
            const response = await this.client.get('/works', {
                params: {
                    query,
                    rows: Math.min(limit, 100), // Crossref max is 1000 but keep it reasonable
                    sort: 'relevance',
                    order: 'desc',
                },
            });
            logger_1.logger.debug('Crossref search completed', {
                query,
                resultCount: response.data.message.items.length,
                totalCount: response.data.message['total-results'],
            });
            return response.data.message.items.map(work => this.normalizeWork(work));
        }
        catch (error) {
            const axiosError = error;
            logger_1.logger.error('Crossref search failed', {
                query,
                status: axiosError.response?.status,
                message: axiosError.message,
            });
            throw error;
        }
    }
    async lookupByDoi(doi) {
        try {
            const cleanDoi = doi.replace('https://doi.org/', '');
            const response = await this.client.get(`/works/${encodeURIComponent(cleanDoi)}`);
            return this.normalizeWork(response.data.message);
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response?.status === 404) {
                return null;
            }
            logger_1.logger.error('Crossref DOI lookup failed', {
                doi,
                status: axiosError.response?.status,
            });
            throw error;
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
            if (!paper.year && result.year) {
                enrichment.year = result.year;
            }
            if (!paper.venue && result.venue) {
                enrichment.venue = result.venue;
            }
            if (!paper.citation_count && result.citationCount) {
                enrichment.citationCount = result.citationCount;
            }
            if (!paper.abstract && result.abstract) {
                enrichment.abstract = result.abstract;
            }
            return Object.keys(enrichment).length > 0 ? enrichment : null;
        }
        catch {
            return null;
        }
    }
}
exports.CrossrefProvider = CrossrefProvider;
