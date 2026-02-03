/**
 * Rate Limiter Utility
 * Centralized rate limiting for API calls
 */

export interface RateLimitConfig {
    betweenQueries: number;      // Delay between search queries (ms)
    betweenAPICalls: number;     // Delay between LLM API calls (ms)
    betweenBenchmarks: number;   // Delay between benchmark runs (ms)
}

const DEFAULT_CONFIG: RateLimitConfig = {
    betweenQueries: 500,
    betweenAPICalls: 500,
    betweenBenchmarks: 1000
};

let config = { ...DEFAULT_CONFIG };

/**
 * Configure rate limiting delays
 */
export function configureRateLimits(newConfig: Partial<RateLimitConfig>): void {
    config = { ...config, ...newConfig };
}

/**
 * Get current rate limit configuration
 */
export function getRateLimitConfig(): RateLimitConfig {
    return { ...config };
}

/**
 * Delay between search queries
 */
export async function delayBetweenQueries(): Promise<void> {
    await delay(config.betweenQueries);
}

/**
 * Delay between LLM API calls
 */
export async function delayBetweenAPICalls(): Promise<void> {
    await delay(config.betweenAPICalls);
}

/**
 * Delay between benchmark runs
 */
export async function delayBetweenBenchmarks(): Promise<void> {
    await delay(config.betweenBenchmarks);
}

/**
 * Generic delay function
 */
export async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a rate-limited version of an async function
 */
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    delayMs: number
): T {
    return (async (...args: Parameters<T>) => {
        const result = await fn(...args);
        await delay(delayMs);
        return result;
    }) as T;
}
