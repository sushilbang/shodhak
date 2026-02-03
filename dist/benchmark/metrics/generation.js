"use strict";
/**
 * Generation quality metrics for benchmarking LLM outputs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCitations = extractCitations;
exports.calculateCitationDensity = calculateCitationDensity;
exports.calculateCitationCoverage = calculateCitationCoverage;
exports.calculateRouge1 = calculateRouge1;
exports.detectHallucinatedCitations = detectHallucinatedCitations;
exports.aggregateGenerationMetrics = aggregateGenerationMetrics;
/**
 * Count words in text
 */
function wordCount(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}
/**
 * Extract citation indices from text [0], [1], etc.
 */
function extractCitations(text) {
    const matches = text.match(/\[(\d+)\]/g) || [];
    return [...new Set(matches.map(m => parseInt(m.replace(/[\[\]]/g, ''))))];
}
/**
 * Calculate citation density (citations per 100 words)
 */
function calculateCitationDensity(text) {
    const words = wordCount(text);
    if (words === 0)
        return 0;
    const citations = (text.match(/\[\d+\]/g) || []).length;
    return (citations / words) * 100;
}
/**
 * Calculate what percentage of available papers were cited
 * Note: Citations are 1-indexed [1], [2]... so valid range is 1 to totalPapers
 */
function calculateCitationCoverage(text, totalPapers) {
    if (totalPapers === 0)
        return 1;
    const citedPapers = extractCitations(text);
    // Citations are 1-indexed, so valid range is [1, totalPapers]
    const validCitations = citedPapers.filter(c => c >= 1 && c <= totalPapers);
    return validCitations.length / totalPapers;
}
/**
 * Simple ROUGE-1 approximation (unigram overlap)
 * For proper ROUGE, use a dedicated library
 */
function calculateRouge1(generated, reference) {
    const genTokens = generated.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const refTokens = reference.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (genTokens.length === 0 || refTokens.length === 0) {
        return { precision: 0, recall: 0, f1: 0 };
    }
    const refSet = new Set(refTokens);
    const overlap = genTokens.filter(t => refSet.has(t)).length;
    const precision = overlap / genTokens.length;
    const recall = overlap / refTokens.length;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return { precision, recall, f1 };
}
/**
 * Check if generated text contains hallucinated citations
 * (citations to papers that don't exist in context)
 * Note: LLM uses 1-indexed citations [1], [2]... so valid range is 1 to totalPapers
 */
function detectHallucinatedCitations(text, totalPapers) {
    const citations = extractCitations(text);
    // Citations are 1-indexed in the prompts, so valid range is [1, totalPapers]
    return citations.filter(c => c < 1 || c > totalPapers);
}
/**
 * Aggregate generation metrics
 */
function aggregateGenerationMetrics(results) {
    if (results.length === 0) {
        return {
            avgLength: 0,
            citationDensity: 0,
            citationCoverage: 0,
            uniqueCitations: 0,
            avgLatencyMs: 0
        };
    }
    const lengths = results.map(r => wordCount(r.generatedText));
    const densities = results.map(r => calculateCitationDensity(r.generatedText));
    const coverages = results.map(r => calculateCitationCoverage(r.generatedText, r.paperCount));
    const uniqueCits = results.map(r => extractCitations(r.generatedText).length);
    const latencies = results.map(r => r.latencyMs);
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
        avgLength: avg(lengths),
        citationDensity: avg(densities),
        citationCoverage: avg(coverages),
        uniqueCitations: avg(uniqueCits),
        avgLatencyMs: avg(latencies)
    };
}
