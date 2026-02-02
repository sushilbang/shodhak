/**
 * Retrieval metrics for benchmarking search quality
 */

export interface RetrievalResult {
    query: string;
    retrievedDois: string[];
    retrievedTitles: string[];
    relevantDois: string[];
    latencyMs: number;
}

export interface RetrievalMetrics {
    precision: number;
    recall: number;
    f1: number;
    mrr: number;  // Mean Reciprocal Rank
    hitRate: number;
    avgLatencyMs: number;
}

/**
 * Calculate Precision@K
 * Precision = (relevant docs retrieved) / (total docs retrieved)
 */
export function calculatePrecision(retrieved: string[], relevant: string[]): number {
    if (retrieved.length === 0) return 0;

    const relevantSet = new Set(relevant.map(d => d.toLowerCase()));
    const hits = retrieved.filter(d => relevantSet.has(d.toLowerCase())).length;

    return hits / retrieved.length;
}

/**
 * Calculate Recall@K
 * Recall = (relevant docs retrieved) / (total relevant docs)
 */
export function calculateRecall(retrieved: string[], relevant: string[]): number {
    if (relevant.length === 0) return 1; // No relevant docs means perfect recall

    const relevantSet = new Set(relevant.map(d => d.toLowerCase()));
    const hits = retrieved.filter(d => relevantSet.has(d.toLowerCase())).length;

    return hits / relevant.length;
}

/**
 * Calculate F1 Score
 * F1 = 2 * (precision * recall) / (precision + recall)
 */
export function calculateF1(precision: number, recall: number): number {
    if (precision + recall === 0) return 0;
    return 2 * (precision * recall) / (precision + recall);
}

/**
 * Calculate Mean Reciprocal Rank
 * MRR = 1 / rank of first relevant result
 */
export function calculateMRR(retrieved: string[], relevant: string[]): number {
    if (relevant.length === 0) return 1;

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
export function calculateHitRate(retrieved: string[], relevant: string[]): number {
    if (relevant.length === 0) return 1;

    const relevantSet = new Set(relevant.map(d => d.toLowerCase()));
    return retrieved.some(d => relevantSet.has(d.toLowerCase())) ? 1 : 0;
}

/**
 * Calculate keyword coverage in results
 */
export function calculateKeywordCoverage(
    titles: string[],
    abstracts: string[],
    keywords: string[]
): number {
    if (keywords.length === 0) return 1;

    const allText = [...titles, ...abstracts].join(' ').toLowerCase();
    const foundKeywords = keywords.filter(kw =>
        allText.includes(kw.toLowerCase())
    );

    return foundKeywords.length / keywords.length;
}

/**
 * Aggregate metrics across multiple queries
 */
export function aggregateMetrics(results: RetrievalMetrics[]): RetrievalMetrics & {
    count: number;
    stdDev: { precision: number; recall: number; latency: number };
} {
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

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = (arr: number[], mean: number) =>
        Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length);

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
