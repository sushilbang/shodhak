/**
 * LLM Client Factory
 * Centralized factory for creating OpenAI-compatible LLM clients
 */

import OpenAI from 'openai';

export type LLMProvider = 'groq' | 'openai';

export interface LLMClientConfig {
    provider: LLMProvider;
    apiKey?: string;
    baseURL?: string;
    model?: string;
}

export interface LLMClientResult {
    client: OpenAI;
    model: string;
    provider: LLMProvider;
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
    groq: 'qwen/qwen3-32b',
    openai: 'gpt-4o-mini'
};

const DEFAULT_BASE_URLS: Record<LLMProvider, string | undefined> = {
    groq: 'https://api.groq.com/openai/v1',
    openai: undefined
};

/**
 * Create an OpenAI-compatible client for any supported LLM provider
 */
export function createLLMClient(config?: Partial<LLMClientConfig>): LLMClientResult {
    const provider = (config?.provider || process.env.LLM_PROVIDER || 'groq') as LLMProvider;

    let apiKey: string;
    let baseURL: string | undefined;
    let model: string;

    switch (provider) {
        case 'openai':
            apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
            baseURL = config?.baseURL || DEFAULT_BASE_URLS.openai;
            model = config?.model || process.env.OPENAI_MODEL || DEFAULT_MODELS.openai;
            break;

        case 'groq':
        default:
            apiKey = config?.apiKey || process.env.GROQ_API_KEY || '';
            baseURL = config?.baseURL || DEFAULT_BASE_URLS.groq;
            model = config?.model || process.env.GROQ_MODEL || DEFAULT_MODELS.groq;
            break;
    }

    const client = new OpenAI({
        apiKey,
        baseURL
    });

    return { client, model, provider };
}

/**
 * Create a reasoning client (for complex tasks like literature reviews, comparisons)
 * Uses GROQ_REASONING_MODEL env var, defaults to qwen/qwen3-32b
 */
export function createReasoningClient(): LLMClientResult {
    const model = process.env.GROQ_REASONING_MODEL || 'qwen/qwen3-32b';
    return createLLMClient({ provider: 'groq', model });
}

/**
 * Create a fast client (for simple tasks like query refinement, summarization)
 * Uses GROQ_FAST_MODEL env var, defaults to llama-3.3-70b-versatile
 */
export function createFastClient(): LLMClientResult {
    const model = process.env.GROQ_FAST_MODEL || 'llama-3.3-70b-versatile';
    return createLLMClient({ provider: 'groq', model });
}
