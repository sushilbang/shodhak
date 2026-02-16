import { Paper } from '../models/database.models';
import { ExtractionResult, PaperSection } from '../types/agent.types';
import { logger } from '../utils/logger';
import { scrapeUrl, isJinaConfigured } from '../utils/web-scraper';

// Rate limiting delay between Jina API calls
const SCRAPE_DELAY_MS = 500;

class ExtractionService {
    /**
     * Extract full-text content from a paper using prioritized URL strategies.
     * Falls back to abstract if all URLs fail.
     */
    async extractPaperContent(paper: Paper): Promise<ExtractionResult | null> {
        if (!isJinaConfigured()) {
            logger.warn('JINA_API_KEY not configured, cannot extract paper content');
            return null;
        }

        const urlsToTry = this.getPrioritizedUrls(paper);

        if (urlsToTry.length === 0) {
            logger.debug('No extractable URLs for paper', { title: paper.title });
            return null;
        }

        for (const url of urlsToTry) {
            try {
                const result = await scrapeUrl(url, {
                    maxLength: 50000,
                    timeout: 30000
                });

                if (result.success && result.content && !this.isBlockedPage(result.content)) {
                    // Filter out junk content — if it's too short or looks like nav/boilerplate,
                    // skip to next URL. Real paper content should be substantial.
                    const cleanContent = this.stripBoilerplate(result.content);
                    if (cleanContent.length < 200) {
                        logger.debug(`Content too short after cleanup (${cleanContent.length} chars), trying next URL`);
                        continue;
                    }

                    const sections = this.parseSections(cleanContent);
                    return {
                        paperId: paper.id || 0,
                        fullText: cleanContent.slice(0, 5000),
                        sections,
                        extractedAt: new Date(),
                        source: this.classifySource(url),
                        metadata: { sourceUrl: url, contentLength: result.contentLength }
                    };
                }
            } catch (error) {
                logger.debug(`Failed to extract from ${url}`, { error });
            }
        }

        // All URLs failed — fall back to abstract
        if (paper.abstract) {
            return {
                paperId: paper.id || 0,
                fullText: paper.abstract,
                sections: [{
                    title: 'Abstract',
                    content: paper.abstract,
                    order: 0,
                    type: 'abstract'
                }],
                extractedAt: new Date(),
                source: 'other',
                metadata: { sourceUrl: '', fallback: 'abstract' }
            };
        }

        return null;
    }

    /**
     * Parse raw text into structured paper sections
     */
    parseSections(rawText: string): PaperSection[] {
        const sectionPattern = /^(?:#{1,3}\s*)?(?:\d+\.?\s*)?(abstract|introduction|related work|background|methodology|methods|method|approach|experiments?|results|evaluation|discussion|conclusion|conclusions|references|acknowledgment|appendix)/im;

        const lines = rawText.split('\n');
        const sections: PaperSection[] = [];
        let currentSection: { title: string; content: string[]; type: PaperSection['type'] } | null = null;
        let order = 0;

        for (const line of lines) {
            const match = line.match(sectionPattern);
            if (match) {
                // Save previous section
                if (currentSection) {
                    sections.push({
                        title: currentSection.title,
                        content: currentSection.content.join('\n').trim(),
                        order: order++,
                        type: currentSection.type
                    });
                }
                const sectionName = match[1].toLowerCase();
                currentSection = {
                    title: line.trim().replace(/^#+\s*/, '').replace(/^\d+\.?\s*/, ''),
                    content: [],
                    type: this.classifySectionType(sectionName)
                };
            } else if (currentSection) {
                currentSection.content.push(line);
            }
        }

        // Save last section
        if (currentSection) {
            sections.push({
                title: currentSection.title,
                content: currentSection.content.join('\n').trim(),
                order: order++,
                type: currentSection.type
            });
        }

        // If no sections detected, return whole text as a single section
        if (sections.length === 0) {
            return [{
                title: 'Full Text',
                content: rawText.trim(),
                order: 0,
                type: 'other'
            }];
        }

        return sections;
    }

    /**
     * Check if extraction is possible for a paper
     */
    canExtract(paper: Paper): boolean {
        if (!isJinaConfigured()) return false;
        if (!paper.url && !paper.doi) return false;

        const url = (paper.url || '').toLowerCase();
        return (
            url.includes('arxiv.org') ||
            url.endsWith('.pdf') ||
            url.includes('doi.org') ||
            url.includes('semanticscholar.org') ||
            url.includes('openreview.net') ||
            !!paper.doi
        );
    }

    /**
     * Get the best scrapable URL for a paper.
     * Prioritizes arXiv and open-access URLs over DOIs (which often 403).
     */
    getPreferredUrl(paper: Paper): string | null {
        const urls = this.getPrioritizedUrls(paper);
        return urls.length > 0 ? urls[0] : null;
    }

    /**
     * Extract content for multiple papers with rate limiting.
     * Returns a map of paper external_id → extracted content string.
     */
    async extractMultiplePapers(
        papers: Paper[],
        maxPapers: number = 10
    ): Promise<Map<string, string>> {
        const contentMap = new Map<string, string>();

        if (!isJinaConfigured()) {
            // Fall back to abstracts only
            for (const paper of papers) {
                if (paper.abstract) {
                    contentMap.set(paper.external_id, paper.abstract);
                }
            }
            return contentMap;
        }

        const papersToExtract = papers.slice(0, maxPapers);

        for (let i = 0; i < papersToExtract.length; i++) {
            const paper = papersToExtract[i];

            const result = await this.extractPaperContent(paper);
            if (result && result.fullText) {
                contentMap.set(paper.external_id, result.fullText);
            } else if (paper.abstract) {
                contentMap.set(paper.external_id, paper.abstract);
            }

            // Rate limiting between papers (except last)
            if (i < papersToExtract.length - 1) {
                await this.delay(SCRAPE_DELAY_MS);
            }
        }

        return contentMap;
    }

    // ========================================================================
    // PRIVATE HELPERS
    // ========================================================================

    /**
     * Build a prioritized list of URLs to try for a paper.
     * arXiv HTML > Semantic Scholar > paper.url (non-DOI) > DOI
     */
    private getPrioritizedUrls(paper: Paper): string[] {
        const urls: string[] = [];
        const url = paper.url || '';

        // 1. arXiv HTML version (most scraper-friendly)
        if (url.includes('arxiv.org')) {
            const arxivIdMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
            if (arxivIdMatch) {
                urls.push(`https://arxiv.org/html/${arxivIdMatch[1]}`);
                urls.push(`https://arxiv.org/abs/${arxivIdMatch[1]}`);
            }
        }

        // 2. Open access URL from metadata
        const oaUrl = paper.metadata?.openAccessUrl as string | undefined;
        if (oaUrl && !urls.includes(oaUrl)) {
            urls.push(oaUrl);
        }

        // 3. Semantic Scholar page (if that's the source)
        if (url.includes('semanticscholar.org') && !urls.includes(url)) {
            urls.push(url);
        }

        // 4. Paper URL (if not DOI — DOIs often 403)
        if (url && !url.includes('doi.org') && !urls.includes(url)) {
            urls.push(url);
        }

        // 5. DOI as last resort
        if (paper.doi) {
            const doiUrl = `https://doi.org/${paper.doi}`;
            if (!urls.includes(doiUrl)) {
                urls.push(doiUrl);
            }
        } else if (url.includes('doi.org') && !urls.includes(url)) {
            urls.push(url);
        }

        return urls;
    }

    private classifySource(url: string): ExtractionResult['source'] {
        if (url.includes('arxiv.org')) return 'arxiv';
        if (url.endsWith('.pdf')) return 'pdf';
        return 'html';
    }

    private classifySectionType(name: string): PaperSection['type'] {
        const normalized = name.toLowerCase().trim();
        if (normalized.includes('abstract')) return 'abstract';
        if (normalized.includes('introduction')) return 'introduction';
        if (normalized.includes('method') || normalized.includes('approach')) return 'methods';
        if (normalized.includes('result') || normalized.includes('experiment') || normalized.includes('evaluation')) return 'results';
        if (normalized.includes('discussion')) return 'discussion';
        if (normalized.includes('conclusion')) return 'conclusion';
        if (normalized.includes('reference')) return 'references';
        return 'other';
    }

    /**
     * Remove common web boilerplate from scraped content.
     * Keeps only substantive paragraphs likely to be paper content.
     */
    private stripBoilerplate(content: string): string {
        return content
            // Remove lines that look like nav/menu items (very short, no periods)
            .split('\n')
            .filter(line => {
                const trimmed = line.trim();
                // Keep empty lines (paragraph breaks)
                if (trimmed === '') return true;
                // Keep markdown headings
                if (trimmed.startsWith('#')) return true;
                // Filter out very short non-sentence lines (nav links, buttons, etc.)
                if (trimmed.length < 30 && !trimmed.includes('.') && !trimmed.startsWith('-') && !trimmed.startsWith('*')) return false;
                return true;
            })
            .join('\n')
            // Collapse excessive whitespace
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private isBlockedPage(content: string): boolean {
        const lower = content.toLowerCase();
        if (content.length > 2000) return false;
        const indicators = [
            'verify you are human', 'captcha', 'access denied',
            'error 403', '403 forbidden', 'just a moment',
            'checking your browser', 'ray id'
        ];
        return indicators.some(i => lower.includes(i));
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const extractionService = new ExtractionService();
