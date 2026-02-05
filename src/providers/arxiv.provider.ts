import axios, { AxiosInstance, AxiosError } from 'axios';
import { parseStringPromise } from 'xml2js';
import { logger } from '../utils/logger';
import {
    PaperProvider,
    RawPaperResult,
    ProviderCapabilities,
    ConcurrencyConfig,
} from './paper-provider.interface';

/*
ArXiv API response types (parsed from XML)
*/
interface ArxivAuthor {
    name: string[];
}

interface ArxivEntry {
    id: string[];
    title: string[];
    summary: string[];
    author: ArxivAuthor[];
    published: string[];
    updated: string[];
    'arxiv:primary_category'?: { $: { term: string } }[];
    category?: { $: { term: string } }[];
    link?: { $: { href: string; rel?: string; title?: string; type?: string } }[];
    'arxiv:doi'?: string[];
}

interface ArxivFeed {
    feed: {
        entry?: ArxivEntry[];
        'opensearch:totalResults'?: string[];
        'opensearch:startIndex'?: string[];
        'opensearch:itemsPerPage'?: string[];
    };
}

/*
Clean up text from ArXiv (remove extra whitespace, newlines)
*/
function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/*
Extract arXiv ID from URL
e.g., http://arxiv.org/abs/2301.00001v1 -> 2301.00001
*/
function extractArxivId(url: string): string {
    const match = url.match(/arxiv\.org\/abs\/([^\s/]+)/);
    if (match) {
        // Remove version suffix (v1, v2, etc.)
        return match[1].replace(/v\d+$/, '');
    }
    return url;
}

export class ArxivProvider implements PaperProvider {
    readonly name = 'arxiv';
    readonly capabilities: ProviderCapabilities = {
        search: true,
        lookupByDoi: true,
        enrichment: false,
    };
    // ArXiv is very generous with rate limits - 1 request per 3 seconds recommended
    readonly concurrencyConfig: ConcurrencyConfig = {
        maxConcurrent: 1,
        requestsPerSecond: 0.33,
    };

    private client: AxiosInstance;
    private readonly BASE_URL = 'http://export.arxiv.org/api';

    constructor() {
        this.client = axios.create({
            baseURL: this.BASE_URL,
            timeout: 30000, // ArXiv can be slow
        });
        logger.info('ArXiv provider initialized');
    }

    private normalizeEntry(entry: ArxivEntry): RawPaperResult {
        const arxivUrl = entry.id?.[0] || '';
        const arxivId = extractArxivId(arxivUrl);

        // Extract DOI if present
        const doi = entry['arxiv:doi']?.[0];

        // Get the PDF link
        const pdfLink = entry.link?.find(l => l.$?.title === 'pdf');
        const pdfUrl = pdfLink?.$?.href;

        // Extract year from published date
        const publishedDate = entry.published?.[0];
        const year = publishedDate ? new Date(publishedDate).getFullYear() : undefined;

        // Get primary category as venue
        const primaryCategory = entry['arxiv:primary_category']?.[0]?.$?.term;

        return {
            id: arxivId,
            title: cleanText(entry.title?.[0] || 'Untitled'),
            authors: (entry.author || []).map(a => ({
                name: a.name?.[0] || 'Unknown Author',
            })),
            abstract: cleanText(entry.summary?.[0] || ''),
            url: pdfUrl || arxivUrl,
            doi,
            year,
            venue: primaryCategory ? `arXiv:${primaryCategory}` : 'arXiv',
            source: 'arxiv',
            metadata: {
                arxivId,
                arxivUrl,
                pdfUrl,
                categories: entry.category?.map(c => c.$?.term).filter(Boolean),
                publishedDate,
                updatedDate: entry.updated?.[0],
            },
        };
    }

    async search(query: string, limit: number): Promise<RawPaperResult[]> {
        try {
            // ArXiv search query format
            // all: searches all fields, ti: title, au: author, abs: abstract
            const searchQuery = `all:${query}`;

            const response = await this.client.get('/query', {
                params: {
                    search_query: searchQuery,
                    start: 0,
                    max_results: Math.min(limit, 100), // ArXiv max is 100 per request
                    sortBy: 'relevance',
                    sortOrder: 'descending',
                },
            });

            const parsed: ArxivFeed = await parseStringPromise(response.data);

            const entries = parsed.feed?.entry || [];
            const totalResults = parseInt(parsed.feed?.['opensearch:totalResults']?.[0] || '0', 10);

            logger.debug('ArXiv search completed', {
                query,
                resultCount: entries.length,
                totalCount: totalResults,
            });

            return entries
                .filter(entry => entry && entry.title?.[0])
                .map(entry => this.normalizeEntry(entry));
        } catch (error) {
            const axiosError = error as AxiosError;
            logger.error('ArXiv search failed', {
                query,
                status: axiosError.response?.status,
                message: axiosError.message,
            });
            throw error;
        }
    }

    async lookupByDoi(doi: string): Promise<RawPaperResult | null> {
        // ArXiv doesn't have direct DOI lookup, but we can search for it
        try {
            const cleanDoi = doi.replace('https://doi.org/', '');

            const response = await this.client.get('/query', {
                params: {
                    search_query: `doi:${cleanDoi}`,
                    max_results: 1,
                },
            });

            const parsed: ArxivFeed = await parseStringPromise(response.data);
            const entry = parsed.feed?.entry?.[0];

            if (!entry) {
                return null;
            }

            return this.normalizeEntry(entry);
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) {
                return null;
            }
            logger.error('ArXiv DOI lookup failed', {
                doi,
                status: axiosError.response?.status,
            });
            throw error;
        }
    }

    // Additional method to lookup by arXiv ID
    async lookupByArxivId(arxivId: string): Promise<RawPaperResult | null> {
        try {
            // Clean the arXiv ID (remove version suffix if present)
            const cleanId = arxivId.replace(/v\d+$/, '');

            const response = await this.client.get('/query', {
                params: {
                    id_list: cleanId,
                    max_results: 1,
                },
            });

            const parsed: ArxivFeed = await parseStringPromise(response.data);
            const entry = parsed.feed?.entry?.[0];

            if (!entry) {
                return null;
            }

            return this.normalizeEntry(entry);
        } catch (error) {
            const axiosError = error as AxiosError;
            logger.error('ArXiv ID lookup failed', {
                arxivId,
                status: axiosError.response?.status,
            });
            throw error;
        }
    }
}
