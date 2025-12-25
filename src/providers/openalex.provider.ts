import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger';
import {
    PaperProvider,
    RawPaperResult,
    ProviderCapabilities,
    ConcurrencyConfig,
} from './paper-provider.interface';
import { Paper } from '../models/database.models';

/*
OpenAlex API response types
*/
interface OpenAlexAuthor {
    author: {
        id: string;
        display_name: string;
    };
}

interface OpenAlexWork {
    id: string;
    title: string;
    authorships: OpenAlexAuthor[];
    abstract_inverted_index?: Record<string, number[]>;
    doi?: string;
    publication_year?: number;
    primary_location?: {
        source?: {
            display_name?: string;
        };
        landing_page_url?: string;
    };
    cited_by_count?: number;
    open_access?: {
        oa_url?: string;
    };
}

interface OpenAlexSearchResponse {
    results: OpenAlexWork[];
    meta: {
        count: number;
        page: number;
        per_page: number;
    };
}

/*
Reconstruct abstract from OpenAlex inverted index format
*/
function reconstructAbstract(invertedIndex?: Record<string, number[]>): string {
    if (!invertedIndex) return '';

    const words: [string, number][] = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
        for (const pos of positions) {
            words.push([word, pos]);
        }
    }
    words.sort((a, b) => a[1] - b[1]);
    return words.map(w => w[0]).join(' ');
}

export class OpenAlexProvider implements PaperProvider {
    readonly name = 'openalex';
    readonly capabilities: ProviderCapabilities = {
        search: true,
        lookupByDoi: true,
        enrichment: false,
    };
    readonly concurrencyConfig: ConcurrencyConfig = {
        maxConcurrent: 5,
        requestsPerSecond: 10,
    };

    private client: AxiosInstance;
    private readonly BASE_URL = 'https://api.openalex.org';

    constructor() {
        const email = process.env.OPENALEX_EMAIL;
        const params: Record<string, string> = {};

        if (email) {
            params.mailto = email;
            logger.info('OpenAlex configured with polite pool email');
        } else {
            logger.warn('No OPENALEX_EMAIL configured - using lower rate limits');
            this.concurrencyConfig.requestsPerSecond = 1;
        }

        this.client = axios.create({
            baseURL: this.BASE_URL,
            timeout: 15000,
            params,
        });
    }

    private normalizeWork(work: OpenAlexWork): RawPaperResult {
        const oaId = work.id.replace('https://openalex.org/', '');
        let doi = work.doi;
        if (doi?.startsWith('https://doi.org/')) {
            doi = doi.replace('https://doi.org/', '');
        }

        return {
            id: oaId,
            title: work.title || 'Untitled',
            authors: work.authorships.map(a => ({
                name: a.author.display_name,
                id: a.author.id.replace('https://openalex.org/', ''),
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

    async search(query: string, limit: number): Promise<RawPaperResult[]> {
        try {
            const response = await this.client.get<OpenAlexSearchResponse>('/works', {
                params: {
                    search: query,
                    per_page: Math.min(limit, 200),
                    filter: 'has_abstract:true',
                    sort: 'relevance_score:desc',
                },
            });

            logger.debug('OpenAlex search completed', {
                query,
                resultCount: response.data.results.length,
                totalCount: response.data.meta.count,
            });

            return response.data.results.map(work => this.normalizeWork(work));
        } catch (error) {
            const axiosError = error as AxiosError;
            logger.error('OpenAlex search failed', {
                query,
                status: axiosError.response?.status,
                message: axiosError.message,
            });
            throw error;
        }
    }

    async lookupByDoi(doi: string): Promise<RawPaperResult | null> {
        try {
            // Normalize DOI format
            const cleanDoi = doi.replace('https://doi.org/', '');

            const response = await this.client.get<OpenAlexWork>(
                `/works/https://doi.org/${cleanDoi}`
            );

            return this.normalizeWork(response.data);
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) {
                return null;
            }
            logger.error('OpenAlex DOI lookup failed', {
                doi,
                status: axiosError.response?.status,
            });
            throw error;
        }
    }
}
