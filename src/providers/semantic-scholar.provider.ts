import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger';
import {
    PaperProvider,
    RawPaperResult,
    ProviderCapabilities,
    ConcurrencyConfig,
} from './paper-provider.interface';
import { Paper, SemanticScholarPaper, SemanticScholarSearchResponse } from '../models/database.models';

export class SemanticScholarProvider implements PaperProvider {
    readonly name = 'semantic_scholar';
    readonly capabilities: ProviderCapabilities = {
        search: true,
        lookupByDoi: true,
        enrichment: true,
    };
    readonly concurrencyConfig: ConcurrencyConfig;

    private client: AxiosInstance;
    private readonly BASE_URL = 'https://api.semanticscholar.org/graph/v1';
    private readonly FIELDS = 'paperId,title,authors,abstract,url,doi,year,venue,citationCount';
    private readonly MAX_RETRIES = 3;
    private readonly BASE_DELAY_MS = 2000;

    constructor() {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        const apiKey = process.env.SEMANTICSCHOLAR_API_KEY || process.env.SEMANTIC_SCHOLAR_API_KEY;

        if (apiKey) {
            headers['x-api-key'] = apiKey;
            logger.info('Semantic Scholar API key configured');
            // Basic API key tier: 1 req/sec
            this.concurrencyConfig = {
                maxConcurrent: 1,
                requestsPerSecond: 1,
            };
        } else {
            logger.warn('No Semantic Scholar API key found - using public rate limits');
            this.concurrencyConfig = {
                maxConcurrent: 1,
                requestsPerSecond: 0.5,
            };
        }

        this.client = axios.create({
            baseURL: this.BASE_URL,
            timeout: 10000,
            headers,
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                const axiosError = error as AxiosError;

                if (axiosError.response?.status === 429 ||
                    (axiosError.response?.status && axiosError.response.status >= 500)) {
                    const delay = this.BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    logger.warn(`${context} failed (attempt ${attempt}/${this.MAX_RETRIES}), retrying in ${delay}ms`, {
                        status: axiosError.response?.status,
                    });
                    await this.sleep(delay);
                } else {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    private normalizePaper(ssPaper: SemanticScholarPaper): RawPaperResult {
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

    async search(query: string, limit: number): Promise<RawPaperResult[]> {
        const response = await this.withRetry(
            () => this.client.get<SemanticScholarSearchResponse>('paper/search', {
                params: {
                    query,
                    limit: Math.min(limit, 100),
                    fields: this.FIELDS,
                },
            }),
            'Semantic Scholar search'
        );

        logger.debug('Semantic Scholar search completed', {
            query,
            resultCount: response.data.data.length,
            totalCount: response.data.total,
        });

        return response.data.data.map(p => this.normalizePaper(p));
    }

    async lookupByDoi(doi: string): Promise<RawPaperResult | null> {
        try {
            const cleanDoi = doi.replace('https://doi.org/', '');

            const response = await this.withRetry(
                () => this.client.get<SemanticScholarPaper>(`/paper/DOI:${cleanDoi}`, {
                    params: { fields: this.FIELDS },
                }),
                'Semantic Scholar DOI lookup'
            );

            return this.normalizePaper(response.data);
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getPaperById(paperId: string): Promise<RawPaperResult | null> {
        try {
            const response = await this.withRetry(
                () => this.client.get<SemanticScholarPaper>(`/paper/${paperId}`, {
                    params: { fields: this.FIELDS },
                }),
                'Get paper details'
            );

            return this.normalizePaper(response.data);
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) {
                return null;
            }
            logger.error('Failed to get paper details', {
                error, paperId,
            });
            return null;
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

            if (!paper.abstract && result.abstract) {
                enrichment.abstract = result.abstract;
            }
            if (!paper.citation_count && result.citationCount) {
                enrichment.citationCount = result.citationCount;
            }

            return Object.keys(enrichment).length > 0 ? enrichment : null;
        } catch {
            return null;
        }
    }
}
