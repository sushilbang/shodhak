"use strict";
/**
 * Generation Benchmark Runner
 * Tests the LLM generation quality (summaries, reviews, comparisons)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGenerationBenchmark = runGenerationBenchmark;
const search_service_1 = require("../../services/search.service");
const llm_service_1 = require("../../services/llm.service");
const generation_1 = require("../metrics/generation");
const console_formatter_1 = require("../utils/console-formatter");
const utils_1 = require("../utils");
const ground_truth_json_1 = __importDefault(require("../datasets/ground-truth.json"));
async function runGenerationBenchmark(options = {}) {
    const { queriesLimit = 3, papersPerQuery = 5, verbose = true } = options;
    const queries = ground_truth_json_1.default.queries.slice(0, queriesLimit);
    (0, console_formatter_1.printHeader)('SHODHAK GENERATION BENCHMARK');
    (0, console_formatter_1.printKeyValue)({
        'Test Queries': queries.length,
        'Papers per Query': papersPerQuery
    });
    console.log();
    const reviewResults = [];
    const summaryResults = [];
    const comparisonResults = [];
    const details = [];
    let totalHallucinations = 0;
    let totalReviews = 0;
    for (const q of queries) {
        if (verbose) {
            console.log(`\n[${q.id}] "${q.query}"`);
        }
        try {
            // First, get papers
            const papers = await search_service_1.searchService.searchPapers(q.query, papersPerQuery);
            if (papers.length === 0) {
                console.log('   No papers found, skipping...');
                continue;
            }
            if (verbose) {
                console.log(`   Found ${papers.length} papers`);
            }
            // Test 1: Literature Review
            if (verbose)
                console.log('   Generating literature review...');
            const reviewStart = Date.now();
            const review = await llm_service_1.llmService.generateLiteratureReview(papers, q.query);
            const reviewLatency = Date.now() - reviewStart;
            const reviewCitations = (0, generation_1.extractCitations)(review.content);
            const reviewHallucinations = (0, generation_1.detectHallucinatedCitations)(review.content, papers.length);
            reviewResults.push({
                query: q.query,
                generatedText: review.content,
                citations: reviewCitations,
                paperCount: papers.length,
                latencyMs: reviewLatency
            });
            details.push({
                query: q.query,
                type: 'literature_review',
                paperCount: papers.length,
                generatedLength: review.content.split(/\s+/).length,
                citations: reviewCitations,
                hallucinations: reviewHallucinations,
                latencyMs: reviewLatency
            });
            totalHallucinations += reviewHallucinations.length;
            totalReviews++;
            if (verbose) {
                console.log(`   Review: ${review.content.split(/\s+/).length} words, ${reviewCitations.length} citations, ${reviewLatency}ms`);
                if (reviewHallucinations.length > 0) {
                    console.log(`   ⚠ Hallucinated citations: ${reviewHallucinations.join(', ')}`);
                }
            }
            // Test 2: Summary (first paper only)
            if (verbose)
                console.log('   Generating summary...');
            const summaryStart = Date.now();
            const summary = await llm_service_1.llmService.summarizePaper(papers[0]);
            const summaryLatency = Date.now() - summaryStart;
            summaryResults.push({
                query: q.query,
                generatedText: summary,
                citations: [],
                paperCount: 1,
                latencyMs: summaryLatency
            });
            details.push({
                query: q.query,
                type: 'summary',
                paperCount: 1,
                generatedLength: summary.split(/\s+/).length,
                citations: [],
                hallucinations: [],
                latencyMs: summaryLatency
            });
            if (verbose) {
                console.log(`   Summary: ${summary.split(/\s+/).length} words, ${summaryLatency}ms`);
            }
            // Test 3: Comparison (if enough papers)
            if (papers.length >= 2) {
                if (verbose)
                    console.log('   Generating comparison...');
                const compareStart = Date.now();
                const comparison = await llm_service_1.llmService.comparePapers(papers.slice(0, 3));
                const compareLatency = Date.now() - compareStart;
                const compareCitations = (0, generation_1.extractCitations)(comparison);
                comparisonResults.push({
                    query: q.query,
                    generatedText: comparison,
                    citations: compareCitations,
                    paperCount: Math.min(3, papers.length),
                    latencyMs: compareLatency
                });
                details.push({
                    query: q.query,
                    type: 'comparison',
                    paperCount: Math.min(3, papers.length),
                    generatedLength: comparison.split(/\s+/).length,
                    citations: compareCitations,
                    hallucinations: [],
                    latencyMs: compareLatency
                });
                if (verbose) {
                    console.log(`   Comparison: ${comparison.split(/\s+/).length} words, ${compareLatency}ms`);
                }
            }
        }
        catch (error) {
            console.error(`   ERROR: ${error}`);
        }
        // Rate limiting
        await (0, utils_1.delayBetweenAPICalls)();
    }
    // Aggregate results
    const reviewAgg = (0, generation_1.aggregateGenerationMetrics)(reviewResults);
    const summaryAgg = (0, generation_1.aggregateGenerationMetrics)(summaryResults);
    const comparisonAgg = (0, generation_1.aggregateGenerationMetrics)(comparisonResults);
    // Print summary
    (0, console_formatter_1.printSection)('GENERATION BENCHMARK RESULTS');
    console.log('Literature Reviews:');
    (0, console_formatter_1.printKeyValue)({
        'Avg Length': `${reviewAgg.avgLength.toFixed(0)} words`,
        'Citation Density': `${reviewAgg.citationDensity.toFixed(2)} per 100 words`,
        'Citation Coverage': `${(reviewAgg.citationCoverage * 100).toFixed(1)}%`,
        'Hallucination Rate': `${totalReviews > 0 ? (totalHallucinations / totalReviews).toFixed(2) : 0} per review`,
        'Avg Latency': `${reviewAgg.avgLatencyMs.toFixed(0)}ms`
    });
    console.log('\nSummaries:');
    (0, console_formatter_1.printKeyValue)({
        'Avg Length': `${summaryAgg.avgLength.toFixed(0)} words`,
        'Avg Latency': `${summaryAgg.avgLatencyMs.toFixed(0)}ms`
    });
    console.log('\nComparisons:');
    (0, console_formatter_1.printKeyValue)({
        'Avg Length': `${comparisonAgg.avgLength.toFixed(0)} words`,
        'Citation Density': `${comparisonAgg.citationDensity.toFixed(2)} per 100 words`,
        'Avg Latency': `${comparisonAgg.avgLatencyMs.toFixed(0)}ms`
    });
    return {
        timestamp: new Date().toISOString(),
        totalTests: details.length,
        literatureReview: {
            avgLength: reviewAgg.avgLength,
            citationDensity: reviewAgg.citationDensity,
            citationCoverage: reviewAgg.citationCoverage,
            hallucinationRate: totalReviews > 0 ? totalHallucinations / totalReviews : 0,
            avgLatencyMs: reviewAgg.avgLatencyMs
        },
        summary: {
            avgLength: summaryAgg.avgLength,
            avgLatencyMs: summaryAgg.avgLatencyMs
        },
        comparison: {
            avgLength: comparisonAgg.avgLength,
            citationDensity: comparisonAgg.citationDensity,
            avgLatencyMs: comparisonAgg.avgLatencyMs
        },
        details
    };
}
// Run if called directly
if (require.main === module) {
    runGenerationBenchmark({ verbose: true })
        .then(results => {
        const outputPath = (0, utils_1.saveJsonReport)('generation-benchmark-results.json', results);
        console.log(`\n\nFull results saved to: ${outputPath}`);
    })
        .catch(console.error)
        .finally(() => process.exit(0));
}
