"use strict";
/**
 * Rate Limiter Utility
 * Centralized rate limiting for API calls
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureRateLimits = configureRateLimits;
exports.getRateLimitConfig = getRateLimitConfig;
exports.delayBetweenQueries = delayBetweenQueries;
exports.delayBetweenAPICalls = delayBetweenAPICalls;
exports.delayBetweenBenchmarks = delayBetweenBenchmarks;
exports.delay = delay;
exports.withRateLimit = withRateLimit;
const DEFAULT_CONFIG = {
    betweenQueries: 500,
    betweenAPICalls: 500,
    betweenBenchmarks: 1000
};
let config = { ...DEFAULT_CONFIG };
/**
 * Configure rate limiting delays
 */
function configureRateLimits(newConfig) {
    config = { ...config, ...newConfig };
}
/**
 * Get current rate limit configuration
 */
function getRateLimitConfig() {
    return { ...config };
}
/**
 * Delay between search queries
 */
async function delayBetweenQueries() {
    await delay(config.betweenQueries);
}
/**
 * Delay between LLM API calls
 */
async function delayBetweenAPICalls() {
    await delay(config.betweenAPICalls);
}
/**
 * Delay between benchmark runs
 */
async function delayBetweenBenchmarks() {
    await delay(config.betweenBenchmarks);
}
/**
 * Generic delay function
 */
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Create a rate-limited version of an async function
 */
function withRateLimit(fn, delayMs) {
    return (async (...args) => {
        const result = await fn(...args);
        await delay(delayMs);
        return result;
    });
}
