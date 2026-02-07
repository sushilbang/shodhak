/**
 * RACE Benchmark Runner
 *
 * Evaluates research report quality using the RACE framework:
 * - Comprehensiveness
 * - Insight/Depth
 * - Instruction Following
 * - Readability
 *
 * Uses self-comparison mode: compares Shodhak's output against a baseline
 * to track improvements over time.
 */

import { searchService } from '../../services/search.service';
import { llmService } from '../../services/llm.service';
import {
    generateTaskCriteria,
    getDefaultCriteria,
    scoreReportSolo,
    aggregateRACEScores,
    scoreToGrade,
    scoreToPercent,
    RACEScores,
    RACEDimension
} from '../metrics/race-metrics';
import {
    printHeader,
    printTable,
    printKeyValue,
    printVerdict,
    delayBetweenAPICalls,
    saveJsonReport,
    saveHtmlReport
} from '../utils';

// Load DeepResearch-Bench queries
import deepresearchQueries from '../datasets/deepresearch-bench/queries.json';

// ============================================================================
// INTERFACES
// ============================================================================

interface RACEQueryResult {
    queryId: string;
    topic: string;
    domain: string;
    prompt: string;
    reportLength: number;
    scores: RACEScores;
    criteria: RACEDimension[];
    latencyMs: number;
    papersRetrieved: number;
}

interface RACEBenchmarkResult {
    timestamp: string;
    benchmarkType: 'race';
    totalQueries: number;
    completedQueries: number;
    metrics: {
        avgComprehensiveness: number;
        avgInsight: number;
        avgInstructionFollowing: number;
        avgReadability: number;
        avgOverallScore: number;
        stdOverallScore: number;
    };
    queryResults: RACEQueryResult[];
    summary: {
        strengths: string[];
        weaknesses: string[];
        recommendations: string[];
    };
    configuration: {
        queriesLimit: number;
        papersPerQuery: number;
        evaluationModel: string;
    };
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

/**
 * Run the RACE benchmark
 *
 * @param options - Benchmark options
 * @returns RACE benchmark results
 */
export async function runRACEBenchmark(
    options: {
        /** Number of queries to evaluate (default: 10) */
        queriesLimit?: number;
        /** Papers to retrieve per query (default: 10) */
        papersPerQuery?: number;
        /** Generate task-specific criteria (slower but more accurate) */
        generateCriteria?: boolean;
        /** Verbose output */
        verbose?: boolean;
        /** Specific query IDs to run */
        queryIds?: string[];
    } = {}
): Promise<RACEBenchmarkResult> {
    const {
        queriesLimit = 10,
        papersPerQuery = 10,
        generateCriteria = false,
        verbose = true,
        queryIds
    } = options;

    // Select queries to run
    let queries = deepresearchQueries.queries as Array<{
        id: string;
        topic: string;
        domain: string;
        prompt: string;
        language: string;
        expected_depth: string;
        evaluation_focus: string[];
    }>;

    if (queryIds && queryIds.length > 0) {
        queries = queries.filter(q => queryIds.includes(q.id));
    } else {
        queries = queries.slice(0, queriesLimit);
    }

    const queryResults: RACEQueryResult[] = [];
    const allScores: RACEScores[] = [];

    // Print header
    printHeader('RACE BENCHMARK - Report Quality Evaluation', 55);
    printKeyValue({
        'Test Queries': queries.length,
        'Papers per Query': papersPerQuery,
        'Generate Criteria': generateCriteria ? 'Yes' : 'No (using defaults)',
        'Dimensions': 'Comprehensiveness, Insight, Instruction Following, Readability'
    });
    console.log();

    // Process each query
    for (let i = 0; i < queries.length; i++) {
        const query = queries[i];

        if (verbose) {
            console.log(`\n[${i + 1}/${queries.length}] ${query.id}: ${query.topic}`);
            console.log(`   Domain: ${query.domain}`);
        }

        const startTime = Date.now();

        try {
            // Step 1: Search for papers
            if (verbose) {
                console.log('   Searching for papers...');
            }

            const papers = await searchService.searchPapers(query.prompt, papersPerQuery);

            if (papers.length === 0) {
                console.log('   No papers found, skipping...');
                continue;
            }

            if (verbose) {
                console.log(`   Retrieved ${papers.length} papers`);
            }

            // Step 2: Generate research report
            if (verbose) {
                console.log('   Generating literature review...');
            }

            const review = await llmService.generateLiteratureReview(papers, query.prompt);
            const reportLength = review.content.split(/\s+/).length;

            if (verbose) {
                console.log(`   Generated report (${reportLength} words)`);
            }

            // Step 3: Get evaluation criteria
            let criteria: RACEDimension[];
            if (generateCriteria) {
                if (verbose) {
                    console.log('   Generating task-specific criteria...');
                }
                criteria = await generateTaskCriteria(query.prompt);
            } else {
                // Use domain-specific weights if available
                criteria = getDefaultCriteria();
            }

            // Step 4: Score the report
            if (verbose) {
                console.log('   Evaluating report quality...');
            }

            const scores = await scoreReportSolo(review.content, query.prompt, criteria);
            const latencyMs = Date.now() - startTime;

            allScores.push(scores);

            queryResults.push({
                queryId: query.id,
                topic: query.topic,
                domain: query.domain,
                prompt: query.prompt.slice(0, 200) + '...',
                reportLength,
                scores,
                criteria,
                latencyMs,
                papersRetrieved: papers.length
            });

            // Print results
            if (verbose) {
                console.log(`   Comprehensiveness:     ${scoreToPercent(scores.comprehensiveness)} (${scoreToGrade(scores.comprehensiveness)})`);
                console.log(`   Insight:               ${scoreToPercent(scores.insight)} (${scoreToGrade(scores.insight)})`);
                console.log(`   Instruction Following: ${scoreToPercent(scores.instruction_following)} (${scoreToGrade(scores.instruction_following)})`);
                console.log(`   Readability:           ${scoreToPercent(scores.readability)} (${scoreToGrade(scores.readability)})`);
                console.log(`   Overall RACE Score:    ${scoreToPercent(scores.overall_score)} (${scoreToGrade(scores.overall_score)})`);
                console.log(`   Latency: ${(latencyMs / 1000).toFixed(1)}s`);
            }

        } catch (error) {
            console.error(`   ERROR: ${error}`);
        }

        await delayBetweenAPICalls();
    }

    // Aggregate metrics
    const aggregated = aggregateRACEScores(allScores);

    // Generate summary
    const summary = generateSummary(aggregated);

    // Print final results
    printResults(aggregated, queryResults, summary);

    const result: RACEBenchmarkResult = {
        timestamp: new Date().toISOString(),
        benchmarkType: 'race',
        totalQueries: queries.length,
        completedQueries: queryResults.length,
        metrics: aggregated,
        queryResults,
        summary,
        configuration: {
            queriesLimit,
            papersPerQuery,
            evaluationModel: process.env.LLM_PROVIDER || 'groq'
        }
    };

    return result;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateSummary(metrics: ReturnType<typeof aggregateRACEScores>): {
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
} {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Comprehensiveness analysis
    if (metrics.avgComprehensiveness >= 0.7) {
        strengths.push(`Good topic coverage (${scoreToPercent(metrics.avgComprehensiveness)})`);
    } else if (metrics.avgComprehensiveness < 0.5) {
        weaknesses.push(`Limited topic coverage (${scoreToPercent(metrics.avgComprehensiveness)})`);
        recommendations.push('Expand literature search to cover more aspects of topics');
    }

    // Insight analysis
    if (metrics.avgInsight >= 0.7) {
        strengths.push(`Strong analytical depth (${scoreToPercent(metrics.avgInsight)})`);
    } else if (metrics.avgInsight < 0.5) {
        weaknesses.push(`Shallow analysis (${scoreToPercent(metrics.avgInsight)})`);
        recommendations.push('Enhance prompts to encourage deeper critical analysis');
    }

    // Instruction following analysis
    if (metrics.avgInstructionFollowing >= 0.7) {
        strengths.push(`Reports follow instructions well (${scoreToPercent(metrics.avgInstructionFollowing)})`);
    } else if (metrics.avgInstructionFollowing < 0.5) {
        weaknesses.push(`Reports often miss task requirements (${scoreToPercent(metrics.avgInstructionFollowing)})`);
        recommendations.push('Improve prompt engineering to better capture task requirements');
    }

    // Readability analysis
    if (metrics.avgReadability >= 0.7) {
        strengths.push(`Clear and well-organized writing (${scoreToPercent(metrics.avgReadability)})`);
    } else if (metrics.avgReadability < 0.5) {
        weaknesses.push(`Readability issues (${scoreToPercent(metrics.avgReadability)})`);
        recommendations.push('Add structure guidelines to generation prompts');
    }

    // Overall assessment
    if (metrics.avgOverallScore >= 0.7) {
        strengths.push('Strong overall report quality');
    } else if (metrics.avgOverallScore < 0.5) {
        recommendations.push('Consider end-to-end review of the report generation pipeline');
    }

    // Consistency analysis
    if (metrics.stdOverallScore > 0.15) {
        weaknesses.push(`Inconsistent quality across queries (std: ${metrics.stdOverallScore.toFixed(2)})`);
        recommendations.push('Investigate queries with low scores to identify patterns');
    }

    return { strengths, weaknesses, recommendations };
}

function printResults(
    metrics: ReturnType<typeof aggregateRACEScores>,
    queryResults: RACEQueryResult[],
    summary: { strengths: string[]; weaknesses: string[]; recommendations: string[] }
): void {
    printHeader('RACE BENCHMARK RESULTS', 60);

    // Metrics table
    const tableColumns = [
        { header: 'Dimension', width: 24, align: 'left' as const },
        { header: 'Score', width: 12, align: 'right' as const },
        { header: 'Grade', width: 8, align: 'center' as const }
    ];

    const tableRows = [
        ['Comprehensiveness', scoreToPercent(metrics.avgComprehensiveness), scoreToGrade(metrics.avgComprehensiveness)],
        ['Insight', scoreToPercent(metrics.avgInsight), scoreToGrade(metrics.avgInsight)],
        ['Instruction Following', scoreToPercent(metrics.avgInstructionFollowing), scoreToGrade(metrics.avgInstructionFollowing)],
        ['Readability', scoreToPercent(metrics.avgReadability), scoreToGrade(metrics.avgReadability)],
        ['─'.repeat(22), '─'.repeat(10), '─'.repeat(6)],
        ['Overall RACE Score', scoreToPercent(metrics.avgOverallScore), scoreToGrade(metrics.avgOverallScore)]
    ];

    printTable(tableColumns, tableRows);

    // Statistics
    console.log(`\nEvaluations: ${metrics.totalEvaluations}`);
    console.log(`Standard Deviation: ${metrics.stdOverallScore.toFixed(3)}`);

    // Summary
    if (summary.strengths.length > 0) {
        console.log('\nStrengths:');
        for (const s of summary.strengths) {
            console.log(`  + ${s}`);
        }
    }

    if (summary.weaknesses.length > 0) {
        console.log('\nWeaknesses:');
        for (const w of summary.weaknesses) {
            console.log(`  - ${w}`);
        }
    }

    if (summary.recommendations.length > 0) {
        console.log('\nRecommendations:');
        for (const r of summary.recommendations) {
            console.log(`  > ${r}`);
        }
    }

    // Verdict
    if (metrics.avgOverallScore >= 0.7) {
        printVerdict('success', 'Report quality meets high standards');
    } else if (metrics.avgOverallScore >= 0.5) {
        printVerdict('warning', 'Report quality is acceptable but has room for improvement');
    } else {
        printVerdict('failure', 'Report quality needs significant improvement');
    }

    // Per-query breakdown for low scores
    const lowScoreQueries = queryResults.filter(q => q.scores.overall_score < 0.5);
    if (lowScoreQueries.length > 0) {
        console.log('\nQueries with Low Scores:');
        for (const q of lowScoreQueries.slice(0, 5)) {
            console.log(`  ${q.queryId}: ${q.topic} - ${scoreToPercent(q.scores.overall_score)}`);
        }
    }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

if (require.main === module) {
    const args = process.argv.slice(2);

    const options: Parameters<typeof runRACEBenchmark>[0] = {
        queriesLimit: 10,
        papersPerQuery: 10,
        generateCriteria: false,
        verbose: true
    };

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
            options.queriesLimit = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--papers' && args[i + 1]) {
            options.papersPerQuery = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--generate-criteria') {
            options.generateCriteria = true;
        } else if (args[i] === '--quiet') {
            options.verbose = false;
        } else if (args[i] === '--queries' && args[i + 1]) {
            options.queryIds = args[i + 1].split(',');
            i++;
        }
    }

    runRACEBenchmark(options)
        .then(report => {
            const outputPath = saveJsonReport('race-benchmark-report.json', report);
            console.log(`\nReport saved to: ${outputPath}`);

            // Determine grade
            const score = report.metrics.avgOverallScore;
            let grade = 'F';
            if (score >= 0.9) grade = 'A+';
            else if (score >= 0.8) grade = 'A';
            else if (score >= 0.7) grade = 'B';
            else if (score >= 0.6) grade = 'C';
            else if (score >= 0.5) grade = 'D';

            // Save HTML report
            const htmlPath = saveHtmlReport('race-benchmark-report.html', {
                title: 'RACE Benchmark Report - Report Quality',
                timestamp: report.timestamp,
                leaderboardScore: Math.round(score * 100),
                grade,
                race: {
                    comprehensiveness: report.metrics.avgComprehensiveness,
                    insight: report.metrics.avgInsight,
                    instructionFollowing: report.metrics.avgInstructionFollowing,
                    readability: report.metrics.avgReadability,
                    overall: report.metrics.avgOverallScore
                },
                summary: report.summary
            });
            console.log(`HTML report saved to: ${htmlPath}`);
        })
        .catch(error => {
            console.error('RACE benchmark failed:', error);
            process.exit(1);
        });
}

export { RACEBenchmarkResult, RACEQueryResult };
