/**
 * Benchmark Configuration
 * Centralized configuration for all benchmark runners
 */

export interface RetrievalBenchmarkConfig {
    queriesLimit: number;
    resultsPerQuery: number;
    timeoutMs: number;
}

export interface GenerationBenchmarkConfig {
    queriesLimit: number;
    papersPerQuery: number;
    timeoutMs: number;
    maxTokens: number;
}

export interface ComparativeBenchmarkConfig {
    queriesLimit: number;
    papersPerQuery: number;
    idealResponseLength: number;
}

export interface BenchmarkConfig {
    retrieval: RetrievalBenchmarkConfig;
    generation: GenerationBenchmarkConfig;
    comparative: ComparativeBenchmarkConfig;
    rateLimit: {
        betweenQueries: number;
        betweenAPICalls: number;
        betweenBenchmarks: number;
    };
    output: {
        directory: string;
        verbose: boolean;
    };
}

export const DEFAULT_CONFIG: BenchmarkConfig = {
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

let currentConfig: BenchmarkConfig = { ...DEFAULT_CONFIG };

/**
 * Get the current benchmark configuration
 */
export function getConfig(): BenchmarkConfig {
    return currentConfig;
}

/**
 * Update benchmark configuration
 */
export function setConfig(config: Partial<BenchmarkConfig>): void {
    currentConfig = mergeDeep(currentConfig, config);
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): void {
    currentConfig = { ...DEFAULT_CONFIG };
}

/**
 * Get configuration for a specific benchmark type
 */
export function getRetrievalConfig(): RetrievalBenchmarkConfig {
    return currentConfig.retrieval;
}

export function getGenerationConfig(): GenerationBenchmarkConfig {
    return currentConfig.generation;
}

export function getComparativeConfig(): ComparativeBenchmarkConfig {
    return currentConfig.comparative;
}

/**
 * Deep merge utility
 */
function mergeDeep<T extends object>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
        if (source[key] !== undefined) {
            if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = mergeDeep(
                    target[key] as object,
                    source[key] as object
                ) as T[Extract<keyof T, string>];
            } else {
                result[key] = source[key] as T[Extract<keyof T, string>];
            }
        }
    }

    return result;
}
