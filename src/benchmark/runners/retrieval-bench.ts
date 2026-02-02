/**
 * Retrieval Benchmark Runner
 * Tests the paper search functionality against ground truth
 */

import { searchService } from '../../services/search.service';
import {
    calculatePrecision,
    calculateRecall,
    calculateF1,
    calculateMRR,
    calculateHitRate,
    calculateKeywordCoverage,
    aggregateMetrics,
    RetrievalMetrics
} from '../metrics/retrieval';
import {
    printHeader,
    printSection,
    printKeyValue
} from '../utils/console-formatter';
import {
    delayBetweenQueries,
    getConfig,
    saveJsonReport
} from '../utils';
import groundTruth from '../datasets/ground-truth.json';

interface BenchmarkQuery {
    id: string;
    query: string;
    category: string;
    expected_keywords: string[];
    relevant_dois: string[];
    min_expected_results: number;
}

interface QueryResult {
    queryId: string;
    query: string;
    metrics: RetrievalMetrics;
    keywordCoverage: number;
    resultCount: number;
    latencyMs: number;
    papers: Array<{ title: string; doi?: string }>;
}

export interface RetrievalBenchmarkResult {
    timestamp: string;
    provider: string;
    totalQueries: number;
    aggregatedMetrics: ReturnType<typeof aggregateMetrics>;
    avgKeywordCoverage: number;
    avgResultCount: number;
    queryResults: QueryResult[];
}

export async function runRetrievalBenchmark(
    options: {
        limit?: number;
        verbose?: boolean;
    } = {}
): Promise<RetrievalBenchmarkResult> {
    const { limit = 10, verbose = true } = options;

    const queries = groundTruth.queries as BenchmarkQuery[];
    const queryResults: QueryResult[] = [];
    const allMetrics: RetrievalMetrics[] = [];

    printHeader('SHODHAK RETRIEVAL BENCHMARK');
    printKeyValue({
        'Provider': searchService.getPrimaryProviderName(),
        'Queries': queries.length,
        'Results per query': limit
    });

    for (const q of queries) {
        if (verbose) {
            console.log(`\n[${q.id}] "${q.query}"`);
        }

        const startTime = Date.now();

        try {
            const papers = await searchService.searchPapers(q.query, limit);
            const latencyMs = Date.now() - startTime;

            const retrievedDois = papers
                .map(p => p.doi)
                .filter((d): d is string => !!d);
            const retrievedTitles = papers.map(p => p.title);
            const abstracts = papers.map(p => p.abstract || '');

            // Calculate metrics
            const precision = calculatePrecision(retrievedDois, q.relevant_dois);
            const recall = calculateRecall(retrievedDois, q.relevant_dois);
            const f1 = calculateF1(precision, recall);
            const mrr = calculateMRR(retrievedDois, q.relevant_dois);
            const hitRate = calculateHitRate(retrievedDois, q.relevant_dois);
            const keywordCoverage = calculateKeywordCoverage(
                retrievedTitles,
                abstracts,
                q.expected_keywords
            );

            const metrics: RetrievalMetrics = {
                precision,
                recall,
                f1,
                mrr,
                hitRate,
                avgLatencyMs: latencyMs
            };

            allMetrics.push(metrics);

            const result: QueryResult = {
                queryId: q.id,
                query: q.query,
                metrics,
                keywordCoverage,
                resultCount: papers.length,
                latencyMs,
                papers: papers.slice(0, 3).map(p => ({
                    title: p.title,
                    doi: p.doi
                }))
            };

            queryResults.push(result);

            if (verbose) {
                console.log(`   Results: ${papers.length} | Latency: ${latencyMs}ms`);
                console.log(`   Keyword Coverage: ${(keywordCoverage * 100).toFixed(1)}%`);
                if (q.relevant_dois.length > 0) {
                    console.log(`   Precision: ${(precision * 100).toFixed(1)}% | Recall: ${(recall * 100).toFixed(1)}%`);
                }
            }

        } catch (error) {
            console.error(`   ERROR: ${error}`);
            queryResults.push({
                queryId: q.id,
                query: q.query,
                metrics: { precision: 0, recall: 0, f1: 0, mrr: 0, hitRate: 0, avgLatencyMs: 0 },
                keywordCoverage: 0,
                resultCount: 0,
                latencyMs: 0,
                papers: []
            });
        }

        // Rate limiting - be nice to APIs
        await delayBetweenQueries();
    }

    const aggregated = aggregateMetrics(allMetrics);
    const avgKeywordCoverage = queryResults.reduce((sum, r) => sum + r.keywordCoverage, 0) / queryResults.length;
    const avgResultCount = queryResults.reduce((sum, r) => sum + r.resultCount, 0) / queryResults.length;

    // Print summary
    printSection('BENCHMARK RESULTS');
    printKeyValue({
        'Total Queries': queries.length,
        'Avg Results/Query': avgResultCount.toFixed(1),
        'Avg Latency': `${aggregated.avgLatencyMs.toFixed(0)}ms (±${aggregated.stdDev.latency.toFixed(0)}ms)`,
        'Keyword Coverage': `${(avgKeywordCoverage * 100).toFixed(1)}%`,
        'Hit Rate': `${(aggregated.hitRate * 100).toFixed(1)}%`,
        'MRR': aggregated.mrr.toFixed(3)
    });

    if (aggregated.precision > 0 || aggregated.recall > 0) {
        console.log('\n(DOI-based metrics - limited ground truth)');
        printKeyValue({
            'Precision': `${(aggregated.precision * 100).toFixed(1)}%`,
            'Recall': `${(aggregated.recall * 100).toFixed(1)}%`,
            'F1': `${(aggregated.f1 * 100).toFixed(1)}%`
        });
    }

    return {
        timestamp: new Date().toISOString(),
        provider: searchService.getPrimaryProviderName(),
        totalQueries: queries.length,
        aggregatedMetrics: aggregated,
        avgKeywordCoverage,
        avgResultCount,
        queryResults
    };
}

// Run if called directly
if (require.main === module) {
    runRetrievalBenchmark({ verbose: true })
        .then(results => {
            const outputPath = saveJsonReport('retrieval-benchmark-results.json', results);
            console.log(`\n\nFull results saved to: ${outputPath}`);
        })
        .catch(console.error)
        .finally(() => process.exit(0));
}
