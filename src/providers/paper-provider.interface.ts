import { Paper } from '../models/database.models';

export interface RawPaperResult {
    id: string;
    title: string;
    authors: { name: string; id?: string }[];
    abstract?: string;
    url?: string;
    doi?: string;
    year?: number;
    venue?: string;
    citationCount?: number;
    source: string;
    metadata?: Record<string, unknown>;
}
export interface ProviderCapabilities {
    search: boolean;
    lookupByDoi: boolean;
    enrichment: boolean;
}
export interface ConcurrencyConfig {
    maxConcurrent: number;
    requestsPerSecond: number;
}
export interface PaperProvider {
    readonly name: string;
    readonly capabilities: ProviderCapabilities;
    readonly concurrencyConfig: ConcurrencyConfig;
    search(query: string, limit: number): Promise<RawPaperResult[]>;
    lookupByDoi?(doi: string): Promise<RawPaperResult | null>;
    enrich?(paper: Paper): Promise<Partial<RawPaperResult> | null>;
}
export function normalizeToInternalPaper(raw: RawPaperResult): Paper {
    return {
        external_id: raw.id,
        title: raw.title,
        authors: raw.authors.map(a => ({
            name: a.name,
            authorId: a.id,
        })),
        abstract: raw.abstract || '',
        url: raw.url || '',
        doi: raw.doi,
        year: raw.year,
        venue: raw.venue,
        citation_count: raw.citationCount,
        source: raw.source as Paper['source'],
        metadata: raw.metadata as Record<string, any>,
    };
}
