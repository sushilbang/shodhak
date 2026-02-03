"use strict";
/**
 * RAG Benchmark Runner
 * Evaluates the full RAG pipeline using Faithfulness, Answer Relevance,
 * Context Precision, and Context Recall metrics.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRAGBenchmark = runRAGBenchmark;
const search_service_1 = require("../../services/search.service");
const llm_service_1 = require("../../services/llm.service");
const rag_metrics_1 = require("../metrics/rag-metrics");
const utils_1 = require("../utils");
const ground_truth_json_1 = __importDefault(require("../datasets/ground-truth.json"));
async function runRAGBenchmark(options = {}) {
    const { queriesLimit = 5, papersPerQuery = 5, verbose = true } = options;
    const queries = ground_truth_json_1.default.queries.slice(0, queriesLimit);
    const queryResults = [];
    const allEvaluations = [];
    (0, utils_1.printHeader)('SHODHAK RAG BENCHMARK', 50);
    (0, utils_1.printKeyValue)({
        'Test Queries': queries.length,
        'Papers per Query': papersPerQuery,
        'Metrics': 'Faithfulness, Answer Relevance, Context Precision, Context Recall'
    });
    console.log();
    for (const q of queries) {
        if (verbose) {
            console.log(`\n[${q.id}] "${q.query}"`);
        }
        const startTime = Date.now();
        try {
            // Step 1: Retrieve papers
            const papers = await search_service_1.searchService.searchPapers(q.query, papersPerQuery);
            if (papers.length === 0) {
                console.log('   No papers found, skipping...');
                continue;
            }
            if (verbose) {
                console.log(`   Retrieved ${papers.length} papers`);
            }
            // Step 2: Generate literature review
            const review = await llm_service_1.llmService.generateLiteratureReview(papers, q.query);
            const latencyMs = Date.now() - startTime;
            if (verbose) {
                console.log(`   Generated response (${review.content.split(/\s+/).length} words)`);
            }
            // Step 3: Evaluate RAG metrics
            const ragEval = (0, rag_metrics_1.evaluateRAGWithPapers)(q.query, review.content, papers, { groundTruthDois: q.relevant_dois });
            allEvaluations.push(ragEval);
            queryResults.push({
                queryId: q.id,
                query: q.query,
                papersRetrieved: papers.length,
                ragEvaluation: ragEval,
                latencyMs
            });
            if (verbose) {
                console.log(`   Faithfulness:      ${(ragEval.faithfulness.score * 100).toFixed(1)}%`);
                console.log(`   Answer Relevance:  ${(ragEval.answerRelevance.score * 100).toFixed(1)}%`);
                console.log(`   Context Precision: ${(ragEval.contextPrecision.score * 100).toFixed(1)}%`);
                console.log(`   Context Recall:    ${(ragEval.contextRecall.score * 100).toFixed(1)}%`);
                console.log(`   Overall RAG Score: ${(ragEval.overallScore * 100).toFixed(1)}%`);
            }
        }
        catch (error) {
            console.error(`   ERROR: ${error}`);
        }
        await (0, utils_1.delayBetweenAPICalls)();
    }
    // Aggregate metrics
    const aggregated = (0, rag_metrics_1.aggregateRAGMetrics)(allEvaluations);
    // Generate summary
    const summary = generateSummary(aggregated);
    // Print results
    printResults(aggregated, queryResults, summary);
    return {
        timestamp: new Date().toISOString(),
        totalQueries: queries.length,
        metrics: aggregated,
        queryResults,
        summary
    };
}
function generateSummary(metrics) {
    const strengths = [];
    const weaknesses = [];
    const recommendations = [];
    // Faithfulness analysis
    if (metrics.avgFaithfulness >= 0.8) {
        strengths.push(`High faithfulness (${(metrics.avgFaithfulness * 100).toFixed(0)}%) - responses stick to context`);
    }
    else if (metrics.avgFaithfulness < 0.6) {
        weaknesses.push(`Low faithfulness (${(metrics.avgFaithfulness * 100).toFixed(0)}%) - potential hallucinations`);
        recommendations.push('Add post-generation fact-checking against source documents');
    }
    // Answer Relevance analysis
    if (metrics.avgAnswerRelevance >= 0.7) {
        strengths.push(`Good answer relevance (${(metrics.avgAnswerRelevance * 100).toFixed(0)}%)`);
    }
    else if (metrics.avgAnswerRelevance < 0.5) {
        weaknesses.push(`Low answer relevance (${(metrics.avgAnswerRelevance * 100).toFixed(0)}%)`);
        recommendations.push('Improve prompts to focus on the specific question asked');
    }
    // Context Precision analysis
    if (metrics.avgContextPrecision >= 0.7) {
        strengths.push(`High context precision (${(metrics.avgContextPrecision * 100).toFixed(0)}%) - relevant papers retrieved`);
    }
    else if (metrics.avgContextPrecision < 0.5) {
        weaknesses.push(`Low context precision (${(metrics.avgContextPrecision * 100).toFixed(0)}%) - many irrelevant papers`);
        recommendations.push('Implement re-ranking to filter out irrelevant documents');
    }
    // Context Recall analysis
    if (metrics.avgContextRecall >= 0.7) {
        strengths.push(`Good context recall (${(metrics.avgContextRecall * 100).toFixed(0)}%)`);
    }
    else if (metrics.avgContextRecall < 0.5) {
        weaknesses.push(`Low context recall (${(metrics.avgContextRecall * 100).toFixed(0)}%) - missing relevant info`);
        recommendations.push('Expand search to retrieve more diverse documents');
    }
    // Overall assessment
    if (metrics.avgOverallScore >= 0.7) {
        strengths.push('Strong overall RAG performance');
    }
    else if (metrics.avgOverallScore < 0.5) {
        recommendations.push('Consider end-to-end RAG optimization');
    }
    return { strengths, weaknesses, recommendations };
}
function printResults(metrics, queryResults, summary) {
    (0, utils_1.printHeader)('RAG BENCHMARK RESULTS', 60);
    // Metrics table
    const tableColumns = [
        { header: 'Metric', width: 22, align: 'left' },
        { header: 'Score', width: 10, align: 'right' },
        { header: 'Grade', width: 10, align: 'center' }
    ];
    const getGrade = (score) => {
        if (score >= 0.9)
            return 'A+';
        if (score >= 0.8)
            return 'A';
        if (score >= 0.7)
            return 'B';
        if (score >= 0.6)
            return 'C';
        if (score >= 0.5)
            return 'D';
        return 'F';
    };
    const tableRows = [
        ['Faithfulness', `${(metrics.avgFaithfulness * 100).toFixed(1)}%`, getGrade(metrics.avgFaithfulness)],
        ['Answer Relevance', `${(metrics.avgAnswerRelevance * 100).toFixed(1)}%`, getGrade(metrics.avgAnswerRelevance)],
        ['Context Precision', `${(metrics.avgContextPrecision * 100).toFixed(1)}%`, getGrade(metrics.avgContextPrecision)],
        ['Context Recall', `${(metrics.avgContextRecall * 100).toFixed(1)}%`, getGrade(metrics.avgContextRecall)],
        ['─'.repeat(20), '─'.repeat(8), '─'.repeat(8)],
        ['Overall (Harmonic)', `${(metrics.avgOverallScore * 100).toFixed(1)}%`, getGrade(metrics.avgOverallScore)],
        ['Weighted Average', `${(metrics.avgWeightedScore * 100).toFixed(1)}%`, getGrade(metrics.avgWeightedScore)]
    ];
    (0, utils_1.printTable)(tableColumns, tableRows);
    // Summary
    console.log('\nStrengths:');
    for (const s of summary.strengths) {
        console.log(`  ✓ ${s}`);
    }
    console.log('\nWeaknesses:');
    for (const w of summary.weaknesses) {
        console.log(`  ✗ ${w}`);
    }
    if (summary.recommendations.length > 0) {
        console.log('\nRecommendations:');
        for (const r of summary.recommendations) {
            console.log(`  → ${r}`);
        }
    }
    // Verdict
    if (metrics.avgOverallScore >= 0.7) {
        (0, utils_1.printVerdict)('success', 'RAG system performs well across all metrics');
    }
    else if (metrics.avgOverallScore >= 0.5) {
        (0, utils_1.printVerdict)('warning', 'RAG system has room for improvement');
    }
    else {
        (0, utils_1.printVerdict)('failure', 'RAG system needs significant optimization');
    }
}
// Run if called directly
if (require.main === module) {
    runRAGBenchmark({ verbose: true })
        .then(report => {
        const outputPath = (0, utils_1.saveJsonReport)('rag-benchmark-report.json', report);
        console.log(`\nReport saved to: ${outputPath}`);
    })
        .catch(console.error)
        .finally(() => process.exit(0));
}
