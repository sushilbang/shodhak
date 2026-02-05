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
PubMed E-utilities API response types
*/
interface PubMedSearchResult {
    eSearchResult: {
        Count: string[];
        RetMax: string[];
        RetStart: string[];
        IdList: { Id: string[] }[];
    };
}

interface PubMedAuthor {
    LastName?: string[];
    ForeName?: string[];
    Initials?: string[];
    CollectiveName?: string[];
}

interface PubMedArticleId {
    _: string;
    $: { IdType: string };
}

interface PubMedArticle {
    MedlineCitation: [{
        PMID: [{ _: string }];
        Article: [{
            ArticleTitle: string[];
            Abstract?: { AbstractText: (string | { _: string })[] }[];
            AuthorList?: { Author: PubMedAuthor[] }[];
            Journal?: {
                Title?: string[];
                ISOAbbreviation?: string[];
                JournalIssue?: {
                    PubDate?: {
                        Year?: string[];
                        MedlineDate?: string[];
                    }[];
                }[];
            }[];
            ELocationID?: { _: string; $: { EIdType: string } }[];
        }];
    }];
    PubmedData?: [{
        ArticleIdList?: { ArticleId: PubMedArticleId[] }[];
    }];
}

interface PubMedFetchResult {
    PubmedArticleSet: {
        PubmedArticle?: PubMedArticle[];
    };
}

/*
Extract author name from PubMed author object
*/
function formatAuthorName(author: PubMedAuthor): string {
    if (author.CollectiveName?.[0]) {
        return author.CollectiveName[0];
    }
    const lastName = author.LastName?.[0] || '';
    const foreName = author.ForeName?.[0] || author.Initials?.[0] || '';
    return foreName ? `${foreName} ${lastName}`.trim() : lastName;
}

/*
Extract abstract text, handling structured abstracts
*/
function extractAbstract(abstractData?: { AbstractText: (string | { _: string })[] }[]): string {
    if (!abstractData?.[0]?.AbstractText) return '';

    return abstractData[0].AbstractText
        .map(text => {
            if (typeof text === 'string') return text;
            if (typeof text === 'object' && text._) return text._;
            return '';
        })
        .filter(Boolean)
        .join(' ')
        .trim();
}

/*
Extract year from PubMed date formats
*/
function extractYear(pubDate?: { Year?: string[]; MedlineDate?: string[] }[]): number | undefined {
    if (!pubDate?.[0]) return undefined;

    if (pubDate[0].Year?.[0]) {
        return parseInt(pubDate[0].Year[0], 10);
    }

    // MedlineDate format: "2023 Jan-Feb" or "2023 Spring"
    if (pubDate[0].MedlineDate?.[0]) {
        const match = pubDate[0].MedlineDate[0].match(/^(\d{4})/);
        if (match) return parseInt(match[1], 10);
    }

    return undefined;
}

export class PubMedProvider implements PaperProvider {
    readonly name = 'pubmed';
    readonly capabilities: ProviderCapabilities = {
        search: true,
        lookupByDoi: true,
        enrichment: true,
    };
    // Rate limits: 3/sec without API key, 10/sec with key
    readonly concurrencyConfig: ConcurrencyConfig = {
        maxConcurrent: 3,
        requestsPerSecond: 3,
    };

    private client: AxiosInstance;
    private readonly BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    private readonly apiKey?: string;

    constructor() {
        this.apiKey = process.env.PUBMED_API_KEY;

        const params: Record<string, string> = {
            db: 'pubmed',
            retmode: 'xml',
        };

        if (this.apiKey) {
            params.api_key = this.apiKey;
            this.concurrencyConfig.requestsPerSecond = 10;
            logger.info('PubMed configured with API key - using higher rate limits');
        } else {
            logger.info('PubMed initialized without API key - using default rate limits');
        }

        this.client = axios.create({
            baseURL: this.BASE_URL,
            timeout: 30000,
            params,
        });
    }

    private normalizeArticle(article: PubMedArticle): RawPaperResult {
        const citation = article.MedlineCitation[0];
        const articleData = citation.Article[0];
        const pubmedData = article.PubmedData?.[0];

        const pmid = citation.PMID[0]._ || citation.PMID[0] as unknown as string;

        // Extract DOI from article IDs
        let doi: string | undefined;
        const articleIds = pubmedData?.ArticleIdList?.[0]?.ArticleId || [];
        for (const id of articleIds) {
            if (id.$?.IdType === 'doi') {
                doi = id._;
                break;
            }
        }

        // Also check ELocationID for DOI
        if (!doi && articleData.ELocationID) {
            const doiLocation = articleData.ELocationID.find(e => e.$?.EIdType === 'doi');
            if (doiLocation) {
                doi = doiLocation._;
            }
        }

        // Extract authors
        const authors = articleData.AuthorList?.[0]?.Author || [];

        // Extract journal info
        const journal = articleData.Journal?.[0];
        const venue = journal?.Title?.[0] || journal?.ISOAbbreviation?.[0];
        const year = extractYear(journal?.JournalIssue?.[0]?.PubDate);

        return {
            id: pmid,
            title: articleData.ArticleTitle[0] || 'Untitled',
            authors: authors
                .map(a => ({ name: formatAuthorName(a) }))
                .filter(a => a.name),
            abstract: extractAbstract(articleData.Abstract),
            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            doi,
            year,
            venue,
            source: 'pubmed',
            metadata: {
                pmid,
                pmcid: articleIds.find(id => id.$?.IdType === 'pmc')?._,
            },
        };
    }

    private async fetchArticlesByIds(ids: string[]): Promise<RawPaperResult[]> {
        if (ids.length === 0) return [];

        const response = await this.client.get('/efetch.fcgi', {
            params: {
                id: ids.join(','),
                rettype: 'abstract',
            },
        });

        const parsed: PubMedFetchResult = await parseStringPromise(response.data, {
            explicitArray: true,
            mergeAttrs: false,
        });

        const articles = parsed.PubmedArticleSet?.PubmedArticle || [];
        return articles.map(article => this.normalizeArticle(article));
    }

    async search(query: string, limit: number): Promise<RawPaperResult[]> {
        try {
            // Step 1: Search for PMIDs
            const searchResponse = await this.client.get('/esearch.fcgi', {
                params: {
                    term: query,
                    retmax: Math.min(limit, 100),
                    sort: 'relevance',
                },
            });

            const searchParsed: PubMedSearchResult = await parseStringPromise(searchResponse.data);
            const ids = searchParsed.eSearchResult?.IdList?.[0]?.Id || [];
            const totalCount = parseInt(searchParsed.eSearchResult?.Count?.[0] || '0', 10);

            logger.debug('PubMed search completed', {
                query,
                resultCount: ids.length,
                totalCount,
            });

            if (ids.length === 0) {
                return [];
            }

            // Step 2: Fetch full article data
            return await this.fetchArticlesByIds(ids);
        } catch (error) {
            const axiosError = error as AxiosError;
            logger.error('PubMed search failed', {
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

            // Search by DOI
            const searchResponse = await this.client.get('/esearch.fcgi', {
                params: {
                    term: `${cleanDoi}[doi]`,
                    retmax: 1,
                },
            });

            const searchParsed: PubMedSearchResult = await parseStringPromise(searchResponse.data);
            const ids = searchParsed.eSearchResult?.IdList?.[0]?.Id || [];

            if (ids.length === 0) {
                return null;
            }

            const results = await this.fetchArticlesByIds(ids);
            return results[0] || null;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) {
                return null;
            }
            logger.error('PubMed DOI lookup failed', {
                doi,
                status: axiosError.response?.status,
            });
            throw error;
        }
    }

    // Lookup by PubMed ID (PMID)
    async lookupByPmid(pmid: string): Promise<RawPaperResult | null> {
        try {
            const results = await this.fetchArticlesByIds([pmid]);
            return results[0] || null;
        } catch (error) {
            const axiosError = error as AxiosError;
            logger.error('PubMed PMID lookup failed', {
                pmid,
                status: axiosError.response?.status,
            });
            throw error;
        }
    }

    // Enrich existing paper with PubMed data
    async enrich(paper: { doi?: string }): Promise<Partial<RawPaperResult> | null> {
        if (!paper.doi) return null;

        try {
            const result = await this.lookupByDoi(paper.doi);
            if (!result) return null;

            return {
                abstract: result.abstract,
                venue: result.venue,
                year: result.year,
                metadata: result.metadata,
            };
        } catch {
            return null;
        }
    }
}
