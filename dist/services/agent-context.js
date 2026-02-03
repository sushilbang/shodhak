"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextManager = exports.AgentContextManager = void 0;
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
const session_persistence_service_1 = require("./session-persistence.service");
// In-memory context store as cache layer — backed by PostgreSQL
const contextStore = new Map();
// Context TTL: 1 hr
const CONTEXT_TTL_MS = 60 * 60 * 1000;
class AgentContextManager {
    async createContext(userId) {
        const sessionId = (0, uuid_1.v4)();
        const context = {
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
            await session_persistence_service_1.sessionPersistence.createSession(sessionId, userId);
        }
        catch (err) {
            logger_1.logger.error('Failed to persist new session to DB', { sessionId, error: err });
        }
        logger_1.logger.info('Created agent context', { sessionId, userId });
        return context;
    }
    async getContext(sessionId) {
        // Check in-memory cache first
        const cached = contextStore.get(sessionId);
        if (cached) {
            const elapsed = Date.now() - cached.metadata.lastActivityAt.getTime();
            if (elapsed > CONTEXT_TTL_MS) {
                contextStore.delete(sessionId);
                try {
                    await session_persistence_service_1.sessionPersistence.endSession(sessionId);
                }
                catch (err) {
                    logger_1.logger.error('Failed to end expired session in DB', { sessionId, error: err });
                }
                logger_1.logger.info('Context expired', { sessionId });
                return null;
            }
            return cached;
        }
        // Cache miss — try to recover from DB
        try {
            const session = await session_persistence_service_1.sessionPersistence.loadSession(sessionId);
            if (!session)
                return null;
            const elapsed = Date.now() - new Date(session.last_activity_at).getTime();
            if (elapsed > CONTEXT_TTL_MS) {
                await session_persistence_service_1.sessionPersistence.endSession(sessionId);
                return null;
            }
            // Load messages
            const dbMessages = await session_persistence_service_1.sessionPersistence.loadMessages(sessionId);
            const conversationHistory = dbMessages.map(m => ({
                role: m.role,
                content: m.content,
                tool_calls: m.tool_calls || undefined,
                tool_call_id: m.tool_call_id || undefined,
                name: m.name || undefined,
            }));
            // Load papers
            const papers = await session_persistence_service_1.sessionPersistence.loadSessionPapers(sessionId);
            // Load summaries and key facts
            const dbSummaries = await session_persistence_service_1.sessionPersistence.loadSummaries(sessionId);
            const summaries = dbSummaries.map(s => ({
                content: s.content,
                messageRange: { from: s.message_range_from, to: s.message_range_to },
                createdAt: new Date(s.created_at),
                tokenEstimate: s.token_estimate,
            }));
            const dbFacts = await session_persistence_service_1.sessionPersistence.loadKeyFacts(sessionId);
            const keyFacts = dbFacts.map(f => ({
                type: f.fact_type,
                content: f.content,
                relatedPaperIndices: f.related_paper_indices || [],
                extractedAt: new Date(f.extracted_at),
            }));
            const recentBufferStart = summaries.length > 0
                ? summaries[summaries.length - 1].messageRange.to + 1
                : 0;
            const meta = session.metadata || {};
            const context = {
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
            logger_1.logger.info('Recovered agent context from DB', { sessionId, messages: conversationHistory.length, papers: papers.length });
            return context;
        }
        catch (err) {
            logger_1.logger.error('Failed to recover context from DB', { sessionId, error: err });
            return null;
        }
    }
    updateActivity(context) {
        context.metadata.lastActivityAt = new Date();
    }
    async addMessage(context, message) {
        const order = context.conversationHistory.length;
        context.conversationHistory.push(message);
        this.updateActivity(context);
        // Persist message (non-fatal)
        try {
            await session_persistence_service_1.sessionPersistence.saveMessage(context.sessionId, message, order);
        }
        catch (err) {
            logger_1.logger.error('Failed to persist message to DB', { sessionId: context.sessionId, error: err });
        }
    }
    incrementIterations(context) {
        context.metadata.totalIterations++;
        this.updateActivity(context);
    }
    async deleteContext(sessionId) {
        const deleted = contextStore.delete(sessionId);
        try {
            await session_persistence_service_1.sessionPersistence.endSession(sessionId);
        }
        catch (err) {
            logger_1.logger.error('Failed to end session in DB', { sessionId, error: err });
        }
        return deleted;
    }
    // Build context summary for system prompt
    buildContextSummary(context) {
        const parts = [];
        if (context.papers.length > 0) {
            parts.push(`\n## Current Papers in Context (${context.papers.length} papers):`);
            context.papers.forEach((paper, idx) => {
                parts.push(`[${idx}] "${paper.title} by ${paper.authors.map(a => a.name).join(', ')} (${paper.year || 'N/A'})"`);
            });
        }
        else {
            parts.push('\n## No papers currently in the context. Use search_paper or search_similar_papers to find papers.');
        }
        return parts.join('\n');
    }
    async addPaperToSession(context, paperId) {
        try {
            await session_persistence_service_1.sessionPersistence.addSessionPaper(context.sessionId, paperId);
        }
        catch (err) {
            logger_1.logger.error('Failed to persist session paper', { sessionId: context.sessionId, paperId, error: err });
        }
    }
    // cleanup expired contexts (run periodically)
    async cleanup() {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [sessionId, context] of contextStore.entries()) {
            const elapsed = now - context.metadata.lastActivityAt.getTime();
            if (elapsed > CONTEXT_TTL_MS) {
                contextStore.delete(sessionId);
                cleanedCount++;
            }
        }
        // Also expire stale sessions in DB
        try {
            const dbExpired = await session_persistence_service_1.sessionPersistence.expireStaleSessions(CONTEXT_TTL_MS);
            cleanedCount += dbExpired;
        }
        catch (err) {
            logger_1.logger.error('Failed to expire stale sessions in DB', { error: err });
        }
        if (cleanedCount > 0) {
            logger_1.logger.info('Cleaned up expired contexts', { count: cleanedCount });
        }
        return cleanedCount;
    }
    async persistMetadata(context) {
        try {
            await session_persistence_service_1.sessionPersistence.updateSessionMetadata(context.sessionId, {
                totalIterations: context.metadata.totalIterations,
                searchCount: context.metadata.searchCount,
                analysisCount: context.metadata.analysisCount,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to persist session metadata', { sessionId: context.sessionId, error: err });
        }
    }
}
exports.AgentContextManager = AgentContextManager;
exports.contextManager = new AgentContextManager();
