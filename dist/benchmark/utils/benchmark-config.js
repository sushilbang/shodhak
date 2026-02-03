"use strict";
/**
 * Benchmark Configuration
 * Centralized configuration for all benchmark runners
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.getConfig = getConfig;
exports.setConfig = setConfig;
exports.resetConfig = resetConfig;
exports.getRetrievalConfig = getRetrievalConfig;
exports.getGenerationConfig = getGenerationConfig;
exports.getComparativeConfig = getComparativeConfig;
exports.DEFAULT_CONFIG = {
    retrieval: {
        queriesLimit: 10,
        resultsPerQuery: 10,
        timeoutMs: 30000
    },
    generation: {
        queriesLimit: 3,
        papersPerQuery: 5,
        timeoutMs: 60000,
        maxTokens: 4096
    },
    comparative: {
        queriesLimit: 3,
        papersPerQuery: 5,
        idealResponseLength: 400
    },
    rateLimit: {
        betweenQueries: 500,
        betweenAPICalls: 500,
        betweenBenchmarks: 1000
    },
    output: {
        directory: process.cwd(),
        verbose: true
    }
};
let currentConfig = { ...exports.DEFAULT_CONFIG };
/**
 * Get the current benchmark configuration
 */
function getConfig() {
    return currentConfig;
}
/**
 * Update benchmark configuration
 */
function setConfig(config) {
    currentConfig = mergeDeep(currentConfig, config);
}
/**
 * Reset configuration to defaults
 */
function resetConfig() {
    currentConfig = { ...exports.DEFAULT_CONFIG };
}
/**
 * Get configuration for a specific benchmark type
 */
function getRetrievalConfig() {
    return currentConfig.retrieval;
}
function getGenerationConfig() {
    return currentConfig.generation;
}
function getComparativeConfig() {
    return currentConfig.comparative;
}
/**
 * Deep merge utility
 */
function mergeDeep(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] !== undefined) {
            if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = mergeDeep(target[key], source[key]);
            }
            else {
                result[key] = source[key];
            }
        }
    }
    return result;
}
