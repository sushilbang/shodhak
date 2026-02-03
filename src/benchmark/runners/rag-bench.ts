/**
 * RAG Benchmark Runner
 * Evaluates the full RAG pipeline using Faithfulness, Answer Relevance,
 * Context Precision, and Context Recall metrics.
 */

import { searchService } from '../../services/search.service';
import { llmService } from '../../services/llm.service';
import {
    evaluateRAGWithPapers,
    aggregateRAGMetrics,
    RAGEvaluationResult
} from '../metrics/rag-metrics';
import {
    printHeader,
    printTable,
    printKeyValue,
    printVerdict,
    delayBetweenAPICalls,
    saveJsonReport
} from '../utils';
import groundTruth from '../datasets/ground-truth.json';

interface RAGBenchmarkResult {
    timestamp: string;
    totalQueries: number;
    metrics: {
        avgFaithfulness: number;
        avgAnswerRelevance: number;
        avgContextPrecision: number;
        avgContextRecall: number;
        avgOverallScore: number;
        avgWeightedScore: number;
    };
    queryResults: Array<{
        queryId: string;
        query: string;
        papersRetrieved: number;
        ragEvaluation: RAGEvaluationResult;
        latencyMs: number;
    }>;
    summary: {
        strengths: string[];
        weaknesses: string[];
        recommendations: string[];
    };
}

export async function runRAGBenchmark(
    options: {
        queriesLimit?: number;
        papersPerQuery?: number;
        verbose?: boolean;
    } = {}
): Promise<RAGBenchmarkResult> {
    const { queriesLimit = 5, papersPerQuery = 5, verbose = true } = options;

    const queries = groundTruth.queries.slice(0, queriesLimit);
    const queryResults: RAGBenchmarkResult['queryResults'] = [];
    const allEvaluations: RAGEvaluationResult[] = [];

    printHeader('SHODHAK RAG BENCHMARK', 50);
    printKeyValue({
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
            const papers = await searchService.searchPapers(q.query, papersPerQuery);

            if (papers.length === 0) {
                console.log('   No papers found, skipping...');
                continue;
            }

            if (verbose) {
                console.log(`   Retrieved ${papers.length} papers`);
            }

            // Step 2: Generate literature review
            const review = await llmService.generateLiteratureReview(papers, q.query);
            const latencyMs = Date.now() - startTime;

            if (verbose) {
                console.log(`   Generated response (${review.content.split(/\s+/).length} words)`);
            }

            // Step 3: Evaluate RAG metrics
            const ragEval = evaluateRAGWithPapers(
                q.query,
                review.content,
                papers,
                { groundTruthDois: q.relevant_dois }
            );

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

        } catch (error) {
            console.error(`   ERROR: ${error}`);
        }

        await delayBetweenAPICalls();
    }

    // Aggregate metrics
    const aggregated = aggregateRAGMetrics(allEvaluations);

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

function generateSummary(metrics: ReturnType<typeof aggregateRAGMetrics>): RAGBenchmarkResult['summary'] {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Faithfulness analysis
    if (metrics.avgFaithfulness >= 0.8) {
        strengths.push(`High faithfulness (${(metrics.avgFaithfulness * 100).toFixed(0)}%) - responses stick to context`);
    } else if (metrics.avgFaithfulness < 0.6) {
        weaknesses.push(`Low faithfulness (${(metrics.avgFaithfulness * 100).toFixed(0)}%) - potential hallucinations`);
        recommendations.push('Add post-generation fact-checking against source documents');
    }

    // Answer Relevance analysis
    if (metrics.avgAnswerRelevance >= 0.7) {
        strengths.push(`Good answer relevance (${(metrics.avgAnswerRelevance * 100).toFixed(0)}%)`);
    } else if (metrics.avgAnswerRelevance < 0.5) {
        weaknesses.push(`Low answer relevance (${(metrics.avgAnswerRelevance * 100).toFixed(0)}%)`);
        recommendations.push('Improve prompts to focus on the specific question asked');
    }

    // Context Precision analysis
    if (metrics.avgContextPrecision >= 0.7) {
        strengths.push(`High context precision (${(metrics.avgContextPrecision * 100).toFixed(0)}%) - relevant papers retrieved`);
    } else if (metrics.avgContextPrecision < 0.5) {
        weaknesses.push(`Low context precision (${(metrics.avgContextPrecision * 100).toFixed(0)}%) - many irrelevant papers`);
        recommendations.push('Implement re-ranking to filter out irrelevant documents');
    }

    // Context Recall analysis
    if (metrics.avgContextRecall >= 0.7) {
        strengths.push(`Good context recall (${(metrics.avgContextRecall * 100).toFixed(0)}%)`);
    } else if (metrics.avgContextRecall < 0.5) {
        weaknesses.push(`Low context recall (${(metrics.avgContextRecall * 100).toFixed(0)}%) - missing relevant info`);
        recommendations.push('Expand search to retrieve more diverse documents');
    }

    // Overall assessment
    if (metrics.avgOverallScore >= 0.7) {
        strengths.push('Strong overall RAG performance');
    } else if (metrics.avgOverallScore < 0.5) {
        recommendations.push('Consider end-to-end RAG optimization');
    }

    return { strengths, weaknesses, recommendations };
}

function printResults(
    metrics: ReturnType<typeof aggregateRAGMetrics>,
    queryResults: RAGBenchmarkResult['queryResults'],
    summary: RAGBenchmarkResult['summary']
): void {
    printHeader('RAG BENCHMARK RESULTS', 60);

    // Metrics table
    const tableColumns = [
        { header: 'Metric', width: 22, align: 'left' as const },
        { header: 'Score', width: 10, align: 'right' as const },
        { header: 'Grade', width: 10, align: 'center' as const }
    ];

    const getGrade = (score: number): string => {
        if (score >= 0.9) return 'A+';
        if (score >= 0.8) return 'A';
        if (score >= 0.7) return 'B';
        if (score >= 0.6) return 'C';
        if (score >= 0.5) return 'D';
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

    printTable(tableColumns, tableRows);

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
        printVerdict('success', 'RAG system performs well across all metrics');
    } else if (metrics.avgOverallScore >= 0.5) {
        printVerdict('warning', 'RAG system has room for improvement');
    } else {
        printVerdict('failure', 'RAG system needs significant optimization');
    }
}

// Run if called directly
if (require.main === module) {
    runRAGBenchmark({ verbose: true })
        .then(report => {
            const outputPath = saveJsonReport('rag-benchmark-report.json', report);
            console.log(`\nReport saved to: ${outputPath}`);
        })
        .catch(console.error)
        .finally(() => process.exit(0));
}
