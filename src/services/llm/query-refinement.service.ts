import { logger } from '../../utils/logger';
import { LLMBaseService } from './llm-base';

export class QueryRefinementService extends LLMBaseService {
    async refineQuery(userQuery: string): Promise<string> {
        const response = await this.fastClient.chat.completions.create({
            model: this.fastModel,
            max_tokens: 256,
            messages: [
                {
                    role: 'user',
                    content: `You are an academic research assistant. Convert this user query into a simple search query for Semantic Scholar API.

IMPORTANT RULES:
- Output 3-6 key terms separated by spaces
- NO boolean operators (no AND, OR, NOT)
- NO quotes or special characters
- NO parentheses
- Just simple keywords that capture the core topic

User query: "${userQuery}"

Respond with ONLY the simple keyword query, nothing else.`,
                },
            ],
        });

        const refinedQuery = response.choices[0]?.message?.content?.trim() || userQuery;
        logger.info('Refined query', { original: userQuery, refined: refinedQuery });
        return refinedQuery;
    }

    async generateClarifyingQuestions(userQuery: string): Promise<string[]> {
        const response = await this.fastClient.chat.completions.create({
            model: this.fastModel,
            max_tokens: 512,
            messages: [
                {
                    role: 'user',
                    content: `You are academic research assistant. The user wants to research: "${userQuery}"

Generate 3-4 clarifying questions to better understand their research need. Focus on:
- Specific aspects or subtopics they're interested in
- Time period or recency requirements
- Application domain or field
- Depth of coverage needed

Respond with ONLY the questions, one per line, numbered.`,
                },
            ],
        });

        const content = response.choices[0]?.message?.content || '';
        const questions = content
            .split('\n')
            .map((q) => q.replace(/^\d+\.\s*/, '').trim())
            .filter((q) => q.length > 0);

        return questions;
    }
}
