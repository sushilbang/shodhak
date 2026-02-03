import { v4 as uuidv4 } from 'uuid';
import { AgentContext, ChatMessage, ConversationSummary, KeyFact, KeyFactType } from '../types/agent.types';
import { logger } from '../utils/logger';
import { sessionPersistence } from './session-persistence.service';

// In-memory context store as cache layer — backed by PostgreSQL
const contextStore = new Map<string, AgentContext>();

// Context TTL: 1 hr
const CONTEXT_TTL_MS = 60 * 60 * 1000;

export class AgentContextManager {
    async createContext(userId: number): Promise<AgentContext> {
        const sessionId = uuidv4();
        const context: AgentContext = {
            sessionId,
            userId,
            papers: [],
            conversationHistory: [],
            metadata: {
                createdAt: new Date(),
                lastActivityAt: new Date(),
                totalIterations: 0,
                searchCount: 0,
                analysisCount: 0
            },
            memoryState: {
                summaries: [],
                keyFacts: [],
                recentBufferStart: 0
            }
        };

        contextStore.set(sessionId, context);

        // Persist to DB (non-fatal)
        try {
            await sessionPersistence.createSession(sessionId, userId);
        } catch (err) {
            logger.error('Failed to persist new session to DB', { sessionId, error: err });
        }

        logger.info('Created agent context', { sessionId, userId });
        return context;
    }

    async getContext(sessionId: string): Promise<AgentContext | null> {
        // Check in-memory cache first
        const cached = contextStore.get(sessionId);
        if (cached) {
            const elapsed = Date.now() - cached.metadata.lastActivityAt.getTime();
            if (elapsed > CONTEXT_TTL_MS) {
                contextStore.delete(sessionId);
                try {
                    await sessionPersistence.endSession(sessionId);
                } catch (err) {
                    logger.error('Failed to end expired session in DB', { sessionId, error: err });
                }
                logger.info('Context expired', { sessionId });
                return null;
            }
            return cached;
        }

        // Cache miss — try to recover from DB
        try {
            const session = await sessionPersistence.loadSession(sessionId);
            if (!session) return null;

            const elapsed = Date.now() - new Date(session.last_activity_at).getTime();
            if (elapsed > CONTEXT_TTL_MS) {
                await sessionPersistence.endSession(sessionId);
                return null;
            }

            // Load messages
            const dbMessages = await sessionPersistence.loadMessages(sessionId);
            const conversationHistory: ChatMessage[] = dbMessages.map(m => ({
                role: m.role as ChatMessage['role'],
                content: m.content,
                tool_calls: m.tool_calls || undefined,
                tool_call_id: m.tool_call_id || undefined,
                name: m.name || undefined,
            }));

            // Load papers
            const papers = await sessionPersistence.loadSessionPapers(sessionId);

            // Load summaries and key facts
            const dbSummaries = await sessionPersistence.loadSummaries(sessionId);
            const summaries: ConversationSummary[] = dbSummaries.map(s => ({
                content: s.content,
                messageRange: { from: s.message_range_from, to: s.message_range_to },
                createdAt: new Date(s.created_at),
                tokenEstimate: s.token_estimate,
            }));

            const dbFacts = await sessionPersistence.loadKeyFacts(sessionId);
            const keyFacts: KeyFact[] = dbFacts.map(f => ({
                type: f.fact_type as KeyFactType,
                content: f.content,
                relatedPaperIndices: f.related_paper_indices || [],
                extractedAt: new Date(f.extracted_at),
            }));

            const recentBufferStart = summaries.length > 0
                ? summaries[summaries.length - 1].messageRange.to + 1
                : 0;

            const meta = session.metadata || {};
            const context: AgentContext = {
                sessionId,
                userId: session.user_id,
                papers,
                conversationHistory,
                metadata: {
                    createdAt: new Date(session.created_at),
                    lastActivityAt: new Date(session.last_activity_at),
                    totalIterations: meta.totalIterations || 0,
                    searchCount: meta.searchCount || 0,
                    analysisCount: meta.analysisCount || 0,
                },
                memoryState: {
                    summaries,
                    keyFacts,
                    recentBufferStart,
                }
            };

            contextStore.set(sessionId, context);
            logger.info('Recovered agent context from DB', { sessionId, messages: conversationHistory.length, papers: papers.length });
            return context;
        } catch (err) {
            logger.error('Failed to recover context from DB', { sessionId, error: err });
            return null;
        }
    }

    updateActivity(context: AgentContext): void {
        context.metadata.lastActivityAt = new Date();
    }

    async addMessage(context: AgentContext, message: ChatMessage): Promise<void> {
        const order = context.conversationHistory.length;
        context.conversationHistory.push(message);
        this.updateActivity(context);

        // Persist message (non-fatal)
        try {
            await sessionPersistence.saveMessage(context.sessionId, message, order);
        } catch (err) {
            logger.error('Failed to persist message to DB', { sessionId: context.sessionId, error: err });
        }
    }

    incrementIterations(context: AgentContext): void {
        context.metadata.totalIterations++;
        this.updateActivity(context);
    }

    async deleteContext(sessionId: string): Promise<boolean> {
        const deleted = contextStore.delete(sessionId);

        try {
            await sessionPersistence.endSession(sessionId);
        } catch (err) {
            logger.error('Failed to end session in DB', { sessionId, error: err });
        }

        return deleted;
    }

    // Build context summary for system prompt
    buildContextSummary(context: AgentContext): string {
        const parts: string[] = [];

        if(context.papers.length > 0) {
            parts.push(`\n## Current Papers in Context (${context.papers.length} papers):`);
            context.papers.forEach((paper, idx) => {
                parts.push(`[${idx}] "${paper.title} by ${paper.authors.map(a => a.name).join(', ')} (${paper.year || 'N/A'})"`);
            });
        } else {
            parts.push('\n## No papers currently in the context. Use search_paper or search_similar_papers to find papers.');
        }

        return parts.join('\n');
    }

    async addPaperToSession(context: AgentContext, paperId: number): Promise<void> {
        try {
            await sessionPersistence.addSessionPaper(context.sessionId, paperId);
        } catch (err) {
            logger.error('Failed to persist session paper', { sessionId: context.sessionId, paperId, error: err });
        }
    }

    // cleanup expired contexts (run periodically)
    async cleanup(): Promise<number> {
        const now = Date.now();
        let cleanedCount = 0;

        for(const [sessionId, context] of contextStore.entries()) {
            const elapsed = now - context.metadata.lastActivityAt.getTime();
            if(elapsed > CONTEXT_TTL_MS) {
                contextStore.delete(sessionId);
                cleanedCount++;
            }
        }

        // Also expire stale sessions in DB
        try {
            const dbExpired = await sessionPersistence.expireStaleSessions(CONTEXT_TTL_MS);
            cleanedCount += dbExpired;
        } catch (err) {
            logger.error('Failed to expire stale sessions in DB', { error: err });
        }

        if(cleanedCount > 0) {
            logger.info('Cleaned up expired contexts', { count: cleanedCount });
        }

        return cleanedCount;
    }

    async persistMetadata(context: AgentContext, lastQuery?: string): Promise<void> {
        try {
            const meta: Record<string, any> = {
                totalIterations: context.metadata.totalIterations,
                searchCount: context.metadata.searchCount,
                analysisCount: context.metadata.analysisCount,
            };
            if (lastQuery) {
                meta.lastQuery = lastQuery;
            }
            await sessionPersistence.updateSessionMetadata(context.sessionId, meta);
        } catch (err) {
            logger.error('Failed to persist session metadata', { sessionId: context.sessionId, error: err });
        }
    }
}

export const contextManager = new AgentContextManager();
