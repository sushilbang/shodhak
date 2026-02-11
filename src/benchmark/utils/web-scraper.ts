/**
 * Web Scraper Utility - Jina Reader API Integration
 *
 * Uses Jina Reader API to scrape web content for citation validation.
 * The Jina Reader API converts web pages to clean, LLM-friendly text.
 *
 * API Endpoint: https://r.jina.ai/{url}
 * Requires: JINA_API_KEY environment variable
 */

import axios, { AxiosError } from 'axios';

// ============================================================================
// INTERFACES
// ============================================================================

export interface ScrapeResult {
    /** The URL that was scraped */
    url: string;
    /** Scraped content as plain text */
    content: string;
    /** Whether the scrape was successful */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Content length in characters */
    contentLength: number;
    /** Title extracted from the page */
    title?: string;
    /** Scrape timestamp */
    timestamp: string;
}

export interface ScrapeOptions {
    /** Maximum content length to return (default: 50000) */
    maxLength?: number;
    /** Timeout in milliseconds (default: 30000) */
    timeout?: number;
    /** Whether to include images (default: false) */
    includeImages?: boolean;
    /** Custom headers */
    headers?: Record<string, string>;
}

export interface BatchScrapeResult {
    /** Successful scrapes */
    results: Map<string, ScrapeResult>;
    /** Failed URLs with error messages */
    failures: Map<string, string>;
    /** Statistics */
    stats: {
        total: number;
        successful: number;
        failed: number;
        averageContentLength: number;
    };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const JINA_BASE_URL = 'https://r.jina.ai';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_LENGTH = 50000;
const RATE_LIMIT_DELAY = 500; // ms between requests

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Scrape content from a URL using Jina Reader API
 *
 * @param url - The URL to scrape
 * @param options - Scrape options
 * @returns Scrape result with content or error
 */
export async function scrapeUrl(
    url: string,
    options: ScrapeOptions = {}
): Promise<ScrapeResult> {
    const {
        maxLength = DEFAULT_MAX_LENGTH,
        timeout = DEFAULT_TIMEOUT,
        includeImages = false,
        headers = {}
    } = options;

    const apiKey = process.env.JINA_API_KEY;

    if (!apiKey) {
        return {
            url,
            content: '',
            success: false,
            error: 'JINA_API_KEY environment variable not set',
            contentLength: 0,
            timestamp: new Date().toISOString()
        };
    }

    try {
        // Construct Jina Reader URL
        const jinaUrl = `${JINA_BASE_URL}/${encodeURIComponent(url)}`;

        const response = await axios.get(jinaUrl, {
            timeout,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'text/plain',
                'X-No-Cache': 'true',
                ...headers
            },
            maxRedirects: 5
        });

        let content = response.data;

        // Truncate content if too long
        if (typeof content === 'string' && content.length > maxLength) {
            content = content.slice(0, maxLength) + '\n[... content truncated ...]';
        }

        // Try to extract title from the content
        const titleMatch = typeof content === 'string'
            ? content.match(/^#\s+(.+?)(?:\n|$)/m)
            : null;

        return {
            url,
            content: typeof content === 'string' ? content : JSON.stringify(content),
            success: true,
            contentLength: content.length,
            title: titleMatch?.[1],
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        const axiosError = error as AxiosError;

        let errorMessage = 'Unknown error';
        if (axiosError.response) {
            errorMessage = `HTTP ${axiosError.response.status}: ${axiosError.response.statusText}`;
        } else if (axiosError.code === 'ECONNABORTED') {
            errorMessage = 'Request timeout';
        } else if (axiosError.code === 'ENOTFOUND') {
            errorMessage = 'URL not found';
        } else if (axiosError.message) {
            errorMessage = axiosError.message;
        }

        return {
            url,
            content: '',
            success: false,
            error: errorMessage,
            contentLength: 0,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Scrape multiple URLs with rate limiting
 *
 * @param urls - Array of URLs to scrape
 * @param options - Scrape options
 * @param onProgress - Optional progress callback
 * @returns Batch scrape results
 */
export async function scrapeUrls(
    urls: string[],
    options: ScrapeOptions = {},
    onProgress?: (completed: number, total: number) => void
): Promise<BatchScrapeResult> {
    const results = new Map<string, ScrapeResult>();
    const failures = new Map<string, string>();

    let totalContentLength = 0;

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];

        // Scrape with rate limiting
        const result = await scrapeUrl(url, options);

        if (result.success) {
            results.set(url, result);
            totalContentLength += result.contentLength;
        } else {
            failures.set(url, result.error || 'Unknown error');
        }

        // Report progress
        if (onProgress) {
            onProgress(i + 1, urls.length);
        }

        // Rate limit delay (except for last URL)
        if (i < urls.length - 1) {
            await delay(RATE_LIMIT_DELAY);
        }
    }

    const successCount = results.size;

    return {
        results,
        failures,
        stats: {
            total: urls.length,
            successful: successCount,
            failed: failures.size,
            averageContentLength: successCount > 0 ? totalContentLength / successCount : 0
        }
    };
}

/**
 * Scrape URL content for citation validation
 * Returns simplified content suitable for LLM validation
 *
 * @param url - URL to scrape
 * @returns Clean content for validation or null on failure
 */
export async function scrapeForValidation(url: string): Promise<string | null> {
    const result = await scrapeUrl(url, {
        maxLength: 30000, // Shorter for validation
        timeout: 20000
    });

    if (!result.success || !result.content) {
        return null;
    }

    // Clean content for validation
    return cleanContentForValidation(result.content);
}

/**
 * Clean scraped content for use in citation validation
 */
function cleanContentForValidation(content: string): string {
    return content
        // Remove markdown images
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
        // Remove excessive whitespace
        .replace(/\n{3,}/g, '\n\n')
        // Remove code blocks (keep inline code)
        .replace(/```[\s\S]*?```/g, '[code block removed]')
        // Trim
        .trim();
}

// ============================================================================
// SPECIALIZED SCRAPERS
// ============================================================================

/**
 * Scrape arXiv paper abstract
 *
 * @param arxivId - arXiv paper ID (e.g., "2301.12345")
 * @returns Paper abstract and metadata
 */
export async function scrapeArxiv(arxivId: string): Promise<{
    title: string;
    abstract: string;
    authors: string[];
    success: boolean;
    error?: string;
}> {
    const url = `https://arxiv.org/abs/${arxivId}`;
    const result = await scrapeUrl(url);

    if (!result.success) {
        return {
            title: '',
            abstract: '',
            authors: [],
            success: false,
            error: result.error
        };
    }

    // Extract metadata from content
    const titleMatch = result.content.match(/^#\s+(.+?)(?:\n|$)/m);
    const abstractMatch = result.content.match(/Abstract[:\s]*\n([\s\S]+?)(?:\n\n|\n#)/i);
    const authorsMatch = result.content.match(/Authors?[:\s]*([^\n]+)/i);

    return {
        title: titleMatch?.[1]?.trim() || result.title || '',
        abstract: abstractMatch?.[1]?.trim() || '',
        authors: authorsMatch?.[1]?.split(/,|;/).map(a => a.trim()).filter(Boolean) || [],
        success: true
    };
}

/**
 * Scrape DOI-referenced paper
 *
 * @param doi - DOI string (e.g., "10.1234/example")
 * @returns Paper content
 */
export async function scrapeDoi(doi: string): Promise<ScrapeResult> {
    // Clean DOI and construct URL
    const cleanDoi = doi.replace(/^doi:?\s*/i, '').trim();
    const url = `https://doi.org/${cleanDoi}`;

    return scrapeUrl(url);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Delay execution for rate limiting
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if JINA_API_KEY is configured
 */
export function isJinaConfigured(): boolean {
    return !!process.env.JINA_API_KEY;
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return '';
    }
}

/**
 * Check if URL is likely a research paper
 */
export function isResearchPaperUrl(url: string): boolean {
    const domain = extractDomain(url).toLowerCase();

    const paperDomains = [
        'arxiv.org',
        'doi.org',
        'acm.org',
        'ieee.org',
        'springer.com',
        'sciencedirect.com',
        'nature.com',
        'pnas.org',
        'aaai.org',
        'neurips.cc',
        'openreview.net',
        'aclweb.org',
        'semanticscholar.org',
        'researchgate.net'
    ];

    return paperDomains.some(d => domain.includes(d));
}
