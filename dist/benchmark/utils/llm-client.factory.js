"use strict";
/**
 * LLM Client Factory
 * Centralized factory for creating OpenAI-compatible LLM clients
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLLMClient = createLLMClient;
exports.createReasoningClient = createReasoningClient;
exports.createFastClient = createFastClient;
exports.getAvailableConfigs = getAvailableConfigs;
const openai_1 = __importDefault(require("openai"));
const DEFAULT_MODELS = {
    groq: 'qwen/qwen3-32b',
    openai: 'gpt-4o-mini'
};
const DEFAULT_BASE_URLS = {
    groq: 'https://api.groq.com/openai/v1',
    openai: undefined
};
/**
 * Create an OpenAI-compatible client for any supported LLM provider
 */
function createLLMClient(config) {
    const provider = (config?.provider || process.env.LLM_PROVIDER || 'groq');
    let apiKey;
    let baseURL;
    let model;
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
    const client = new openai_1.default({
        apiKey,
        baseURL
    });
    return { client, model, provider };
}
/**
 * Create a reasoning client (for complex tasks like literature reviews, comparisons)
 * Uses GROQ_REASONING_MODEL env var, defaults to qwen/qwen3-32b
 */
function createReasoningClient() {
    const model = process.env.GROQ_REASONING_MODEL || 'qwen/qwen3-32b';
    return createLLMClient({ provider: 'groq', model });
}
/**
 * Create a fast client (for simple tasks like query refinement, summarization)
 * Uses GROQ_FAST_MODEL env var, defaults to llama-3.3-70b-versatile
 */
function createFastClient() {
    const model = process.env.GROQ_FAST_MODEL || 'llama-3.3-70b-versatile';
    return createLLMClient({ provider: 'groq', model });
}
/**
 * Get available LLM configurations from environment
 */
function getAvailableConfigs() {
    const configs = [];
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
    return configs;
}
