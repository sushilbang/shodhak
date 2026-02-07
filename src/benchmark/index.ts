/**
 * Shodhak Benchmark Suite
 * Run all benchmarks and generate a comprehensive report
 */

import { runRetrievalBenchmark, RetrievalBenchmarkResult } from './runners/retrieval-bench';
import { runGenerationBenchmark } from './runners/generation-bench';
import { runRACEBenchmark } from './runners/race-bench';
import { runFACTBenchmark } from './runners/fact-bench';
import { runDeepResearchBenchmark } from './runners/deepresearch-bench';
import {
    printHeader,
    printKeyValue,
    printList,
    saveJsonReport
} from './utils';

interface FullBenchmarkReport {
    timestamp: string;
    system: {
        llmProvider: string;
        searchProvider: string;
        embeddingProvider: string;
    };
    retrieval: RetrievalBenchmarkResult;
    generation: Awaited<ReturnType<typeof runGenerationBenchmark>>;
    summary: {
        overallScore: number;
        strengths: string[];
        weaknesses: string[];
        recommendations: string[];
    };
}

async function runFullBenchmark(): Promise<FullBenchmarkReport> {
    printHeader('SHODHAK FULL BENCHMARK SUITE', 45);

    const startTime = Date.now();

    // Get system info
    const system = {
        llmProvider: process.env.LLM_PROVIDER || 'groq',
        searchProvider: process.env.PRIMARY_PAPER_PROVIDER || 'openalex',
        embeddingProvider: 'openai'
    };

    console.log('System Configuration:');
    printKeyValue({
        'LLM Provider': system.llmProvider,
        'Search Provider': system.searchProvider,
        'Embedding Provider': system.embeddingProvider
    });

    // Run retrieval benchmark
    console.log('\n--- Running Retrieval Benchmark ---');
    const retrievalResults = await runRetrievalBenchmark({ verbose: true });

    // Run generation benchmark
    console.log('\n--- Running Generation Benchmark ---');
    const generationResults = await runGenerationBenchmark({
        queriesLimit: 3,
        papersPerQuery: 5,
        verbose: true
    });

    // Calculate overall score and generate insights
    const summary = generateSummary(retrievalResults, generationResults);

    const totalTime = Date.now() - startTime;

    const report: FullBenchmarkReport = {
        timestamp: new Date().toISOString(),
        system,
        retrieval: retrievalResults,
        generation: generationResults,
        summary
    };

    // Print final summary
    printHeader('BENCHMARK SUMMARY', 45);

    console.log(`Overall Score: ${summary.overallScore.toFixed(1)}/100\n`);

    console.log('Strengths:');
    printList(summary.strengths, '✓');

    console.log('\nWeaknesses:');
    printList(summary.weaknesses, '✗');

    console.log('\nRecommendations:');
    printList(summary.recommendations, '→');

    console.log(`\nTotal benchmark time: ${(totalTime / 1000).toFixed(1)}s`);

    return report;
}

function generateSummary(
    retrieval: RetrievalBenchmarkResult,
    generation: Awaited<ReturnType<typeof runGenerationBenchmark>>
): FullBenchmarkReport['summary'] {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Retrieval analysis
    const keywordCov = retrieval.avgKeywordCoverage;
    const hitRate = retrieval.aggregatedMetrics.hitRate;
    const avgLatency = retrieval.aggregatedMetrics.avgLatencyMs;

    if (keywordCov > 0.7) {
        strengths.push(`High keyword coverage (${(keywordCov * 100).toFixed(0)}%)`);
    } else if (keywordCov < 0.5) {
        weaknesses.push(`Low keyword coverage (${(keywordCov * 100).toFixed(0)}%)`);
        recommendations.push('Consider query expansion or synonym matching');
    }

    if (hitRate > 0.8) {
        strengths.push(`Good hit rate (${(hitRate * 100).toFixed(0)}%)`);
    } else if (hitRate < 0.5) {
        weaknesses.push(`Low hit rate (${(hitRate * 100).toFixed(0)}%)`);
    }

    if (avgLatency < 2000) {
        strengths.push(`Fast retrieval (${avgLatency.toFixed(0)}ms avg)`);
    } else if (avgLatency > 5000) {
        weaknesses.push(`Slow retrieval (${avgLatency.toFixed(0)}ms avg)`);
        recommendations.push('Consider caching or parallel requests');
    }

    // Generation analysis
    const citDensity = generation.literatureReview.citationDensity;
    const citCoverage = generation.literatureReview.citationCoverage;
    const hallRate = generation.literatureReview.hallucinationRate;
    const genLatency = generation.literatureReview.avgLatencyMs;

    if (citDensity > 2) {
        strengths.push(`Good citation density (${citDensity.toFixed(1)} per 100 words)`);
    } else if (citDensity < 1) {
        weaknesses.push(`Low citation density (${citDensity.toFixed(1)} per 100 words)`);
        recommendations.push('Improve prompts to encourage more citations');
    }

    if (citCoverage > 0.7) {
        strengths.push(`High citation coverage (${(citCoverage * 100).toFixed(0)}%)`);
    } else if (citCoverage < 0.4) {
        weaknesses.push(`Low citation coverage (${(citCoverage * 100).toFixed(0)}%)`);
    }

    if (hallRate === 0) {
        strengths.push('No citation hallucinations detected');
    } else if (hallRate > 0.5) {
        weaknesses.push(`Citation hallucinations detected (${hallRate.toFixed(1)} per review)`);
        recommendations.push('Add citation validation in post-processing');
    }

    if (genLatency < 10000) {
        strengths.push(`Reasonable generation latency (${(genLatency / 1000).toFixed(1)}s)`);
    } else {
        weaknesses.push(`Slow generation (${(genLatency / 1000).toFixed(1)}s)`);
        recommendations.push('Consider using a faster LLM provider (e.g., Groq)');
    }

    // Calculate overall score (0-100)
    let score = 50; // Base score

    // Retrieval contribution (40 points max)
    score += keywordCov * 15;
    score += hitRate * 15;
    score += Math.max(0, (3000 - avgLatency) / 300); // Up to 10 points for speed

    // Generation contribution (40 points max)
    score += Math.min(citDensity, 3) * 5; // Up to 15 points
    score += citCoverage * 15;
    score -= hallRate * 10; // Penalty for hallucinations
    score += Math.max(0, (15000 - genLatency) / 1500); // Up to 10 points for speed

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, score));

    return {
        overallScore: score,
        strengths,
        weaknesses,
        recommendations
    };
}

// CLI execution
if (require.main === module) {
    runFullBenchmark()
        .then(report => {
            const outputPath = saveJsonReport('benchmark-report.json', report);
            console.log(`\nFull report saved to: ${outputPath}`);
        })
        .catch(error => {
            console.error('Benchmark failed:', error);
            process.exit(1);
        });
}

export { runFullBenchmark };
export { runRACEBenchmark } from './runners/race-bench';
export { runFACTBenchmark } from './runners/fact-bench';
export { runDeepResearchBenchmark } from './runners/deepresearch-bench';
