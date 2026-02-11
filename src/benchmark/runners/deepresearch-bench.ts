/**
 * DeepResearch Benchmark Runner
 *
 * Combined benchmark that runs both RACE and FACT evaluations
 * to provide a comprehensive assessment of research report quality.
 *
 * Output format compatible with DeepResearch-Bench leaderboard.
 */

import { runRACEBenchmark, RACEBenchmarkResult } from './race-bench';
import { runFACTBenchmark, FACTBenchmarkResult } from './fact-bench';
import {
    printHeader,
    printTable,
    printKeyValue,
    printVerdict,
    saveJsonReport,
    saveHtmlReport
} from '../utils';
import { scoreToGrade, scoreToPercent } from '../metrics/race-metrics';
import { factScoreToGrade } from '../metrics/fact-metrics';

// ============================================================================
// INTERFACES
// ============================================================================

interface DeepResearchBenchmarkResult {
    timestamp: string;
    benchmarkType: 'deepresearch';
    version: string;

    // Combined metrics
    combinedScore: number;  // 0-1 weighted combination
    leaderboardScore: number;  // 0-100 scale for leaderboard

    // Component results
    race: RACEBenchmarkResult;
    fact: FACTBenchmarkResult;

    // Summary
    summary: {
        overallGrade: string;
        strengths: string[];
        weaknesses: string[];
        recommendations: string[];
    };

    // Configuration
    configuration: {
        queriesLimit: number;
        papersPerQuery: number;
        raceWeight: number;
        factWeight: number;
    };
}

interface LeaderboardEntry {
    model: string;
    provider: string;
    timestamp: string;
    score: number;
    race_score: number;
    fact_score: number;
    comprehensiveness: number;
    insight: number;
    instruction_following: number;
    readability: number;
    citation_accuracy: number;
    support_rate: number;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

/**
 * Run the full DeepResearch benchmark (RACE + FACT)
 *
 * @param options - Benchmark options
 * @returns Combined benchmark results
 */
export async function runDeepResearchBenchmark(
    options: {
        /** Number of queries to evaluate (default: 10) */
        queriesLimit?: number;
        /** Papers to retrieve per query (default: 10) */
        papersPerQuery?: number;
        /** Weight for RACE score (default: 0.6) */
        raceWeight?: number;
        /** Weight for FACT score (default: 0.4) */
        factWeight?: number;
        /** Generate task-specific criteria for RACE */
        generateCriteria?: boolean;
        /** Max citations to validate per report */
        maxCitationsPerReport?: number;
        /** Verbose output */
        verbose?: boolean;
        /** Run only RACE */
        raceOnly?: boolean;
        /** Run only FACT */
        factOnly?: boolean;
        /** Specific query IDs to run */
        queryIds?: string[];
    } = {}
): Promise<DeepResearchBenchmarkResult> {
    const {
        queriesLimit = 10,
        papersPerQuery = 10,
        raceWeight = 0.6,
        factWeight = 0.4,
        generateCriteria = false,
        maxCitationsPerReport = 20,
        verbose = true,
        raceOnly = false,
        factOnly = false,
        queryIds
    } = options;

    printHeader('DEEPRESEARCH BENCHMARK SUITE', 55);
    printKeyValue({
        'Test Queries': queriesLimit,
        'Papers per Query': papersPerQuery,
        'RACE Weight': `${(raceWeight * 100).toFixed(0)}%`,
        'FACT Weight': `${(factWeight * 100).toFixed(0)}%`,
        'Mode': raceOnly ? 'RACE Only' : factOnly ? 'FACT Only' : 'Full (RACE + FACT)'
    });
    console.log();

    const startTime = Date.now();

    // Run RACE benchmark
    let raceResult: RACEBenchmarkResult;
    if (!factOnly) {
        console.log('\n=== Running RACE Benchmark ===\n');
        raceResult = await runRACEBenchmark({
            queriesLimit,
            papersPerQuery,
            generateCriteria,
            verbose,
            queryIds
        });
    } else {
        // Placeholder for FACT-only mode
        raceResult = createEmptyRACEResult();
    }

    // Run FACT benchmark
    let factResult: FACTBenchmarkResult;
    if (!raceOnly) {
        console.log('\n=== Running FACT Benchmark ===\n');
        factResult = await runFACTBenchmark({
            queriesLimit,
            papersPerQuery,
            maxCitationsPerReport,
            verbose,
            queryIds
        });
    } else {
        // Placeholder for RACE-only mode
        factResult = createEmptyFACTResult();
    }

    const totalTime = Date.now() - startTime;

    // Calculate combined scores
    const raceScore = raceResult.metrics.avgOverallScore;
    const factScore = factResult.metrics.avgCitationAccuracy;

    let combinedScore: number;
    if (raceOnly) {
        combinedScore = raceScore;
    } else if (factOnly) {
        combinedScore = factScore;
    } else {
        combinedScore = raceScore * raceWeight + factScore * factWeight;
    }

    const leaderboardScore = Math.round(combinedScore * 100);

    // Generate summary
    const summary = generateCombinedSummary(raceResult, factResult, combinedScore);

    // Print combined results
    printCombinedResults(raceResult, factResult, combinedScore, leaderboardScore, summary);

    console.log(`\nTotal benchmark time: ${(totalTime / 1000).toFixed(1)}s`);

    const result: DeepResearchBenchmarkResult = {
        timestamp: new Date().toISOString(),
        benchmarkType: 'deepresearch',
        version: '1.0',
        combinedScore,
        leaderboardScore,
        race: raceResult,
        fact: factResult,
        summary,
        configuration: {
            queriesLimit,
            papersPerQuery,
            raceWeight,
            factWeight
        }
    };

    return result;
}

/**
 * Generate leaderboard entry from benchmark result
 */
export function toLeaderboardEntry(
    result: DeepResearchBenchmarkResult,
    modelName?: string
): LeaderboardEntry {
    return {
        model: modelName || process.env.GROQ_MODEL || 'unknown',
        provider: process.env.LLM_PROVIDER || 'groq',
        timestamp: result.timestamp,
        score: result.leaderboardScore,
        race_score: Math.round(result.race.metrics.avgOverallScore * 100),
        fact_score: Math.round(result.fact.metrics.avgCitationAccuracy * 100),
        comprehensiveness: Math.round(result.race.metrics.avgComprehensiveness * 100),
        insight: Math.round(result.race.metrics.avgInsight * 100),
        instruction_following: Math.round(result.race.metrics.avgInstructionFollowing * 100),
        readability: Math.round(result.race.metrics.avgReadability * 100),
        citation_accuracy: Math.round(result.fact.metrics.avgCitationAccuracy * 100),
        support_rate: Math.round(result.fact.metrics.avgSupportRate * 100)
    };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createEmptyRACEResult(): RACEBenchmarkResult {
    return {
        timestamp: new Date().toISOString(),
        benchmarkType: 'race',
        totalQueries: 0,
        completedQueries: 0,
        metrics: {
            avgComprehensiveness: 0,
            avgInsight: 0,
            avgInstructionFollowing: 0,
            avgReadability: 0,
            avgOverallScore: 0,
            stdOverallScore: 0
        },
        queryResults: [],
        summary: { strengths: [], weaknesses: [], recommendations: [] },
        configuration: { queriesLimit: 0, papersPerQuery: 0, evaluationModel: '' }
    };
}

function createEmptyFACTResult(): FACTBenchmarkResult {
    return {
        timestamp: new Date().toISOString(),
        benchmarkType: 'fact',
        totalQueries: 0,
        completedQueries: 0,
        metrics: {
            avgCitationAccuracy: 0,
            avgSupportRate: 0,
            totalCitations: 0,
            totalSupported: 0,
            totalUnsupported: 0,
            totalUnknown: 0
        },
        queryResults: [],
        summary: { strengths: [], weaknesses: [], recommendations: [] },
        configuration: {
            queriesLimit: 0,
            papersPerQuery: 0,
            maxCitationsPerReport: 0,
            jinaConfigured: false
        }
    };
}

function generateCombinedSummary(
    race: RACEBenchmarkResult,
    fact: FACTBenchmarkResult,
    combinedScore: number
): DeepResearchBenchmarkResult['summary'] {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Combine strengths/weaknesses from both
    strengths.push(...race.summary.strengths);
    strengths.push(...fact.summary.strengths);
    weaknesses.push(...race.summary.weaknesses);
    weaknesses.push(...fact.summary.weaknesses);
    recommendations.push(...race.summary.recommendations);
    recommendations.push(...fact.summary.recommendations);

    // Add combined analysis
    if (race.metrics.avgOverallScore >= 0.7 && fact.metrics.avgCitationAccuracy >= 0.7) {
        strengths.push('Excellent balance of report quality and citation accuracy');
    }

    if (race.metrics.avgOverallScore >= 0.7 && fact.metrics.avgCitationAccuracy < 0.5) {
        weaknesses.push('Good report quality but poor citation accuracy');
        recommendations.push('Focus on improving citation verification while maintaining report quality');
    }

    if (race.metrics.avgOverallScore < 0.5 && fact.metrics.avgCitationAccuracy >= 0.7) {
        weaknesses.push('Good citations but report quality needs work');
        recommendations.push('Focus on improving report comprehensiveness and depth');
    }

    // Determine overall grade
    let overallGrade: string;
    if (combinedScore >= 0.9) overallGrade = 'A+';
    else if (combinedScore >= 0.8) overallGrade = 'A';
    else if (combinedScore >= 0.7) overallGrade = 'B';
    else if (combinedScore >= 0.6) overallGrade = 'C';
    else if (combinedScore >= 0.5) overallGrade = 'D';
    else overallGrade = 'F';

    return {
        overallGrade,
        strengths: [...new Set(strengths)], // Remove duplicates
        weaknesses: [...new Set(weaknesses)],
        recommendations: [...new Set(recommendations)]
    };
}

function printCombinedResults(
    race: RACEBenchmarkResult,
    fact: FACTBenchmarkResult,
    combinedScore: number,
    leaderboardScore: number,
    summary: DeepResearchBenchmarkResult['summary']
): void {
    printHeader('DEEPRESEARCH BENCHMARK RESULTS', 65);

    // Combined score
    console.log(`\n  LEADERBOARD SCORE: ${leaderboardScore}/100 (${summary.overallGrade})\n`);

    // RACE metrics
    console.log('RACE Metrics (Report Quality):');
    const raceColumns = [
        { header: 'Dimension', width: 24, align: 'left' as const },
        { header: 'Score', width: 10, align: 'right' as const },
        { header: 'Grade', width: 8, align: 'center' as const }
    ];

    const raceRows = [
        ['Comprehensiveness', scoreToPercent(race.metrics.avgComprehensiveness), scoreToGrade(race.metrics.avgComprehensiveness)],
        ['Insight', scoreToPercent(race.metrics.avgInsight), scoreToGrade(race.metrics.avgInsight)],
        ['Instruction Following', scoreToPercent(race.metrics.avgInstructionFollowing), scoreToGrade(race.metrics.avgInstructionFollowing)],
        ['Readability', scoreToPercent(race.metrics.avgReadability), scoreToGrade(race.metrics.avgReadability)],
        ['─'.repeat(22), '─'.repeat(8), '─'.repeat(6)],
        ['RACE Overall', scoreToPercent(race.metrics.avgOverallScore), scoreToGrade(race.metrics.avgOverallScore)]
    ];

    printTable(raceColumns, raceRows);

    // FACT metrics
    console.log('\nFACT Metrics (Citation Accuracy):');
    const factColumns = [
        { header: 'Metric', width: 24, align: 'left' as const },
        { header: 'Value', width: 10, align: 'right' as const },
        { header: 'Grade', width: 8, align: 'center' as const }
    ];

    const factRows = [
        ['Citation Accuracy', `${(fact.metrics.avgCitationAccuracy * 100).toFixed(1)}%`, factScoreToGrade(fact.metrics.avgCitationAccuracy)],
        ['Support Rate', `${(fact.metrics.avgSupportRate * 100).toFixed(1)}%`, factScoreToGrade(fact.metrics.avgSupportRate)],
        ['─'.repeat(22), '─'.repeat(8), '─'.repeat(6)],
        ['Total Citations', fact.metrics.totalCitations.toString(), ''],
        ['Supported', fact.metrics.totalSupported.toString(), ''],
        ['Unsupported', fact.metrics.totalUnsupported.toString(), '']
    ];

    printTable(factColumns, factRows);

    // Combined summary
    console.log('\n' + '='.repeat(65));
    console.log(`Combined Score: ${scoreToPercent(combinedScore)} | Grade: ${summary.overallGrade}`);
    console.log('='.repeat(65));

    // Summary
    if (summary.strengths.length > 0) {
        console.log('\nStrengths:');
        for (const s of summary.strengths.slice(0, 5)) {
            console.log(`  + ${s}`);
        }
    }

    if (summary.weaknesses.length > 0) {
        console.log('\nWeaknesses:');
        for (const w of summary.weaknesses.slice(0, 5)) {
            console.log(`  - ${w}`);
        }
    }

    if (summary.recommendations.length > 0) {
        console.log('\nRecommendations:');
        for (const r of summary.recommendations.slice(0, 5)) {
            console.log(`  > ${r}`);
        }
    }

    // Final verdict
    if (combinedScore >= 0.7) {
        printVerdict('success', 'Research report generation meets high quality standards');
    } else if (combinedScore >= 0.5) {
        printVerdict('warning', 'Research report generation is acceptable but needs improvement');
    } else {
        printVerdict('failure', 'Research report generation needs significant improvement');
    }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

if (require.main === module) {
    const args = process.argv.slice(2);

    const options: Parameters<typeof runDeepResearchBenchmark>[0] = {
        queriesLimit: 10,
        papersPerQuery: 10,
        raceWeight: 0.6,
        factWeight: 0.4,
        generateCriteria: false,
        maxCitationsPerReport: 20,
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
        } else if (args[i] === '--race-weight' && args[i + 1]) {
            options.raceWeight = parseFloat(args[i + 1]);
            i++;
        } else if (args[i] === '--fact-weight' && args[i + 1]) {
            options.factWeight = parseFloat(args[i + 1]);
            i++;
        } else if (args[i] === '--generate-criteria') {
            options.generateCriteria = true;
        } else if (args[i] === '--max-citations' && args[i + 1]) {
            options.maxCitationsPerReport = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--quiet') {
            options.verbose = false;
        } else if (args[i] === '--race-only') {
            options.raceOnly = true;
        } else if (args[i] === '--fact-only') {
            options.factOnly = true;
        } else if (args[i] === '--queries' && args[i + 1]) {
            options.queryIds = args[i + 1].split(',');
            i++;
        } else if (args[i] === '--help') {
            console.log(`
DeepResearch Benchmark - Evaluate research report quality

Usage: ts-node deepresearch-bench.ts [options]

Options:
  --limit <n>           Number of queries to evaluate (default: 10)
  --papers <n>          Papers to retrieve per query (default: 10)
  --race-weight <n>     Weight for RACE score (default: 0.6)
  --fact-weight <n>     Weight for FACT score (default: 0.4)
  --generate-criteria   Generate task-specific evaluation criteria
  --max-citations <n>   Max citations to validate per report (default: 20)
  --quiet               Reduce output verbosity
  --race-only           Run only RACE evaluation
  --fact-only           Run only FACT evaluation
  --queries <ids>       Comma-separated list of query IDs to run
  --help                Show this help message

Environment variables:
  JINA_API_KEY          Required for FACT citation validation
  GROQ_API_KEY          Required for LLM evaluation
  LLM_PROVIDER          LLM provider (groq or openai)
`);
            process.exit(0);
        }
    }

    runDeepResearchBenchmark(options)
        .then(report => {
            const outputPath = saveJsonReport('deepresearch-benchmark-report.json', report);
            console.log(`\nFull report saved to: ${outputPath}`);

            // Also save leaderboard entry
            const leaderboardEntry = toLeaderboardEntry(report);
            const leaderboardPath = saveJsonReport('deepresearch-leaderboard-entry.json', leaderboardEntry);
            console.log(`Leaderboard entry saved to: ${leaderboardPath}`);

            // Save HTML report
            const htmlPath = saveHtmlReport('deepresearch-benchmark-report.html', {
                title: 'DeepResearch Benchmark Report',
                timestamp: report.timestamp,
                leaderboardScore: report.leaderboardScore,
                grade: report.summary.overallGrade,
                race: {
                    comprehensiveness: report.race.metrics.avgComprehensiveness,
                    insight: report.race.metrics.avgInsight,
                    instructionFollowing: report.race.metrics.avgInstructionFollowing,
                    readability: report.race.metrics.avgReadability,
                    overall: report.race.metrics.avgOverallScore
                },
                fact: {
                    citationAccuracy: report.fact.metrics.avgCitationAccuracy,
                    supportRate: report.fact.metrics.avgSupportRate,
                    totalCitations: report.fact.metrics.totalCitations,
                    supported: report.fact.metrics.totalSupported,
                    unsupported: report.fact.metrics.totalUnsupported,
                    unknown: report.fact.metrics.totalUnknown
                },
                summary: report.summary
            });
            console.log(`HTML report saved to: ${htmlPath}`);
            console.log(`\nOpen the HTML file in a browser to view the visual report!`);
        })
        .catch(error => {
            console.error('DeepResearch benchmark failed:', error);
            process.exit(1);
        });
}

export { DeepResearchBenchmarkResult, LeaderboardEntry };
