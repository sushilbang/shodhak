import OpenAI from 'openai';
import { logger } from '../../utils/logger';
import { createLLMClient, createReasoningClient, createFastClient, LLMProvider } from '../../utils/llm-client.factory';

export class LLMBaseService {
    protected client: OpenAI;
    protected readonly MODEL: string;
    protected readonly MAX_TOKENS = 4096;
    protected readonly provider: LLMProvider;

    // Dual-model support
    protected reasoningClient: OpenAI;
    protected readonly reasoningModel: string;
    protected fastClient: OpenAI;
    protected readonly fastModel: string;

    constructor() {
        const { client, model, provider } = createLLMClient();
        this.client = client;
        this.MODEL = model;
        this.provider = provider;

        const reasoning = createReasoningClient();
        this.reasoningClient = reasoning.client;
        this.reasoningModel = reasoning.model;

        const fast = createFastClient();
        this.fastClient = fast.client;
        this.fastModel = fast.model;

        logger.info('LLM service initialized', {
            provider,
            model,
            reasoningModel: this.reasoningModel,
            fastModel: this.fastModel
        });
    }
}
