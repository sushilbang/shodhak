import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger';
import {
    PaperProvider,
    RawPaperResult,
    ProviderCapabilities,
    ConcurrencyConfig,
} from './paper-provider.interface';
import { Paper } from '../models/database.models';

interface CrossrefAuthor {
    given?: string;
    family?: string;
    name?: string;
    ORCID?: string;
}

interface CrossrefWork {
    DOI: string;
    title?: string[];
    author?: CrossrefAuthor[];
    abstract?: string;
    URL?: string;
    'published-print'?: { 'date-parts': number[][] };
    'published-online'?: { 'date-parts': number[][] };
    'container-title'?: string[];
    'is-referenced-by-count'?: number;
    link?: { URL: string; 'content-type': string }[];
}

interface CrossrefSearchResponse {
    status: string;
    message: {
        items: CrossrefWork[];
        'total-results': number;
    };
}

interface CrossrefWorkResponse {
    status: string;
    message: CrossrefWork;
}

export class CrossrefProvider implements PaperProvider {
    readonly name = 'crossref';
    readonly capabilities: ProviderCapabilities = {
        search: true,
        lookupByDoi: true,
        enrichment: true,
    };
    readonly concurrencyConfig: ConcurrencyConfig = {
        maxConcurrent: 3,
        requestsPerSecond: 5,
    };

    private client: AxiosInstance;
    private readonly BASE_URL = 'https://api.crossref.org';

    constructor() {
        const email = process.env.OPENALEX_EMAIL;
        const headers: Record<string, string> = {
            'User-Agent': `Shodhak/1.0 (${email || 'https://github.com/shodhak'})`,
        };

        this.client = axios.create({
            baseURL: this.BASE_URL,
            timeout: 15000,
            headers,
            params: email ? { mailto: email } : {},
        });
    }

    private extractYear(work: CrossrefWork): number | undefined {
        const published = work['published-print'] || work['published-online'];
        if (published?.['date-parts']?.[0]?.[0]) {
            return published['date-parts'][0][0];
        }
        return undefined;
    }

    private normalizeAuthor(author: CrossrefAuthor): { name: string; id?: string } {
        let name: string;
        if (author.name) {
            name = author.name;
        } else if (author.given && author.family) {
            name = `${author.given} ${author.family}`;
        } else {
            name = author.family || author.given || 'Unknown';
        }

        return {
            name,
            id: author.ORCID?.replace('http://orcid.org/', ''),
        };
    }

    private normalizeWork(work: CrossrefWork): RawPaperResult {
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

    private cleanAbstract(abstract: string): string {
        return abstract
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async search(query: string, limit: number): Promise<RawPaperResult[]> {
        try {
            const response = await this.client.get<CrossrefSearchResponse>('/works', {
                params: {
                    query,
                    rows: Math.min(limit, 100), // Crossref max is 1000 but keep it reasonable
                    sort: 'relevance',
                    order: 'desc',
                },
            });

            logger.debug('Crossref search completed', {
                query,
                resultCount: response.data.message.items.length,
                totalCount: response.data.message['total-results'],
            });

            return response.data.message.items.map(work => this.normalizeWork(work));
        } catch (error) {
            const axiosError = error as AxiosError;
            logger.error('Crossref search failed', {
                query,
                status: axiosError.response?.status,
                message: axiosError.message,
            });
            throw error;
        }
    }

    async lookupByDoi(doi: string): Promise<RawPaperResult | null> {
        try {
            const cleanDoi = doi.replace('https://doi.org/', '');

            const response = await this.client.get<CrossrefWorkResponse>(
                `/works/${encodeURIComponent(cleanDoi)}`
            );

            return this.normalizeWork(response.data.message);
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) {
                return null;
            }
            logger.error('Crossref DOI lookup failed', {
                doi,
                status: axiosError.response?.status,
            });
            throw error;
        }
    }

    async enrich(paper: Paper): Promise<Partial<RawPaperResult> | null> {
        if (!paper.doi) {
            return null;
        }

        try {
            const result = await this.lookupByDoi(paper.doi);
            if (!result) return null;
            const enrichment: Partial<RawPaperResult> = {};

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
        } catch {
            return null;
        }
    }
}
