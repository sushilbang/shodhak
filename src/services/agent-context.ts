import { v4 as uuidv4 } from 'uuid';
import { AgentContext, ChatMessage } from '../types/agent.types';
import { logger } from '../utils/logger';

// In-memory context store (can we make this more reliable and robust with some other kinda memory??)
const contextStore = new Map<string, AgentContext>();

// Context TTL: 1 hr
const CONTEXT_TTL_MS = 60 * 60 * 1000;

export class AgentContextManager {
    createContext(userId: number): AgentContext {
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
            }
        };

        contextStore.set(sessionId, context);
        logger.info('Created agent context', { sessionId, userId });
        return context;
    }

    getContext(sessionId: string): AgentContext | null {
        const context = contextStore.get(sessionId);

        if(!context) {
            return null;
        }

        // check if expired
        const elapsed = Date.now() - context.metadata.lastActivityAt.getTime();

        if(elapsed > CONTEXT_TTL_MS) {
            contextStore.delete(sessionId);
            logger.info('Context expired', { sessionId });
            return null;
        }

        return context;
    }

    updateActivity(context: AgentContext): void {
        context.metadata.lastActivityAt = new Date();
    }

    addMessage(context: AgentContext, message: ChatMessage): void {
        context.conversationHistory.push(message);
        this.updateActivity(context);
    }

    incrementIterations(context: AgentContext): void {
        context.metadata.totalIterations++;
        this.updateActivity(context);
    }

    deleteContext(sessionId: string): boolean {
        return contextStore.delete(sessionId);
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

    // cleanup expired contexts (run periodically)
    cleanup(): number {
        const now = Date.now();
        let cleanedCount = 0;

        for(const [sessionId, context] of contextStore.entries()) {
            const elapsed = now - context.metadata.lastActivityAt.getTime();
            if(elapsed > CONTEXT_TTL_MS) {
                contextStore.delete(sessionId);
                cleanedCount++;
            }
        }

        if(cleanedCount > 0) {
            logger.info('Cleaned up expired contexts', { count: cleanedCount });
        }

        return cleanedCount;
    }
}

export const contextManager = new AgentContextManager();