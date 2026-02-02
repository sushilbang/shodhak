/**
 * LLM Client Factory
 * Centralized factory for creating OpenAI-compatible LLM clients
 */

import OpenAI from 'openai';

export type LLMProvider = 'ollama' | 'groq' | 'openai';

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
    ollama: 'llama3.2',
    groq: 'qwen/qwen3-32b',
    openai: 'gpt-4o-mini'
};

const DEFAULT_BASE_URLS: Record<LLMProvider, string | undefined> = {
    ollama: 'http://localhost:11434/v1',
    groq: 'https://api.groq.com/openai/v1',
    openai: undefined
};

/**
 * Create an OpenAI-compatible client for any supported LLM provider
 */
export function createLLMClient(config?: Partial<LLMClientConfig>): LLMClientResult {
    const provider = (config?.provider || process.env.LLM_PROVIDER || 'ollama') as LLMProvider;

    let apiKey: string;
    let baseURL: string | undefined;
    let model: string;

    switch (provider) {
        case 'groq':
            apiKey = config?.apiKey || process.env.GROQ_API_KEY || '';
            baseURL = config?.baseURL || DEFAULT_BASE_URLS.groq;
            model = config?.model || process.env.GROQ_MODEL || DEFAULT_MODELS.groq;
            break;

        case 'openai':
            apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
            baseURL = config?.baseURL || DEFAULT_BASE_URLS.openai;
            model = config?.model || process.env.OPENAI_MODEL || DEFAULT_MODELS.openai;
            break;

        case 'ollama':
        default:
            apiKey = 'ollama';
            baseURL = config?.baseURL || process.env.OLLAMA_URL || DEFAULT_BASE_URLS.ollama;
            model = config?.model || process.env.OLLAMA_MODEL || DEFAULT_MODELS.ollama;
            break;
    }

    const client = new OpenAI({
        apiKey,
        baseURL
    });

    return { client, model, provider };
}

/**
 * Get available LLM configurations from environment
 */
export function getAvailableConfigs(): LLMClientConfig[] {
    const configs: LLMClientConfig[] = [];

    if (process.env.GROQ_API_KEY) {
        configs.push({
            provider: 'groq',
            apiKey: process.env.GROQ_API_KEY,
            model: process.env.GROQ_MODEL || DEFAULT_MODELS.groq
        });
    }

    if (process.env.OPENAI_API_KEY) {
        configs.push({
            provider: 'openai',
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL || DEFAULT_MODELS.openai
        });
    }

    // Ollama is always available (local)
    configs.push({
        provider: 'ollama',
        model: process.env.OLLAMA_MODEL || DEFAULT_MODELS.ollama
    });

    return configs;
}
