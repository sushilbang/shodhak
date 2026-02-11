/**
 * Citation Extractor Utility
 *
 * Extracts citations from markdown research reports in various formats:
 * - Numbered references: [1], [2], etc.
 * - Inline URLs: (https://...)
 * - Reference sections with URLs
 * - DOI references
 */

// ============================================================================
// INTERFACES
// ============================================================================

export interface Citation {
    /** The statement/claim being cited */
    fact: string;
    /** Reference index (e.g., "1", "2") or "0" for inline citations */
    ref_idx: string;
    /** Source URL or DOI */
    url: string;
    /** Position in the original text */
    position: number;
    /** Type of citation */
    type: 'numbered' | 'inline_url' | 'doi' | 'reference_section';
}

export interface ReferenceEntry {
    /** Reference index */
    index: string;
    /** Full reference text */
    text: string;
    /** Extracted URL if present */
    url?: string;
    /** Extracted DOI if present */
    doi?: string;
    /** Extracted title if identifiable */
    title?: string;
}

export interface ExtractionResult {
    /** All extracted citations */
    citations: Citation[];
    /** Reference section entries (if found) */
    references: ReferenceEntry[];
    /** Statistics */
    stats: {
        totalCitations: number;
        uniqueUrls: number;
        numberedCitations: number;
        inlineUrlCitations: number;
        doiCitations: number;
    };
}

// ============================================================================
// REGEX PATTERNS
// ============================================================================

const PATTERNS = {
    // Numbered citations like [1], [2,3], [1-5]
    numberedCitation: /\[(\d+(?:[-,]\d+)*)\]/g,

    // Inline URLs in parentheses or as-is
    inlineUrl: /(?:\(|\s)(https?:\/\/[^\s\)]+)(?:\)|\s|$)/g,

    // DOI patterns
    doi: /(?:doi:?\s*|https?:\/\/doi\.org\/)(10\.\d{4,}\/[^\s\]]+)/gi,

    // arXiv patterns
    arxiv: /(?:arxiv:?\s*|https?:\/\/arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?)/gi,

    // Reference section header
    referenceHeader: /^(?:#{1,3}\s*)?(?:references?|bibliography|citations?|works cited)\s*$/im,

    // Reference entry pattern (common formats)
    referenceEntry: /^\s*\[?(\d+)\]?\.\s*(.+?)(?:\n|$)/gm,

    // URL extraction from text
    urlInText: /https?:\/\/[^\s\]\)>"]+/g
};

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract all citations from a markdown report
 *
 * @param report - The markdown report content
 * @returns Extraction result with citations, references, and statistics
 */
export function extractCitations(report: string): ExtractionResult {
    const citations: Citation[] = [];
    const references: ReferenceEntry[] = [];
    const seenUrls = new Set<string>();

    // Split report to find reference section
    const { mainContent, referenceSection } = splitReferenceSection(report);

    // Extract reference section entries first (if present)
    if (referenceSection) {
        const refEntries = parseReferenceSection(referenceSection);
        references.push(...refEntries);
    }

    // Build reference index to URL mapping
    const refUrlMap = buildReferenceUrlMap(references);

    // Extract numbered citations from main content
    const numberedCitations = extractNumberedCitations(mainContent, refUrlMap);
    citations.push(...numberedCitations);

    // Extract inline URL citations
    const inlineCitations = extractInlineUrlCitations(mainContent);
    citations.push(...inlineCitations);

    // Extract DOI citations
    const doiCitations = extractDoiCitations(mainContent);
    citations.push(...doiCitations);

    // Count unique URLs
    for (const cit of citations) {
        if (cit.url) {
            seenUrls.add(normalizeUrl(cit.url));
        }
    }

    return {
        citations,
        references,
        stats: {
            totalCitations: citations.length,
            uniqueUrls: seenUrls.size,
            numberedCitations: citations.filter(c => c.type === 'numbered').length,
            inlineUrlCitations: citations.filter(c => c.type === 'inline_url').length,
            doiCitations: citations.filter(c => c.type === 'doi').length
        }
    };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Split report into main content and reference section
 */
function splitReferenceSection(report: string): {
    mainContent: string;
    referenceSection: string | null;
} {
    const match = report.match(PATTERNS.referenceHeader);
    if (!match || match.index === undefined) {
        return { mainContent: report, referenceSection: null };
    }

    const splitIndex = match.index;
    return {
        mainContent: report.slice(0, splitIndex),
        referenceSection: report.slice(splitIndex)
    };
}

/**
 * Parse reference section into structured entries
 */
function parseReferenceSection(section: string): ReferenceEntry[] {
    const entries: ReferenceEntry[] = [];
    const lines = section.split('\n');

    let currentIndex = '';
    let currentText = '';

    for (const line of lines) {
        // Check if this is a new reference entry
        const entryMatch = line.match(/^\s*\[?(\d+)\]?\.?\s+(.*)$/);

        if (entryMatch) {
            // Save previous entry if exists
            if (currentIndex && currentText) {
                entries.push(parseReferenceEntry(currentIndex, currentText.trim()));
            }

            currentIndex = entryMatch[1];
            currentText = entryMatch[2];
        } else if (currentIndex && line.trim()) {
            // Continuation of current entry
            currentText += ' ' + line.trim();
        }
    }

    // Save last entry
    if (currentIndex && currentText) {
        entries.push(parseReferenceEntry(currentIndex, currentText.trim()));
    }

    return entries;
}

/**
 * Parse a single reference entry
 */
function parseReferenceEntry(index: string, text: string): ReferenceEntry {
    const entry: ReferenceEntry = {
        index,
        text
    };

    // Extract URL
    const urlMatch = text.match(PATTERNS.urlInText);
    if (urlMatch) {
        entry.url = urlMatch[0];
    }

    // Extract DOI
    const doiMatch = text.match(PATTERNS.doi);
    if (doiMatch) {
        entry.doi = doiMatch[1] || doiMatch[0];
        if (!entry.url) {
            entry.url = `https://doi.org/${entry.doi.replace(/^doi:?\s*/i, '')}`;
        }
    }

    // Extract arXiv ID
    const arxivMatch = text.match(PATTERNS.arxiv);
    if (arxivMatch && !entry.url) {
        const arxivId = arxivMatch[1] || arxivMatch[0].replace(/arxiv:?\s*/i, '');
        entry.url = `https://arxiv.org/abs/${arxivId}`;
    }

    // Try to extract title (text before "by", "in", year, or URL)
    const titleMatch = text.match(/^([^.]+?)(?:\.|(?:\s+by\s+)|(?:\s+in\s+)|(?:\s+\(\d{4}\))|\s+http)/i);
    if (titleMatch) {
        entry.title = titleMatch[1].trim();
    }

    return entry;
}

/**
 * Build mapping from reference indices to URLs
 */
function buildReferenceUrlMap(references: ReferenceEntry[]): Map<string, string> {
    const map = new Map<string, string>();

    for (const ref of references) {
        if (ref.url) {
            map.set(ref.index, ref.url);
        }
    }

    return map;
}

/**
 * Extract numbered citations [1], [2], etc.
 */
function extractNumberedCitations(
    content: string,
    refUrlMap: Map<string, string>
): Citation[] {
    const citations: Citation[] = [];
    const sentences = splitIntoSentences(content);

    for (const { text: sentence, position } of sentences) {
        // Find all numbered citations in this sentence
        const matches = [...sentence.matchAll(PATTERNS.numberedCitation)];

        for (const match of matches) {
            const refIndices = parseReferenceIndices(match[1]);

            for (const refIdx of refIndices) {
                const url = refUrlMap.get(refIdx) || '';

                citations.push({
                    fact: cleanSentence(sentence),
                    ref_idx: refIdx,
                    url,
                    position: position + (match.index || 0),
                    type: 'numbered'
                });
            }
        }
    }

    return citations;
}

/**
 * Parse reference indices from strings like "1", "1,2", "1-3"
 */
function parseReferenceIndices(indexStr: string): string[] {
    const indices: string[] = [];

    const parts = indexStr.split(',');
    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(s => parseInt(s.trim()));
            for (let i = start; i <= end; i++) {
                indices.push(i.toString());
            }
        } else {
            indices.push(part.trim());
        }
    }

    return indices;
}

/**
 * Extract inline URL citations
 */
function extractInlineUrlCitations(content: string): Citation[] {
    const citations: Citation[] = [];
    const sentences = splitIntoSentences(content);

    for (const { text: sentence, position } of sentences) {
        const matches = [...sentence.matchAll(PATTERNS.inlineUrl)];

        for (const match of matches) {
            const url = match[1];

            citations.push({
                fact: cleanSentence(sentence),
                ref_idx: '0', // Inline citations don't have reference indices
                url,
                position: position + (match.index || 0),
                type: 'inline_url'
            });
        }
    }

    return citations;
}

/**
 * Extract DOI citations
 */
function extractDoiCitations(content: string): Citation[] {
    const citations: Citation[] = [];
    const sentences = splitIntoSentences(content);

    for (const { text: sentence, position } of sentences) {
        const matches = [...sentence.matchAll(PATTERNS.doi)];

        for (const match of matches) {
            const doi = match[1];
            const url = `https://doi.org/${doi}`;

            citations.push({
                fact: cleanSentence(sentence),
                ref_idx: '0',
                url,
                position: position + (match.index || 0),
                type: 'doi'
            });
        }
    }

    return citations;
}

/**
 * Split content into sentences with positions
 */
function splitIntoSentences(content: string): Array<{ text: string; position: number }> {
    const sentences: Array<{ text: string; position: number }> = [];

    // Simple sentence splitting (handles common cases)
    const pattern = /[^.!?]+[.!?]+(?:\s|$)/g;
    let match;

    while ((match = pattern.exec(content)) !== null) {
        sentences.push({
            text: match[0].trim(),
            position: match.index
        });
    }

    return sentences;
}

/**
 * Clean sentence by removing citations markers for clarity
 */
function cleanSentence(sentence: string): string {
    return sentence
        .replace(PATTERNS.numberedCitation, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalize URL for deduplication
 */
export function normalizeUrl(url: string): string {
    // Strip trailing punctuation that may be captured from text (periods, commas, semicolons)
    const cleanedUrl = url.replace(/[.,;:!?)]+$/, '');
    try {
        const parsed = new URL(cleanedUrl);
        // Remove trailing slashes, lowercase hostname
        return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
    } catch {
        return cleanedUrl.toLowerCase().replace(/\/$/, '');
    }
}

/**
 * Deduplicate citations by URL
 *
 * @param citations - Array of citations
 * @returns Map of normalized URL to array of citations
 */
export function deduplicateCitations(citations: Citation[]): Map<string, Citation[]> {
    const urlMap = new Map<string, Citation[]>();

    for (const citation of citations) {
        if (!citation.url) continue;

        const normalizedUrl = normalizeUrl(citation.url);

        if (!urlMap.has(normalizedUrl)) {
            urlMap.set(normalizedUrl, []);
        }

        urlMap.get(normalizedUrl)!.push(citation);
    }

    return urlMap;
}

/**
 * Get unique URLs from citations
 */
export function getUniqueUrls(citations: Citation[]): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];

    for (const citation of citations) {
        if (citation.url) {
            const normalized = normalizeUrl(citation.url);
            if (!seen.has(normalized)) {
                seen.add(normalized);
                urls.push(citation.url);
            }
        }
    }

    return urls;
}
