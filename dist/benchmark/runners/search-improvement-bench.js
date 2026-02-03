"use strict";
/**
 * Search Improvement Benchmark
 *
 * Compares basic search vs enhanced search (with query expansion + re-ranking)
 * to measure improvement in precision, recall, and result quality.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSearchImprovementBenchmark = runSearchImprovementBenchmark;
const enhanced_search_service_1 = require("../../services/enhanced-search.service");
const retrieval_1 = require("../metrics/retrieval");
const utils_1 = require("../utils");
const ground_truth_json_1 = __importDefault(require("../datasets/ground-truth.json"));
async function runSearchImprovementBenchmark(options = {}) {
    const { limit = 10, verbose = true } = options;
    const queries = ground_truth_json_1.default.queries;
    const results = [];
    (0, utils_1.printHeader)('SEARCH IMPROVEMENT BENCHMARK', 60);
    console.log('Basic Search vs Enhanced (Expansion + Re-ranking)\n');
    (0, utils_1.printKeyValue)({
        'Queries': queries.length,
        'Results per query': limit
    });
    console.log();
    for (const q of queries) {
        if (verbose) {
            console.log(`\n[${q.id}] "${q.query}"`);
        }
        try {
            // Run comparison
            const comparison = await enhanced_search_service_1.enhancedSearchService.compareSearch(q.query, limit);
            const basicPapers = comparison.basic.papers;
            const enhancedPapers = comparison.enhanced.papers;
            // Calculate metrics for basic
            const basicDois = basicPapers.map(p => p.doi).filter((d) => !!d);
            const basicTitles = basicPapers.map(p => p.title);
            const basicAbstracts = basicPapers.map(p => p.abstract || '');
            const basicKeywordCov = (0, retrieval_1.calculateKeywordCoverage)(basicTitles, basicAbstracts, q.expected_keywords);
            const basicPrecision = (0, retrieval_1.calculatePrecision)(basicDois, q.relevant_dois);
            const basicRecall = (0, retrieval_1.calculateRecall)(basicDois, q.relevant_dois);
            const basicMRR = (0, retrieval_1.calculateMRR)(basicDois, q.relevant_dois);
            // Calculate metrics for enhanced
            const enhancedDois = enhancedPapers.map(p => p.doi).filter((d) => !!d);
            const enhancedTitles = enhancedPapers.map(p => p.title);
            const enhancedAbstracts = enhancedPapers.map(p => p.abstract || '');
            const enhancedKeywordCov = (0, retrieval_1.calculateKeywordCoverage)(enhancedTitles, enhancedAbstracts, q.expected_keywords);
            const enhancedPrecision = (0, retrieval_1.calculatePrecision)(enhancedDois, q.relevant_dois);
            const enhancedRecall = (0, retrieval_1.calculateRecall)(enhancedDois, q.relevant_dois);
            const enhancedMRR = (0, retrieval_1.calculateMRR)(enhancedDois, q.relevant_dois);
            // Count new papers found
            const basicDoiSet = new Set(basicDois);
            const newPapers = enhancedDois.filter(doi => !basicDoiSet.has(doi)).length;
            // Count reranked papers
            const rerankedCount = comparison.comparison.rankChanges;
            const result = {
                queryId: q.id,
                query: q.query,
                basic: {
                    resultCount: basicPapers.length,
                    keywordCoverage: basicKeywordCov,
                    precision: basicPrecision,
                    recall: basicRecall,
                    mrr: basicMRR,
                    latencyMs: comparison.basic.latencyMs,
                    topTitles: basicTitles.slice(0, 3)
                },
                enhanced: {
                    resultCount: enhancedPapers.length,
                    keywordCoverage: enhancedKeywordCov,
                    precision: enhancedPrecision,
                    recall: enhancedRecall,
                    mrr: enhancedMRR,
                    latencyMs: comparison.enhanced.metadata.latencyMs,
                    topTitles: enhancedTitles.slice(0, 3),
                    expansionTerms: comparison.enhanced.metadata.queryVariants || [],
                    rerankedCount
                },
                improvement: {
                    keywordCoverage: (enhancedKeywordCov - basicKeywordCov) * 100,
                    precision: (enhancedPrecision - basicPrecision) * 100,
                    recall: (enhancedRecall - basicRecall) * 100,
                    mrr: enhancedMRR - basicMRR,
                    latencyChange: comparison.basic.latencyMs > 0
                        ? ((comparison.enhanced.metadata.latencyMs - comparison.basic.latencyMs) / comparison.basic.latencyMs) * 100
                        : 0,
                    newPapersFound: newPapers
                }
            };
            results.push(result);
            if (verbose) {
                const kcDelta = result.improvement.keywordCoverage;
                const kcSign = kcDelta >= 0 ? '+' : '';
                console.log(`   Basic:    ${basicPapers.length} papers, KC: ${(basicKeywordCov * 100).toFixed(1)}%, ${comparison.basic.latencyMs}ms`);
                console.log(`   Enhanced: ${enhancedPapers.length} papers, KC: ${(enhancedKeywordCov * 100).toFixed(1)}%, ${comparison.enhanced.metadata.latencyMs}ms`);
                console.log(`   Δ KC: ${kcSign}${kcDelta.toFixed(1)}pp | Reranked: ${rerankedCount} | New papers: ${newPapers}`);
            }
        }
        catch (error) {
            console.error(`   ERROR: ${error}`);
        }
        // Rate limiting
        await (0, utils_1.delayBetweenAPICalls)();
    }
    // Calculate summary
    const summary = calculateSummary(results);
    // Print summary table
    printSummary(summary, results);
    return {
        timestamp: new Date().toISOString(),
        totalQueries: queries.length,
        summary,
        results
    };
}
function calculateSummary(results) {
    if (results.length === 0) {
        return {
            avgKeywordCoverageImprovement: 0,
            avgPrecisionImprovement: 0,
            avgRecallImprovement: 0,
            avgMRRImprovement: 0,
            avgLatencyChange: 0,
            avgNewPapersFound: 0,
            queriesImproved: 0,
            queriesUnchanged: 0,
            queriesDegraded: 0
        };
    }
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const kcImprovements = results.map(r => r.improvement.keywordCoverage);
    const precImprovements = results.map(r => r.improvement.precision);
    const recallImprovements = results.map(r => r.improvement.recall);
    const mrrImprovements = results.map(r => r.improvement.mrr);
    const latencyChanges = results.map(r => r.improvement.latencyChange);
    const newPapers = results.map(r => r.improvement.newPapersFound);
    // Count improved/degraded based on keyword coverage
    const improved = results.filter(r => r.improvement.keywordCoverage > 1).length;
    const degraded = results.filter(r => r.improvement.keywordCoverage < -1).length;
    const unchanged = results.length - improved - degraded;
    return {
        avgKeywordCoverageImprovement: avg(kcImprovements),
        avgPrecisionImprovement: avg(precImprovements),
        avgRecallImprovement: avg(recallImprovements),
        avgMRRImprovement: avg(mrrImprovements),
        avgLatencyChange: avg(latencyChanges),
        avgNewPapersFound: avg(newPapers),
        queriesImproved: improved,
        queriesUnchanged: unchanged,
        queriesDegraded: degraded
    };
}
function printSummary(summary, results) {
    (0, utils_1.printHeader)('IMPROVEMENT SUMMARY', 60);
    const avgBasicKC = results.reduce((sum, r) => sum + r.basic.keywordCoverage, 0) / results.length;
    const avgEnhancedKC = results.reduce((sum, r) => sum + r.enhanced.keywordCoverage, 0) / results.length;
    const avgBasicLat = results.reduce((sum, r) => sum + r.basic.latencyMs, 0) / results.length;
    const avgEnhancedLat = results.reduce((sum, r) => sum + r.enhanced.latencyMs, 0) / results.length;
    const avgBasicMRR = results.reduce((sum, r) => sum + r.basic.mrr, 0) / results.length;
    const avgEnhancedMRR = results.reduce((sum, r) => sum + r.enhanced.mrr, 0) / results.length;
    const tableColumns = [
        { header: 'Metric', width: 24, align: 'left' },
        { header: 'Basic', width: 10, align: 'right' },
        { header: 'Enhanced', width: 10, align: 'right' },
        { header: 'Change', width: 10, align: 'right' }
    ];
    const tableRows = [
        ['Keyword Coverage', `${(avgBasicKC * 100).toFixed(1)}%`, `${(avgEnhancedKC * 100).toFixed(1)}%`, `${formatDelta(summary.avgKeywordCoverageImprovement)}pp`],
        ['Latency', `${avgBasicLat.toFixed(0)}ms`, `${avgEnhancedLat.toFixed(0)}ms`, `${formatDelta(summary.avgLatencyChange)}%`],
        ['MRR', avgBasicMRR.toFixed(3), avgEnhancedMRR.toFixed(3), formatDelta(summary.avgMRRImprovement * 100)]
    ];
    (0, utils_1.printTable)(tableColumns, tableRows);
    console.log('\nQuery Outcomes:');
    console.log(`  ✓ Improved:  ${summary.queriesImproved}/${results.length} queries`);
    console.log(`  ○ Unchanged: ${summary.queriesUnchanged}/${results.length} queries`);
    console.log(`  ✗ Degraded:  ${summary.queriesDegraded}/${results.length} queries`);
    console.log(`\nAvg new papers found per query: ${summary.avgNewPapersFound.toFixed(1)}`);
    // Verdict
    if (summary.avgKeywordCoverageImprovement > 5) {
        (0, utils_1.printVerdict)('success', 'Enhanced search shows significant improvement');
    }
    else if (summary.avgKeywordCoverageImprovement > 0) {
        (0, utils_1.printVerdict)('warning', 'Enhanced search shows marginal improvement');
    }
    else {
        (0, utils_1.printVerdict)('failure', 'Enhanced search did not improve results');
    }
}
function formatDelta(value) {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}`.padStart(6);
}
// Run if called directly
if (require.main === module) {
    runSearchImprovementBenchmark({ verbose: true })
        .then(report => {
        const outputPath = (0, utils_1.saveJsonReport)('search-improvement-report.json', report);
        console.log(`\nReport saved to: ${outputPath}`);
    })
        .catch(console.error)
        .finally(() => process.exit(0));
}
