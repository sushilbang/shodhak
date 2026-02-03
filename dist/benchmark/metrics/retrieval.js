"use strict";
/**
 * Retrieval metrics for benchmarking search quality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePrecision = calculatePrecision;
exports.calculateRecall = calculateRecall;
exports.calculateF1 = calculateF1;
exports.calculateMRR = calculateMRR;
exports.calculateHitRate = calculateHitRate;
exports.calculateKeywordCoverage = calculateKeywordCoverage;
exports.aggregateMetrics = aggregateMetrics;
/**
 * Calculate Precision@K
 * Precision = (relevant docs retrieved) / (total docs retrieved)
 */
function calculatePrecision(retrieved, relevant) {
    if (retrieved.length === 0)
        return 0;
    const relevantSet = new Set(relevant.map(d => d.toLowerCase()));
    const hits = retrieved.filter(d => relevantSet.has(d.toLowerCase())).length;
    return hits / retrieved.length;
}
/**
 * Calculate Recall@K
 * Recall = (relevant docs retrieved) / (total relevant docs)
 */
function calculateRecall(retrieved, relevant) {
    if (relevant.length === 0)
        return 1; // No relevant docs means perfect recall
    const relevantSet = new Set(relevant.map(d => d.toLowerCase()));
    const hits = retrieved.filter(d => relevantSet.has(d.toLowerCase())).length;
    return hits / relevant.length;
}
/**
 * Calculate F1 Score
 * F1 = 2 * (precision * recall) / (precision + recall)
 */
function calculateF1(precision, recall) {
    if (precision + recall === 0)
        return 0;
    return 2 * (precision * recall) / (precision + recall);
}
/**
 * Calculate Mean Reciprocal Rank
 * MRR = 1 / rank of first relevant result
 */
function calculateMRR(retrieved, relevant) {
    if (relevant.length === 0)
        return 1;
    const relevantSet = new Set(relevant.map(d => d.toLowerCase()));
    for (let i = 0; i < retrieved.length; i++) {
        if (relevantSet.has(retrieved[i].toLowerCase())) {
            return 1 / (i + 1);
        }
    }
    return 0;
}
/**
 * Calculate Hit Rate (did we find at least one relevant result?)
 */
function calculateHitRate(retrieved, relevant) {
    if (relevant.length === 0)
        return 1;
    const relevantSet = new Set(relevant.map(d => d.toLowerCase()));
    return retrieved.some(d => relevantSet.has(d.toLowerCase())) ? 1 : 0;
}
/**
 * Calculate keyword coverage in results
 */
function calculateKeywordCoverage(titles, abstracts, keywords) {
    if (keywords.length === 0)
        return 1;
    const allText = [...titles, ...abstracts].join(' ').toLowerCase();
    const foundKeywords = keywords.filter(kw => allText.includes(kw.toLowerCase()));
    return foundKeywords.length / keywords.length;
}
/**
 * Aggregate metrics across multiple queries
 */
function aggregateMetrics(results) {
    if (results.length === 0) {
        return {
            precision: 0,
            recall: 0,
            f1: 0,
            mrr: 0,
            hitRate: 0,
            avgLatencyMs: 0,
            count: 0,
            stdDev: { precision: 0, recall: 0, latency: 0 }
        };
    }
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = (arr, mean) => Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length);
    const precisions = results.map(r => r.precision);
    const recalls = results.map(r => r.recall);
    const latencies = results.map(r => r.avgLatencyMs);
    const avgPrecision = avg(precisions);
    const avgRecall = avg(recalls);
    const avgLatency = avg(latencies);
    return {
        precision: avgPrecision,
        recall: avgRecall,
        f1: calculateF1(avgPrecision, avgRecall),
        mrr: avg(results.map(r => r.mrr)),
        hitRate: avg(results.map(r => r.hitRate)),
        avgLatencyMs: avgLatency,
        count: results.length,
        stdDev: {
            precision: stdDev(precisions, avgPrecision),
            recall: stdDev(recalls, avgRecall),
            latency: stdDev(latencies, avgLatency)
        }
    };
}
