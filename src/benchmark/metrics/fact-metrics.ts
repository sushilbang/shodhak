/**
 * FACT Framework - Citation accuracy evaluation metrics
 *
 * Implements the FACT (Factual Accuracy through Citation Testing) framework
 * from DeepResearch-Bench for evaluating citation accuracy in research reports.
 *
 * Key features:
 * - Citation extraction from markdown reports
 * - URL deduplication to avoid redundant validation
 * - Web content scraping via Jina API
 * - LLM-based claim validation against source content
 *
 * Citation validation categories:
 * - SUPPORTED: The claim is directly supported by the cited source
 * - UNSUPPORTED: The claim contradicts or is not found in the source
 * - UNKNOWN: Unable to determine (source unavailable, ambiguous, etc.)
 */

import { createFastClient } from '../utils/llm-client.factory';
import {
    Citation,
    extractCitations,
    deduplicateCitations,
    getUniqueUrls,
    normalizeUrl
} from '../utils/citation-extractor';
import { scrapeUrl, scrapeForValidation, isJinaConfigured } from '../utils/web-scraper';

// ============================================================================
// INTERFACES
// ============================================================================

export type ValidationStatus = 'supported' | 'unsupported' | 'unknown';

export interface CitationValidation {
    /** The original citation */
    citation: Citation;
    /** Validation result */
    status: ValidationStatus;
    /** Confidence score (0-1) */
    confidence: number;
    /** Explanation from the validator */
    explanation: string;
    /** Source content snippet used for validation */
    sourceSnippet?: string;
    /** Whether the source URL was accessible */
    sourceAccessible: boolean;
}

export interface FACTResult {
    /** Total number of citations found */
    totalCitations: number;
    /** Number of citations that could be validated (source accessible) */
    validatableCitations: number;
    /** Number of citations validated as accurate */
    effectiveCitations: number;
    /** Citation accuracy score */
    citationAccuracy: number;
    /** Support rate (supported / validatable) */
    supportRate: number;
    /** Breakdown by validation status */
    statusBreakdown: {
        supported: number;
        unsupported: number;
        unknown: number;
    };
    /** Per-citation validation results */
    validations: CitationValidation[];
    /** URLs that were scraped */
    scrapedUrls: string[];
    /** URLs that failed to scrape */
    failedUrls: string[];
}

export interface FACTEvaluationResult {
    report: string;
    result: FACTResult;
    evaluationModel: string;
    timestamp: string;
}

// ============================================================================
// MAIN EVALUATION FUNCTION
// ============================================================================

/**
 * Evaluate citation accuracy for a research report using the FACT framework
 *
 * @param report - The research report content (markdown)
 * @param options - Evaluation options
 * @returns FACT evaluation result
 */
export async function evaluateCitationAccuracy(
    report: string,
    options: {
        /** Maximum citations to validate (for cost control) */
        maxCitations?: number;
        /** Skip URL scraping and use provided content map */
        urlContentMap?: Map<string, string>;
        /** Map from reference index (e.g. "1") to URL for numbered citations */
        paperUrlMap?: Map<string, string>;
        /** Map from reference index (e.g. "1") to paper abstract for fallback validation */
        paperAbstractMap?: Map<string, string>;
        /** Verbose logging */
        verbose?: boolean;
    } = {}
): Promise<FACTResult> {
    const { maxCitations = 50, urlContentMap, paperUrlMap, paperAbstractMap, verbose = false } = options;

    // Step 1: Extract citations from the report
    const extraction = extractCitations(report);

    // Step 1b: Resolve empty URLs using paperUrlMap (from retrieved papers)
    if (paperUrlMap) {
        let resolved = 0;
        for (const citation of extraction.citations) {
            if (!citation.url && citation.ref_idx && citation.ref_idx !== '0') {
                const mappedUrl = paperUrlMap.get(citation.ref_idx);
                if (mappedUrl) {
                    citation.url = mappedUrl;
                    resolved++;
                }
            }
        }
        if (verbose && resolved > 0) {
            console.log(`Resolved ${resolved} citation URLs from paper metadata`);
        }
    }

    if (verbose) {
        console.log(`Extracted ${extraction.citations.length} citations`);
        console.log(`  - Numbered: ${extraction.stats.numberedCitations}`);
        console.log(`  - Inline URLs: ${extraction.stats.inlineUrlCitations}`);
        console.log(`  - DOIs: ${extraction.stats.doiCitations}`);
        const withUrls = extraction.citations.filter(c => c.url).length;
        console.log(`  - With resolvable URLs: ${withUrls}`);
    }

    // Step 2: Deduplicate citations by URL
    const dedupedMap = deduplicateCitations(extraction.citations);
    const uniqueUrls = getUniqueUrls(extraction.citations);

    if (verbose) {
        console.log(`Unique URLs to validate: ${uniqueUrls.length}`);
    }

    // Limit citations if needed
    const citationsToValidate = extraction.citations.slice(0, maxCitations);

    // Step 3: Scrape URL content (or use provided content)
    let contentMap: Map<string, string>;
    const failedUrls: string[] = [];
    const scrapedUrls: string[] = [];

    if (urlContentMap) {
        contentMap = urlContentMap;
    } else {
        contentMap = new Map();

        if (!isJinaConfigured()) {
            console.warn('JINA_API_KEY not configured. URL scraping disabled.');
        } else {
            // Scrape unique URLs
            const urlsToScrape = uniqueUrls.slice(0, Math.min(uniqueUrls.length, maxCitations));

            for (const url of urlsToScrape) {
                if (verbose) {
                    console.log(`Scraping: ${url}`);
                }

                const content = await scrapeForValidation(url);

                if (content && !isBlockedContent(content)) {
                    contentMap.set(normalizeUrl(url), content);
                    scrapedUrls.push(url);
                } else {
                    if (verbose && content) {
                        console.log(`   Blocked (403/CAPTCHA): ${url}`);
                    }
                    failedUrls.push(url);
                }

                // Rate limiting
                await delay(500);
            }
        }
    }

    // Step 4: Validate each citation
    const validations: CitationValidation[] = [];

    for (const citation of citationsToValidate) {
        if (!citation.url) {
            // No URL — try abstract fallback
            const abstractContent = paperAbstractMap?.get(citation.ref_idx || '');
            if (abstractContent) {
                const validation = await validateCitation(citation, abstractContent);
                // Mark as abstract-based validation
                validation.explanation = `[Validated against abstract] ${validation.explanation}`;
                validations.push(validation);
                await delay(200);
            } else {
                validations.push({
                    citation,
                    status: 'unknown',
                    confidence: 0,
                    explanation: 'No URL associated with citation',
                    sourceAccessible: false
                });
            }
            continue;
        }

        const normalizedUrl = normalizeUrl(citation.url);
        let sourceContent = contentMap.get(normalizedUrl);

        // Check if the scraped content is actually an error page
        // If so, treat it as missing and fall back to abstract
        if (sourceContent && isBlockedContent(sourceContent)) {
            if (verbose) {
                console.log(`   Scraped content for [${citation.ref_idx}] is an error page, discarding`);
            }
            sourceContent = undefined;
        }

        // If URL scraping failed or returned junk, try abstract fallback
        if (!sourceContent && paperAbstractMap && citation.ref_idx) {
            const abstractContent = paperAbstractMap.get(citation.ref_idx);
            if (abstractContent) {
                sourceContent = abstractContent;
                if (verbose) {
                    console.log(`   Using abstract fallback for citation [${citation.ref_idx}]`);
                }
            }
        }

        if (!sourceContent) {
            validations.push({
                citation,
                status: 'unknown',
                confidence: 0,
                explanation: 'Source URL not accessible and no abstract available',
                sourceAccessible: false
            });
            continue;
        }

        // Validate the citation against source content
        const validation = await validateCitation(citation, sourceContent);
        validations.push(validation);

        // Rate limit between LLM calls
        await delay(200);
    }

    // Step 5: Calculate metrics
    const supported = validations.filter(v => v.status === 'supported').length;
    const unsupported = validations.filter(v => v.status === 'unsupported').length;
    const unknown = validations.filter(v => v.status === 'unknown').length;
    const validatable = validations.filter(v => v.sourceAccessible).length;

    const citationAccuracy = extraction.citations.length > 0
        ? supported / extraction.citations.length
        : 0;

    const supportRate = validatable > 0
        ? supported / validatable
        : 0;

    return {
        totalCitations: extraction.citations.length,
        validatableCitations: validatable,
        effectiveCitations: supported,
        citationAccuracy,
        supportRate,
        statusBreakdown: {
            supported,
            unsupported,
            unknown
        },
        validations,
        scrapedUrls,
        failedUrls
    };
}

/**
 * Validate a single citation against source content
 */
export async function validateCitation(
    citation: Citation,
    sourceContent: string
): Promise<CitationValidation> {
    // Use fast model (Llama 3.3 70B) for validation — much lower token usage
    const { client, model } = createFastClient();

    // Truncate source content to save tokens
    const truncatedSource = sourceContent.slice(0, 4000);

    const prompt = `You are a fact-checker evaluating whether a claim is supported by a source document.

CLAIM TO VERIFY:
"${citation.fact}"

SOURCE DOCUMENT CONTENT:
${truncatedSource}
${sourceContent.length > 4000 ? '\n[... content truncated ...]' : ''}

TASK:
Determine if the claim is supported by the source document.

RESPONSE FORMAT (JSON):
{
  "status": "supported" | "unsupported" | "unknown",
  "confidence": 0.0-1.0,
  "explanation": "Brief explanation of your determination"
}

GUIDELINES:
- "supported": The claim's key facts are directly stated or strongly implied in the source. If the claim is a reasonable generalization or paraphrase of source content, mark as "supported".
- "unsupported": The claim directly contradicts the source content.
- "unknown": The source doesn't address this topic at all.
- If the source is an abstract or summary, evaluate whether the claim is consistent with the described research — do not require exact details that abstracts typically omit.
- Exact wording match is NOT required — judge semantic alignment.
- When in doubt between "supported" and "unknown", lean toward "supported" if the source addresses the same topic and the claim is reasonable.`;

    try {
        const response = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('Empty response');
        }

        const parsed = JSON.parse(content) as {
            status: ValidationStatus;
            confidence: number;
            explanation: string;
        };

        return {
            citation,
            status: parsed.status,
            confidence: Math.max(0, Math.min(1, parsed.confidence)),
            explanation: parsed.explanation,
            sourceSnippet: truncatedSource.slice(0, 500),
            sourceAccessible: true
        };
    } catch (error) {
        const errorStr = String(error);
        // Rate limit (429) or API errors — mark as NOT accessible
        // so they don't count against the support rate denominator
        const isRateLimit = errorStr.includes('429') || errorStr.includes('Rate limit');
        return {
            citation,
            status: 'unknown',
            confidence: 0,
            explanation: `Validation error: ${error}`,
            sourceAccessible: !isRateLimit
        };
    }
}

/**
 * Quick citation extraction without full validation
 * Useful for getting statistics before running full evaluation
 */
export function extractCitationStats(report: string): {
    totalCitations: number;
    uniqueUrls: number;
    breakdown: {
        numbered: number;
        inlineUrl: number;
        doi: number;
    };
    sampleUrls: string[];
} {
    const extraction = extractCitations(report);

    return {
        totalCitations: extraction.citations.length,
        uniqueUrls: extraction.stats.uniqueUrls,
        breakdown: {
            numbered: extraction.stats.numberedCitations,
            inlineUrl: extraction.stats.inlineUrlCitations,
            doi: extraction.stats.doiCitations
        },
        sampleUrls: getUniqueUrls(extraction.citations).slice(0, 5)
    };
}

// ============================================================================
// AGGREGATION FUNCTIONS
// ============================================================================

/**
 * Aggregate FACT results across multiple evaluations
 */
export function aggregateFACTResults(results: FACTResult[]): {
    avgCitationAccuracy: number;
    avgSupportRate: number;
    totalCitations: number;
    totalSupported: number;
    totalUnsupported: number;
    totalUnknown: number;
    totalEvaluations: number;
} {
    if (results.length === 0) {
        return {
            avgCitationAccuracy: 0,
            avgSupportRate: 0,
            totalCitations: 0,
            totalSupported: 0,
            totalUnsupported: 0,
            totalUnknown: 0,
            totalEvaluations: 0
        };
    }

    let totalCitations = 0;
    let totalSupported = 0;
    let totalUnsupported = 0;
    let totalUnknown = 0;

    for (const result of results) {
        totalCitations += result.totalCitations;
        totalSupported += result.statusBreakdown.supported;
        totalUnsupported += result.statusBreakdown.unsupported;
        totalUnknown += result.statusBreakdown.unknown;
    }

    const avgCitationAccuracy = results.reduce((sum, r) => sum + r.citationAccuracy, 0) / results.length;
    const avgSupportRate = results.reduce((sum, r) => sum + r.supportRate, 0) / results.length;

    return {
        avgCitationAccuracy,
        avgSupportRate,
        totalCitations,
        totalSupported,
        totalUnsupported,
        totalUnknown,
        totalEvaluations: results.length
    };
}

/**
 * Convert FACT accuracy to letter grade
 */
export function factScoreToGrade(accuracy: number): string {
    if (accuracy >= 0.9) return 'A+';
    if (accuracy >= 0.8) return 'A';
    if (accuracy >= 0.7) return 'B';
    if (accuracy >= 0.6) return 'C';
    if (accuracy >= 0.5) return 'D';
    return 'F';
}

/**
 * Generate FACT evaluation summary
 */
export function generateFACTSummary(result: FACTResult): {
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
} {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Analyze citation accuracy
    if (result.citationAccuracy >= 0.8) {
        strengths.push(`High citation accuracy (${(result.citationAccuracy * 100).toFixed(1)}%)`);
    } else if (result.citationAccuracy < 0.5) {
        weaknesses.push(`Low citation accuracy (${(result.citationAccuracy * 100).toFixed(1)}%)`);
        recommendations.push('Review and verify citations before finalizing reports');
    }

    // Analyze support rate
    if (result.supportRate >= 0.9) {
        strengths.push(`Excellent support rate among validatable citations (${(result.supportRate * 100).toFixed(1)}%)`);
    } else if (result.supportRate < 0.6) {
        weaknesses.push(`Many citations not supported by sources (${((1 - result.supportRate) * 100).toFixed(1)}% unsupported)`);
        recommendations.push('Implement citation verification in the generation pipeline');
    }

    // Analyze URL accessibility
    const accessibilityRate = result.validatableCitations / result.totalCitations;
    if (accessibilityRate < 0.7 && result.totalCitations > 0) {
        weaknesses.push(`Many citation URLs not accessible (${((1 - accessibilityRate) * 100).toFixed(1)}%)`);
        recommendations.push('Use more stable URL sources (DOIs, arXiv links)');
    }

    // Analyze citation count
    if (result.totalCitations >= 10) {
        strengths.push(`Good citation density (${result.totalCitations} citations)`);
    } else if (result.totalCitations < 3) {
        weaknesses.push(`Few citations (${result.totalCitations})`);
        recommendations.push('Encourage more citations to support claims');
    }

    return { strengths, weaknesses, recommendations };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Delay execution
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if scraped content is actually a blocked/error page
 * rather than real paper content.
 * Detects: 403/CAPTCHA, 404 Not Found, paywalls, and other error pages.
 */
export function isBlockedContent(content: string): boolean {
    const lowerContent = content.toLowerCase();
    const blockedIndicators = [
        // 403 / CAPTCHA
        'verify you are human',
        'captcha',
        'access denied',
        'error 403',
        '403 forbidden',
        'please complete the security check',
        'just a moment',
        'checking your browser',
        'enable javascript and cookies',
        'ray id',
        // 404 / Not Found
        'error 404',
        '404 not found',
        'page not found',
        'not recognized',
        'identifier not recognized',
        'article not found',
        'no document with doi',
        // Paywalls / access walls
        'subscribe to read',
        'purchase this article',
        'sign in to access',
        'institutional access',
        // Generic error indicators
        'target url returned error',
        'warning: target url returned error'
    ];

    // For short content (< 3000 chars), check for blocked indicators
    // Real paper content is typically much longer
    if (content.length < 3000) {
        return blockedIndicators.some(indicator => lowerContent.includes(indicator));
    }

    // Even for longer content, check if the content starts with error markers
    // (some error pages include long boilerplate)
    const firstChunk = lowerContent.slice(0, 1000);
    const strongIndicators = [
        'target url returned error',
        'identifier not recognized',
        'verify you are human',
        'captcha',
        '403 forbidden',
        '404 not found'
    ];
    return strongIndicators.some(indicator => firstChunk.includes(indicator));
}

/**
 * Check if FACT evaluation is available (Jina configured)
 */
export function isFACTAvailable(): boolean {
    return isJinaConfigured();
}
