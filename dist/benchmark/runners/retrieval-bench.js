"use strict";
/**
 * Retrieval Benchmark Runner
 * Tests the paper search functionality against ground truth
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRetrievalBenchmark = runRetrievalBenchmark;
const search_service_1 = require("../../services/search.service");
const retrieval_1 = require("../metrics/retrieval");
const console_formatter_1 = require("../utils/console-formatter");
const utils_1 = require("../utils");
const ground_truth_json_1 = __importDefault(require("../datasets/ground-truth.json"));
async function runRetrievalBenchmark(options = {}) {
    const { limit = 10, verbose = true } = options;
    const queries = ground_truth_json_1.default.queries;
    const queryResults = [];
    const allMetrics = [];
    (0, console_formatter_1.printHeader)('SHODHAK RETRIEVAL BENCHMARK');
    (0, console_formatter_1.printKeyValue)({
        'Provider': search_service_1.searchService.getPrimaryProviderName(),
        'Queries': queries.length,
        'Results per query': limit
    });
    for (const q of queries) {
        if (verbose) {
            console.log(`\n[${q.id}] "${q.query}"`);
        }
        const startTime = Date.now();
        try {
            const papers = await search_service_1.searchService.searchPapers(q.query, limit);
            const latencyMs = Date.now() - startTime;
            const retrievedDois = papers
                .map(p => p.doi)
                .filter((d) => !!d);
            const retrievedTitles = papers.map(p => p.title);
            const abstracts = papers.map(p => p.abstract || '');
            // Calculate metrics
            const precision = (0, retrieval_1.calculatePrecision)(retrievedDois, q.relevant_dois);
            const recall = (0, retrieval_1.calculateRecall)(retrievedDois, q.relevant_dois);
            const f1 = (0, retrieval_1.calculateF1)(precision, recall);
            const mrr = (0, retrieval_1.calculateMRR)(retrievedDois, q.relevant_dois);
            const hitRate = (0, retrieval_1.calculateHitRate)(retrievedDois, q.relevant_dois);
            const keywordCoverage = (0, retrieval_1.calculateKeywordCoverage)(retrievedTitles, abstracts, q.expected_keywords);
            const metrics = {
                precision,
                recall,
                f1,
                mrr,
                hitRate,
                avgLatencyMs: latencyMs
            };
            allMetrics.push(metrics);
            const result = {
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
        }
        catch (error) {
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
        await (0, utils_1.delayBetweenQueries)();
    }
    const aggregated = (0, retrieval_1.aggregateMetrics)(allMetrics);
    const avgKeywordCoverage = queryResults.reduce((sum, r) => sum + r.keywordCoverage, 0) / queryResults.length;
    const avgResultCount = queryResults.reduce((sum, r) => sum + r.resultCount, 0) / queryResults.length;
    // Print summary
    (0, console_formatter_1.printSection)('BENCHMARK RESULTS');
    (0, console_formatter_1.printKeyValue)({
        'Total Queries': queries.length,
        'Avg Results/Query': avgResultCount.toFixed(1),
        'Avg Latency': `${aggregated.avgLatencyMs.toFixed(0)}ms (±${aggregated.stdDev.latency.toFixed(0)}ms)`,
        'Keyword Coverage': `${(avgKeywordCoverage * 100).toFixed(1)}%`,
        'Hit Rate': `${(aggregated.hitRate * 100).toFixed(1)}%`,
        'MRR': aggregated.mrr.toFixed(3)
    });
    if (aggregated.precision > 0 || aggregated.recall > 0) {
        console.log('\n(DOI-based metrics - limited ground truth)');
        (0, console_formatter_1.printKeyValue)({
            'Precision': `${(aggregated.precision * 100).toFixed(1)}%`,
            'Recall': `${(aggregated.recall * 100).toFixed(1)}%`,
            'F1': `${(aggregated.f1 * 100).toFixed(1)}%`
        });
    }
    return {
        timestamp: new Date().toISOString(),
        provider: search_service_1.searchService.getPrimaryProviderName(),
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
        const outputPath = (0, utils_1.saveJsonReport)('retrieval-benchmark-results.json', results);
        console.log(`\n\nFull results saved to: ${outputPath}`);
    })
        .catch(console.error)
        .finally(() => process.exit(0));
}
