"use strict";
/**
 * Comparative Benchmark Runner
 * Compares Shodhak across different configurations and against baselines
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLM_CONFIGS = void 0;
exports.runComparativeBenchmark = runComparativeBenchmark;
const search_service_1 = require("../../services/search.service");
const retrieval_1 = require("../metrics/retrieval");
const generation_1 = require("../metrics/generation");
const utils_1 = require("../utils");
const ground_truth_json_1 = __importDefault(require("../datasets/ground-truth.json"));
// LLM configurations to compare
const LLM_CONFIGS = [
    {
        name: 'Groq (qwen3-32b)',
        provider: 'groq',
        model: 'qwen/qwen3-32b',
        apiKey: process.env.GROQ_API_KEY
    },
    {
        name: 'Groq (llama-3.3-70b)',
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        apiKey: process.env.GROQ_API_KEY
    },
    {
        name: 'OpenAI (gpt-4o-mini)',
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: process.env.OPENAI_API_KEY
    }
];
exports.LLM_CONFIGS = LLM_CONFIGS;
async function testLLMGeneration(config, papers, query) {
    if (!config.apiKey) {
        return { content: '', latencyMs: 0, error: 'No API key configured' };
    }
    const { client, model } = (0, utils_1.createLLMClient)(config);
    const paperContext = papers
        .map((p, idx) => `[${idx + 1}] Title: ${p.title}\nAbstract: ${p.abstract}`)
        .join('\n---\n');
    const startTime = Date.now();
    try {
        const response = await client.chat.completions.create({
            model,
            max_tokens: 2048,
            messages: [
                {
                    role: 'user',
                    content: `Write a brief literature review (300-500 words) on "${query}" based on these papers:\n\n${paperContext}\n\nUse citations [1], [2], etc.`
                }
            ]
        });
        const latencyMs = Date.now() - startTime;
        const content = response.choices[0]?.message?.content || '';
        return { content, latencyMs };
    }
    catch (error) {
        return {
            content: '',
            latencyMs: Date.now() - startTime,
            error: error.message
        };
    }
}
async function runComparativeBenchmark(options = {}) {
    const { queriesLimit = 3, papersPerQuery = 5, configs = LLM_CONFIGS.filter(c => c.apiKey), verbose = true } = options;
    const queries = ground_truth_json_1.default.queries.slice(0, queriesLimit);
    (0, utils_1.printHeader)('COMPARATIVE BENCHMARK', 45);
    console.log(`Test Queries: ${queries.length}`);
    console.log(`Papers per Query: ${papersPerQuery}`);
    console.log(`LLM Configs to Compare: ${configs.length}`);
    configs.forEach(c => console.log(`  - ${c.name}`));
    console.log('');
    const results = new Map();
    // Initialize results for each config
    for (const config of configs) {
        results.set(config.name, {
            latencies: [],
            lengths: [],
            citationDensities: [],
            citationCoverages: [],
            hallucinations: [],
            errors: 0
        });
    }
    // Also track retrieval metrics
    const retrievalLatencies = [];
    const retrievalCoverages = [];
    let retrievalSuccesses = 0;
    for (const q of queries) {
        console.log(`\n[${q.id}] "${q.query}"`);
        // First, get papers (same for all LLMs)
        const searchStart = Date.now();
        let papers = [];
        try {
            papers = await search_service_1.searchService.searchPapers(q.query, papersPerQuery);
            const searchLatency = Date.now() - searchStart;
            retrievalLatencies.push(searchLatency);
            const coverage = (0, retrieval_1.calculateKeywordCoverage)(papers.map(p => p.title), papers.map(p => p.abstract || ''), q.expected_keywords);
            retrievalCoverages.push(coverage);
            retrievalSuccesses++;
            if (verbose) {
                console.log(`   Retrieval: ${papers.length} papers, ${searchLatency}ms`);
            }
        }
        catch (error) {
            console.log(`   Retrieval FAILED: ${error}`);
            continue;
        }
        if (papers.length === 0) {
            console.log('   No papers found, skipping...');
            continue;
        }
        // Test each LLM config
        for (const config of configs) {
            if (verbose) {
                process.stdout.write(`   ${config.name}: `);
            }
            const result = await testLLMGeneration(config, papers, q.query);
            const configResults = results.get(config.name);
            if (result.error) {
                configResults.errors++;
                if (verbose) {
                    console.log(`ERROR - ${result.error}`);
                }
            }
            else {
                const wordCount = result.content.split(/\s+/).length;
                const citDensity = (0, generation_1.calculateCitationDensity)(result.content);
                const citCoverage = (0, generation_1.calculateCitationCoverage)(result.content, papers.length);
                const hallucinations = (0, generation_1.detectHallucinatedCitations)(result.content, papers.length);
                configResults.latencies.push(result.latencyMs);
                configResults.lengths.push(wordCount);
                configResults.citationDensities.push(citDensity);
                configResults.citationCoverages.push(citCoverage);
                configResults.hallucinations.push(hallucinations.length);
                if (verbose) {
                    console.log(`${wordCount} words, ${result.latencyMs}ms, ${hallucinations.length} halluc.`);
                }
            }
            // Rate limiting between API calls
            await (0, utils_1.delayBetweenAPICalls)();
        }
    }
    // Compile results
    const compiledResults = [];
    const avgRetLatency = retrievalLatencies.length > 0
        ? retrievalLatencies.reduce((a, b) => a + b, 0) / retrievalLatencies.length
        : 0;
    const avgRetCoverage = retrievalCoverages.length > 0
        ? retrievalCoverages.reduce((a, b) => a + b, 0) / retrievalCoverages.length
        : 0;
    for (const config of configs) {
        const r = results.get(config.name);
        const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        compiledResults.push({
            config: config.name,
            retrieval: {
                avgLatencyMs: avgRetLatency,
                keywordCoverage: avgRetCoverage,
                successRate: retrievalSuccesses / queries.length
            },
            generation: {
                avgLatencyMs: avg(r.latencies),
                avgLength: avg(r.lengths),
                citationDensity: avg(r.citationDensities),
                citationCoverage: avg(r.citationCoverages),
                hallucinationRate: avg(r.hallucinations)
            }
        });
    }
    // Generate rankings
    const rankings = generateRankings(compiledResults);
    // Print comparison table
    (0, utils_1.printHeader)('COMPARISON RESULTS', 68);
    const tableColumns = [
        { header: 'Model', width: 25, align: 'left' },
        { header: 'Latency', width: 10, align: 'right' },
        { header: 'Length', width: 8, align: 'right' },
        { header: 'Cit.Dens', width: 10, align: 'right' },
        { header: 'Halluc', width: 8, align: 'right' }
    ];
    const tableRows = compiledResults.map(r => [
        r.config,
        `${(r.generation.avgLatencyMs / 1000).toFixed(1)}s`,
        r.generation.avgLength.toFixed(0),
        r.generation.citationDensity.toFixed(2),
        r.generation.hallucinationRate.toFixed(1)
    ]);
    (0, utils_1.printTable)(tableColumns, tableRows);
    // Print rankings
    console.log('\nRankings:');
    for (const ranking of rankings) {
        console.log(`  ${ranking.metric}: ${ranking.ranking.join(' > ')}`);
    }
    // Generate summary
    const bestOverall = determineBestOverall(compiledResults);
    const summary = `Best overall: ${bestOverall}. ` +
        `Fastest: ${rankings.find(r => r.metric === 'Speed')?.ranking[0]}. ` +
        `Most accurate: ${rankings.find(r => r.metric === 'Citation Accuracy')?.ranking[0]}.`;
    console.log(`\n${summary}`);
    return {
        timestamp: new Date().toISOString(),
        testQueries: queries.length,
        results: compiledResults,
        rankings,
        summary
    };
}
function generateRankings(results) {
    const rankings = [];
    // Speed (lower is better)
    const bySpeed = [...results]
        .filter(r => r.generation.avgLatencyMs > 0)
        .sort((a, b) => a.generation.avgLatencyMs - b.generation.avgLatencyMs);
    rankings.push({
        metric: 'Speed',
        ranking: bySpeed.map(r => r.config)
    });
    // Citation Density (higher is better)
    const byCitDensity = [...results]
        .filter(r => r.generation.citationDensity > 0)
        .sort((a, b) => b.generation.citationDensity - a.generation.citationDensity);
    rankings.push({
        metric: 'Citation Density',
        ranking: byCitDensity.map(r => r.config)
    });
    // Citation Accuracy (lower hallucinations is better)
    const byAccuracy = [...results]
        .sort((a, b) => a.generation.hallucinationRate - b.generation.hallucinationRate);
    rankings.push({
        metric: 'Citation Accuracy',
        ranking: byAccuracy.map(r => r.config)
    });
    // Length (moderate is best, penalize extremes)
    const idealLength = 400;
    const byLength = [...results]
        .filter(r => r.generation.avgLength > 0)
        .sort((a, b) => Math.abs(a.generation.avgLength - idealLength) -
        Math.abs(b.generation.avgLength - idealLength));
    rankings.push({
        metric: 'Appropriate Length',
        ranking: byLength.map(r => r.config)
    });
    return rankings;
}
function determineBestOverall(results) {
    // Simple scoring: lower is better
    const scores = results.map(r => {
        let score = 0;
        // Normalize and weight each metric
        const maxLatency = Math.max(...results.map(x => x.generation.avgLatencyMs)) || 1;
        score += (r.generation.avgLatencyMs / maxLatency) * 30; // 30% weight for speed
        score += r.generation.hallucinationRate * 40; // 40% weight for accuracy
        const maxCitCov = Math.max(...results.map(x => x.generation.citationCoverage)) || 1;
        score += (1 - r.generation.citationCoverage / maxCitCov) * 30; // 30% weight for coverage
        return { config: r.config, score };
    });
    scores.sort((a, b) => a.score - b.score);
    return scores[0]?.config || 'Unknown';
}
// Run if called directly
if (require.main === module) {
    runComparativeBenchmark({ verbose: true })
        .then(report => {
        const outputPath = (0, utils_1.saveJsonReport)('comparative-benchmark-report.json', report);
        console.log(`\nReport saved to: ${outputPath}`);
    })
        .catch(console.error)
        .finally(() => process.exit(0));
}
