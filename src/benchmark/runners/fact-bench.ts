/**
 * FACT Benchmark Runner
 *
 * Evaluates citation accuracy using the FACT framework:
 * - Citation extraction from markdown reports
 * - URL deduplication
 * - Web content scraping via Jina API
 * - LLM-based claim validation
 *
 * Measures: Citation accuracy, support rate, accessibility
 */

import { searchService } from '../../services/search.service';
import { llmService } from '../../services/llm.service';
import {
    evaluateCitationAccuracy,
    extractCitationStats,
    aggregateFACTResults,
    generateFACTSummary,
    factScoreToGrade,
    isFACTAvailable,
    FACTResult
} from '../metrics/fact-metrics';
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

interface FACTQueryResult {
    queryId: string;
    topic: string;
    domain: string;
    reportLength: number;
    result: FACTResult;
    latencyMs: number;
    papersRetrieved: number;
}

interface FACTBenchmarkResult {
    timestamp: string;
    benchmarkType: 'fact';
    totalQueries: number;
    completedQueries: number;
    metrics: {
        avgCitationAccuracy: number;
        avgSupportRate: number;
        totalCitations: number;
        totalSupported: number;
        totalUnsupported: number;
        totalUnknown: number;
    };
    queryResults: FACTQueryResult[];
    summary: {
        strengths: string[];
        weaknesses: string[];
        recommendations: string[];
    };
    configuration: {
        queriesLimit: number;
        papersPerQuery: number;
        maxCitationsPerReport: number;
        jinaConfigured: boolean;
    };
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

/**
 * Run the FACT benchmark
 *
 * @param options - Benchmark options
 * @returns FACT benchmark results
 */
export async function runFACTBenchmark(
    options: {
        /** Number of queries to evaluate (default: 5) */
        queriesLimit?: number;
        /** Papers to retrieve per query (default: 10) */
        papersPerQuery?: number;
        /** Max citations to validate per report (default: 20) */
        maxCitationsPerReport?: number;
        /** Verbose output */
        verbose?: boolean;
        /** Specific query IDs to run */
        queryIds?: string[];
        /** Skip URL scraping (dry run) */
        dryRun?: boolean;
    } = {}
): Promise<FACTBenchmarkResult> {
    const {
        queriesLimit = 5,
        papersPerQuery = 10,
        maxCitationsPerReport = 20,
        verbose = true,
        queryIds,
        dryRun = false
    } = options;

    // Check if Jina is configured
    const jinaConfigured = isFACTAvailable();

    if (!jinaConfigured && !dryRun) {
        console.warn('\nWARNING: JINA_API_KEY not configured.');
        console.warn('Citation validation will be limited. Set JINA_API_KEY for full evaluation.\n');
    }

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

    const queryResults: FACTQueryResult[] = [];
    const allResults: FACTResult[] = [];

    // Print header
    printHeader('FACT BENCHMARK - Citation Accuracy Evaluation', 55);
    printKeyValue({
        'Test Queries': queries.length,
        'Papers per Query': papersPerQuery,
        'Max Citations per Report': maxCitationsPerReport,
        'Jina API': jinaConfigured ? 'Configured' : 'NOT CONFIGURED',
        'Mode': dryRun ? 'Dry Run (stats only)' : 'Full Validation'
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

            // Step 3: Extract citation statistics (quick)
            const citationStats = extractCitationStats(review.content);

            if (verbose) {
                console.log(`   Found ${citationStats.totalCitations} citations (${citationStats.uniqueUrls} unique URLs)`);
                console.log(`     - Numbered: ${citationStats.breakdown.numbered}`);
                console.log(`     - Inline URLs: ${citationStats.breakdown.inlineUrl}`);
                console.log(`     - DOIs: ${citationStats.breakdown.doi}`);
            }

            let result: FACTResult;

            if (dryRun) {
                // Skip actual validation in dry run mode
                result = {
                    totalCitations: citationStats.totalCitations,
                    validatableCitations: 0,
                    effectiveCitations: 0,
                    citationAccuracy: 0,
                    supportRate: 0,
                    statusBreakdown: { supported: 0, unsupported: 0, unknown: citationStats.totalCitations },
                    validations: [],
                    scrapedUrls: [],
                    failedUrls: []
                };
            } else {
                // Step 4: Full citation validation
                if (verbose) {
                    console.log('   Validating citations...');
                }

                result = await evaluateCitationAccuracy(review.content, {
                    maxCitations: maxCitationsPerReport,
                    verbose: false
                });
            }

            const latencyMs = Date.now() - startTime;
            allResults.push(result);

            queryResults.push({
                queryId: query.id,
                topic: query.topic,
                domain: query.domain,
                reportLength,
                result,
                latencyMs,
                papersRetrieved: papers.length
            });

            // Print results
            if (verbose) {
                console.log(`   Total Citations:    ${result.totalCitations}`);
                console.log(`   Validatable:        ${result.validatableCitations}`);
                console.log(`   Supported:          ${result.statusBreakdown.supported}`);
                console.log(`   Unsupported:        ${result.statusBreakdown.unsupported}`);
                console.log(`   Unknown:            ${result.statusBreakdown.unknown}`);
                console.log(`   Citation Accuracy:  ${(result.citationAccuracy * 100).toFixed(1)}% (${factScoreToGrade(result.citationAccuracy)})`);
                console.log(`   Support Rate:       ${(result.supportRate * 100).toFixed(1)}%`);
                console.log(`   Latency: ${(latencyMs / 1000).toFixed(1)}s`);
            }

        } catch (error) {
            console.error(`   ERROR: ${error}`);
        }

        await delayBetweenAPICalls();
    }

    // Aggregate metrics
    const aggregated = aggregateFACTResults(allResults);

    // Generate summary
    const summary = generateBenchmarkSummary(aggregated, queryResults);

    // Print final results
    printResults(aggregated, queryResults, summary);

    const result: FACTBenchmarkResult = {
        timestamp: new Date().toISOString(),
        benchmarkType: 'fact',
        totalQueries: queries.length,
        completedQueries: queryResults.length,
        metrics: aggregated,
        queryResults,
        summary,
        configuration: {
            queriesLimit,
            papersPerQuery,
            maxCitationsPerReport,
            jinaConfigured
        }
    };

    return result;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateBenchmarkSummary(
    metrics: ReturnType<typeof aggregateFACTResults>,
    queryResults: FACTQueryResult[]
): { strengths: string[]; weaknesses: string[]; recommendations: string[] } {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Citation accuracy analysis
    if (metrics.avgCitationAccuracy >= 0.8) {
        strengths.push(`High citation accuracy (${(metrics.avgCitationAccuracy * 100).toFixed(1)}%)`);
    } else if (metrics.avgCitationAccuracy < 0.5) {
        weaknesses.push(`Low citation accuracy (${(metrics.avgCitationAccuracy * 100).toFixed(1)}%)`);
        recommendations.push('Implement citation verification in the generation pipeline');
    }

    // Support rate analysis
    if (metrics.avgSupportRate >= 0.9) {
        strengths.push(`Excellent support rate (${(metrics.avgSupportRate * 100).toFixed(1)}%)`);
    } else if (metrics.avgSupportRate < 0.6) {
        weaknesses.push(`Many citations not supported by sources`);
        recommendations.push('Review and verify citations before finalizing reports');
    }

    // Citation count analysis
    const avgCitations = metrics.totalCitations / Math.max(metrics.totalEvaluations, 1);
    if (avgCitations >= 10) {
        strengths.push(`Good citation density (avg ${avgCitations.toFixed(1)} per report)`);
    } else if (avgCitations < 3) {
        weaknesses.push(`Low citation count (avg ${avgCitations.toFixed(1)} per report)`);
        recommendations.push('Encourage more citations to support claims');
    }

    // Unsupported citations analysis
    const unsupportedRate = metrics.totalUnsupported / Math.max(metrics.totalCitations, 1);
    if (unsupportedRate > 0.2) {
        weaknesses.push(`High rate of unsupported citations (${(unsupportedRate * 100).toFixed(1)}%)`);
        recommendations.push('Add post-generation fact-checking against source documents');
    }

    // Unknown citations analysis
    const unknownRate = metrics.totalUnknown / Math.max(metrics.totalCitations, 1);
    if (unknownRate > 0.3) {
        weaknesses.push(`Many citations could not be validated (${(unknownRate * 100).toFixed(1)}%)`);
        recommendations.push('Use more stable URL sources (DOIs, arXiv links)');
    }

    // Domain-specific analysis
    const domainScores = new Map<string, number[]>();
    for (const qr of queryResults) {
        if (!domainScores.has(qr.domain)) {
            domainScores.set(qr.domain, []);
        }
        domainScores.get(qr.domain)!.push(qr.result.citationAccuracy);
    }

    // Find domains with consistently low scores
    for (const [domain, scores] of domainScores) {
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avgScore < 0.4 && scores.length >= 2) {
            weaknesses.push(`Low citation accuracy in ${domain} domain`);
        }
    }

    return { strengths, weaknesses, recommendations };
}

function printResults(
    metrics: ReturnType<typeof aggregateFACTResults>,
    queryResults: FACTQueryResult[],
    summary: { strengths: string[]; weaknesses: string[]; recommendations: string[] }
): void {
    printHeader('FACT BENCHMARK RESULTS', 60);

    // Metrics table
    const tableColumns = [
        { header: 'Metric', width: 24, align: 'left' as const },
        { header: 'Value', width: 15, align: 'right' as const },
        { header: 'Grade', width: 8, align: 'center' as const }
    ];

    const tableRows = [
        ['Citation Accuracy', `${(metrics.avgCitationAccuracy * 100).toFixed(1)}%`, factScoreToGrade(metrics.avgCitationAccuracy)],
        ['Support Rate', `${(metrics.avgSupportRate * 100).toFixed(1)}%`, factScoreToGrade(metrics.avgSupportRate)],
        ['─'.repeat(22), '─'.repeat(13), '─'.repeat(6)],
        ['Total Citations', metrics.totalCitations.toString(), ''],
        ['Supported', metrics.totalSupported.toString(), ''],
        ['Unsupported', metrics.totalUnsupported.toString(), ''],
        ['Unknown', metrics.totalUnknown.toString(), '']
    ];

    printTable(tableColumns, tableRows);

    // Statistics
    console.log(`\nReports Evaluated: ${metrics.totalEvaluations}`);
    console.log(`Avg Citations/Report: ${(metrics.totalCitations / Math.max(metrics.totalEvaluations, 1)).toFixed(1)}`);

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
    if (metrics.avgCitationAccuracy >= 0.7) {
        printVerdict('success', 'Citation accuracy meets quality standards');
    } else if (metrics.avgCitationAccuracy >= 0.5) {
        printVerdict('warning', 'Citation accuracy needs improvement');
    } else {
        printVerdict('failure', 'Citation accuracy is below acceptable threshold');
    }

    // Per-query breakdown for low scores
    const lowScoreQueries = queryResults.filter(q => q.result.citationAccuracy < 0.5);
    if (lowScoreQueries.length > 0) {
        console.log('\nQueries with Low Citation Accuracy:');
        for (const q of lowScoreQueries.slice(0, 5)) {
            console.log(`  ${q.queryId}: ${q.topic} - ${(q.result.citationAccuracy * 100).toFixed(1)}%`);
        }
    }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

if (require.main === module) {
    const args = process.argv.slice(2);

    const options: Parameters<typeof runFACTBenchmark>[0] = {
        queriesLimit: 5,
        papersPerQuery: 10,
        maxCitationsPerReport: 20,
        verbose: true,
        dryRun: false
    };

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
            options.queriesLimit = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--papers' && args[i + 1]) {
            options.papersPerQuery = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--max-citations' && args[i + 1]) {
            options.maxCitationsPerReport = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--quiet') {
            options.verbose = false;
        } else if (args[i] === '--dry-run') {
            options.dryRun = true;
        } else if (args[i] === '--queries' && args[i + 1]) {
            options.queryIds = args[i + 1].split(',');
            i++;
        }
    }

    runFACTBenchmark(options)
        .then(report => {
            const outputPath = saveJsonReport('fact-benchmark-report.json', report);
            console.log(`\nReport saved to: ${outputPath}`);

            // Save HTML report
            const htmlPath = saveHtmlReport('fact-benchmark-report.html', {
                title: 'FACT Benchmark Report - Citation Accuracy',
                timestamp: report.timestamp,
                leaderboardScore: Math.round(report.metrics.avgCitationAccuracy * 100),
                grade: factScoreToGrade(report.metrics.avgCitationAccuracy),
                fact: {
                    citationAccuracy: report.metrics.avgCitationAccuracy,
                    supportRate: report.metrics.avgSupportRate,
                    totalCitations: report.metrics.totalCitations,
                    supported: report.metrics.totalSupported,
                    unsupported: report.metrics.totalUnsupported,
                    unknown: report.metrics.totalUnknown
                },
                summary: report.summary
            });
            console.log(`HTML report saved to: ${htmlPath}`);
        })
        .catch(error => {
            console.error('FACT benchmark failed:', error);
            process.exit(1);
        });
}

export { FACTBenchmarkResult, FACTQueryResult };
