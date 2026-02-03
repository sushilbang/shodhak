import OpenAI from 'openai';
import { AgentContext, ChatMessage, ConversationSummary, KeyFact, KeyFactType } from '../types/agent.types';
import { createReasoningClient } from '../benchmark/utils/llm-client.factory';
import { sessionPersistence } from './session-persistence.service';
import { logger } from '../utils/logger';

// 3-tier memory architecture:
// Tier 1 (Recent Buffer): Last N messages kept verbatim
// Tier 2 (Summaries): Older messages compressed by LLM into running summaries
// Tier 3 (Key Facts): Structured entities/decisions extracted and stored separately

const COMPRESSION_THRESHOLD = 25;
const RECENT_BUFFER_SIZE = 10;

class ContextCompressionService {
    private client: OpenAI;
    private model: string;

    constructor() {
        const { client, model } = createReasoningClient();
        this.client = client;
        this.model = model;
    }

    /**
     * Check if compression is needed and compress if so.
     * Triggered after each message addition.
     */
    async maybeCompress(context: AgentContext): Promise<void> {
        const totalMessages = context.conversationHistory.length;

        if (totalMessages < COMPRESSION_THRESHOLD) {
            return;
        }

        const messagesToCompress = totalMessages - RECENT_BUFFER_SIZE;
        if (messagesToCompress <= 0) return;

        // Only compress messages that haven't been compressed yet
        const alreadyCompressed = context.memoryState.recentBufferStart;
        if (alreadyCompressed >= messagesToCompress) return;

        const startIdx = alreadyCompressed;
        const endIdx = messagesToCompress - 1;

        if (endIdx < startIdx) return;

        const oldMessages = context.conversationHistory.slice(startIdx, endIdx + 1);
        if (oldMessages.length === 0) return;

        logger.info('Compressing conversation history', {
            sessionId: context.sessionId,
            compressingFrom: startIdx,
            compressingTo: endIdx,
            messageCount: oldMessages.length,
        });

        try {
            // Summarize old messages
            const summary = await this.summarizeMessages(oldMessages);

            // Extract key facts
            const facts = await this.extractKeyFacts(oldMessages, context);

            // Create summary object
            const conversationSummary: ConversationSummary = {
                content: summary,
                messageRange: { from: startIdx, to: endIdx },
                createdAt: new Date(),
                tokenEstimate: Math.ceil(summary.length / 4),
            };

            // Update memory state
            context.memoryState.summaries.push(conversationSummary);
            context.memoryState.keyFacts.push(...facts);
            context.memoryState.recentBufferStart = endIdx + 1;

            // Replace old messages with a summary system message
            const summaryMessage: ChatMessage = {
                role: 'system',
                content: `[SUMMARY of messages ${startIdx}-${endIdx}]: ${summary}`,
            };

            // Replace the compressed messages in the history with just the summary
            context.conversationHistory.splice(startIdx, oldMessages.length, summaryMessage);

            // Adjust recentBufferStart since we changed array length
            const removedCount = oldMessages.length - 1; // replaced N messages with 1
            context.memoryState.recentBufferStart = startIdx + 1;

            // Persist to DB
            await sessionPersistence.saveSummary(
                context.sessionId,
                summary,
                startIdx,
                endIdx,
                conversationSummary.tokenEstimate
            );

            for (const fact of facts) {
                await sessionPersistence.saveKeyFact(
                    context.sessionId,
                    fact.type,
                    fact.content,
                    fact.relatedPaperIndices
                );
            }

            // Delete compressed raw messages from DB
            await sessionPersistence.deleteMessagesByOrderRange(context.sessionId, startIdx, endIdx);

            logger.info('Compression complete', {
                sessionId: context.sessionId,
                summaryLength: summary.length,
                factsExtracted: facts.length,
                historySize: context.conversationHistory.length,
            });
        } catch (err) {
            logger.error('Context compression failed', { sessionId: context.sessionId, error: err });
        }
    }

    /**
     * Build the compressed context message array for LLM calls.
     * 1. System prompt enriched with key facts
     * 2. Running summaries as system messages
     * 3. Last RECENT_BUFFER_SIZE verbatim messages
     */
    buildCompressedContext(systemPrompt: string, context: AgentContext): ChatMessage[] {
        const messages: ChatMessage[] = [];

        // Build enriched system prompt with key facts
        let enrichedPrompt = systemPrompt;

        if (context.memoryState.keyFacts.length > 0) {
            enrichedPrompt += '\n\n## Key Facts from Conversation\n';
            for (const fact of context.memoryState.keyFacts) {
                enrichedPrompt += `- [${fact.type}] ${fact.content}\n`;
            }
        }

        // Add papers context
        if (context.papers.length > 0) {
            enrichedPrompt += `\n## Current Papers in Context (${context.papers.length} papers):\n`;
            context.papers.forEach((paper, idx) => {
                enrichedPrompt += `[${idx}] "${paper.title}" by ${paper.authors.map(a => a.name).join(', ')} (${paper.year || 'N/A'})\n`;
            });
        }

        messages.push({ role: 'system', content: enrichedPrompt });

        // Add running summaries as system messages
        for (const summary of context.memoryState.summaries) {
            messages.push({
                role: 'system',
                content: `[Previous conversation summary (messages ${summary.messageRange.from}-${summary.messageRange.to})]: ${summary.content}`,
            });
        }

        // Add recent verbatim messages
        const recentMessages = context.conversationHistory.slice(-RECENT_BUFFER_SIZE);
        messages.push(...recentMessages);

        return messages;
    }

    private async summarizeMessages(messages: ChatMessage[]): Promise<string> {
        const conversationText = messages
            .map(m => {
                if (m.role === 'tool') {
                    const toolContent = m.content || '';
                    const truncated = toolContent.length > 500 ? toolContent.slice(0, 500) + '...' : toolContent;
                    return `[Tool result for ${m.tool_call_id}]: ${truncated}`;
                }
                if (m.tool_calls && m.tool_calls.length > 0) {
                    const toolNames = m.tool_calls.map(tc => tc.function.name).join(', ');
                    return `Assistant [called tools: ${toolNames}]: ${m.content || ''}`;
                }
                return `${m.role}: ${m.content || ''}`;
            })
            .join('\n');

        const response = await this.client.chat.completions.create({
            model: this.model,
            max_tokens: 1024,
            messages: [
                {
                    role: 'system',
                    content: 'You are a conversation summarizer. Create a dense, information-preserving summary of the following conversation segment. Focus on: what the user asked, what was searched/found, what analyses were performed, key findings, and any decisions made. Keep paper references by their index numbers.',
                },
                {
                    role: 'user',
                    content: `Summarize this conversation segment into a dense paragraph:\n\n${conversationText}`,
                },
            ],
        });

        return response.choices[0]?.message?.content?.trim() || 'Unable to generate summary.';
    }

    private async extractKeyFacts(messages: ChatMessage[], context: AgentContext): Promise<KeyFact[]> {
        const conversationText = messages
            .filter(m => m.role !== 'tool')
            .map(m => `${m.role}: ${m.content || ''}`)
            .join('\n');

        const response = await this.client.chat.completions.create({
            model: this.model,
            max_tokens: 1024,
            messages: [
                {
                    role: 'system',
                    content: `Extract key facts from this conversation segment. Return a JSON array of objects with:
- "type": one of "paper_conclusion", "user_preference", "research_direction", "decision", "entity"
- "content": the fact itself (concise)
- "relatedPaperIndices": array of paper index numbers mentioned (empty if none)

Only extract genuinely important facts. Return valid JSON array only, no other text.`,
                },
                {
                    role: 'user',
                    content: conversationText,
                },
            ],
        });

        const rawContent = response.choices[0]?.message?.content?.trim() || '[]';

        try {
            // Try to parse JSON, handling possible markdown code blocks
            let jsonStr = rawContent;
            const codeBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }

            const parsed = JSON.parse(jsonStr);
            if (!Array.isArray(parsed)) return [];

            return parsed
                .filter((f: any) => f.type && f.content)
                .map((f: any) => ({
                    type: f.type as KeyFactType,
                    content: f.content,
                    relatedPaperIndices: Array.isArray(f.relatedPaperIndices) ? f.relatedPaperIndices : [],
                    extractedAt: new Date(),
                }));
        } catch (err) {
            logger.warn('Failed to parse key facts from LLM response', { rawContent, error: err });
            return [];
        }
    }
}

export const contextCompression = new ContextCompressionService();
