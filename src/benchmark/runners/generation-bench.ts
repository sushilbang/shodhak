/**
 * Generation Benchmark Runner
 * Tests the LLM generation quality (summaries, reviews, comparisons)
 */

import { searchService } from '../../services/search.service';
import { llmService } from '../../services/llm.service';
import {
    extractCitations,
    calculateCitationDensity,
    calculateCitationCoverage,
    detectHallucinatedCitations,
    aggregateGenerationMetrics,
    GenerationResult
} from '../metrics/generation';
import {
    printHeader,
    printSection,
    printKeyValue
} from '../utils/console-formatter';
import { delayBetweenAPICalls, saveJsonReport } from '../utils';
import groundTruth from '../datasets/ground-truth.json';

interface GenerationBenchmarkResult {
    timestamp: string;
    totalTests: number;
    literatureReview: {
        avgLength: number;
        citationDensity: number;
        citationCoverage: number;
        hallucinationRate: number;
        avgLatencyMs: number;
    };
    summary: {
        avgLength: number;
        avgLatencyMs: number;
    };
    comparison: {
        avgLength: number;
        citationDensity: number;
        avgLatencyMs: number;
    };
    details: Array<{
        query: string;
        type: string;
        paperCount: number;
        generatedLength: number;
        citations: number[];
        hallucinations: number[];
        latencyMs: number;
    }>;
}

export async function runGenerationBenchmark(
    options: {
        queriesLimit?: number;
        papersPerQuery?: number;
        verbose?: boolean;
    } = {}
): Promise<GenerationBenchmarkResult> {
    const { queriesLimit = 3, papersPerQuery = 5, verbose = true } = options;

    const queries = groundTruth.queries.slice(0, queriesLimit);

    printHeader('SHODHAK GENERATION BENCHMARK');
    printKeyValue({
        'Test Queries': queries.length,
        'Papers per Query': papersPerQuery
    });
    console.log();

    const reviewResults: GenerationResult[] = [];
    const summaryResults: GenerationResult[] = [];
    const comparisonResults: GenerationResult[] = [];
    const details: GenerationBenchmarkResult['details'] = [];

    let totalHallucinations = 0;
    let totalReviews = 0;

    for (const q of queries) {
        if (verbose) {
            console.log(`\n[${q.id}] "${q.query}"`);
        }

        try {
            // First, get papers
            const papers = await searchService.searchPapers(q.query, papersPerQuery);

            if (papers.length === 0) {
                console.log('   No papers found, skipping...');
                continue;
            }

            if (verbose) {
                console.log(`   Found ${papers.length} papers`);
            }

            // Test 1: Literature Review
            if (verbose) console.log('   Generating literature review...');
            const reviewStart = Date.now();
            const review = await llmService.generateLiteratureReview(papers, q.query);
            const reviewLatency = Date.now() - reviewStart;

            const reviewCitations = extractCitations(review.content);
            const reviewHallucinations = detectHallucinatedCitations(review.content, papers.length);

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
            if (verbose) console.log('   Generating summary...');
            const summaryStart = Date.now();
            const summary = await llmService.summarizePaper(papers[0]);
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
                if (verbose) console.log('   Generating comparison...');
                const compareStart = Date.now();
                const comparison = await llmService.comparePapers(papers.slice(0, 3));
                const compareLatency = Date.now() - compareStart;

                const compareCitations = extractCitations(comparison);

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

        } catch (error) {
            console.error(`   ERROR: ${error}`);
        }

        // Rate limiting
        await delayBetweenAPICalls();
    }

    // Aggregate results
    const reviewAgg = aggregateGenerationMetrics(reviewResults);
    const summaryAgg = aggregateGenerationMetrics(summaryResults);
    const comparisonAgg = aggregateGenerationMetrics(comparisonResults);

    // Print summary
    printSection('GENERATION BENCHMARK RESULTS');

    console.log('Literature Reviews:');
    printKeyValue({
        'Avg Length': `${reviewAgg.avgLength.toFixed(0)} words`,
        'Citation Density': `${reviewAgg.citationDensity.toFixed(2)} per 100 words`,
        'Citation Coverage': `${(reviewAgg.citationCoverage * 100).toFixed(1)}%`,
        'Hallucination Rate': `${totalReviews > 0 ? (totalHallucinations / totalReviews).toFixed(2) : 0} per review`,
        'Avg Latency': `${reviewAgg.avgLatencyMs.toFixed(0)}ms`
    });

    console.log('\nSummaries:');
    printKeyValue({
        'Avg Length': `${summaryAgg.avgLength.toFixed(0)} words`,
        'Avg Latency': `${summaryAgg.avgLatencyMs.toFixed(0)}ms`
    });

    console.log('\nComparisons:');
    printKeyValue({
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
            const outputPath = saveJsonReport('generation-benchmark-results.json', results);
            console.log(`\n\nFull results saved to: ${outputPath}`);
        })
        .catch(console.error)
        .finally(() => process.exit(0));
}
