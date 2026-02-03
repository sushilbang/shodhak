"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionPersistence = void 0;
const database_1 = require("../config/database");
const logger_1 = require("../utils/logger");
class SessionPersistenceService {
    async createSession(sessionId, userId) {
        await database_1.pool.query(`INSERT INTO agent_sessions (id, user_id, status, metadata)
             VALUES ($1, $2, 'active', '{}')`, [sessionId, userId]);
        logger_1.logger.info('Persisted new agent session', { sessionId, userId });
    }
    async loadSession(sessionId) {
        const result = await database_1.pool.query(`SELECT * FROM agent_sessions WHERE id = $1 AND status = 'active'`, [sessionId]);
        return result.rows[0] || null;
    }
    async loadMessages(sessionId) {
        const result = await database_1.pool.query(`SELECT * FROM session_messages WHERE session_id = $1 ORDER BY message_order ASC`, [sessionId]);
        return result.rows;
    }
    async saveMessage(sessionId, message, order) {
        await database_1.pool.query(`INSERT INTO session_messages (session_id, role, content, tool_calls, tool_call_id, name, message_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
            sessionId,
            message.role,
            message.content,
            message.tool_calls ? JSON.stringify(message.tool_calls) : null,
            message.tool_call_id || null,
            message.name || null,
            order,
        ]);
    }
    async updateSessionMetadata(sessionId, metadata) {
        await database_1.pool.query(`UPDATE agent_sessions SET metadata = $2, last_activity_at = CURRENT_TIMESTAMP WHERE id = $1`, [sessionId, JSON.stringify(metadata)]);
    }
    async endSession(sessionId) {
        await database_1.pool.query(`UPDATE agent_sessions SET status = 'ended', last_activity_at = CURRENT_TIMESTAMP WHERE id = $1`, [sessionId]);
        logger_1.logger.info('Ended agent session', { sessionId });
    }
    async addSessionPaper(sessionId, paperId) {
        await database_1.pool.query(`INSERT INTO agent_session_papers (session_id, paper_id)
             VALUES ($1, $2)
             ON CONFLICT (session_id, paper_id) DO NOTHING`, [sessionId, paperId]);
    }
    async loadSessionPapers(sessionId) {
        const result = await database_1.pool.query(`SELECT p.* FROM papers p
             JOIN agent_session_papers asp ON p.id = asp.paper_id
             WHERE asp.session_id = $1
             ORDER BY asp.added_at ASC`, [sessionId]);
        return result.rows;
    }
    async getUserActiveSessions(userId) {
        const result = await database_1.pool.query(`SELECT * FROM agent_sessions WHERE user_id = $1 AND status = 'active' ORDER BY last_activity_at DESC`, [userId]);
        return result.rows;
    }
    async expireStaleSessions(ttlMs) {
        const cutoff = new Date(Date.now() - ttlMs);
        const result = await database_1.pool.query(`UPDATE agent_sessions SET status = 'expired'
             WHERE status = 'active' AND last_activity_at < $1`, [cutoff]);
        const count = result.rowCount || 0;
        if (count > 0) {
            logger_1.logger.info('Expired stale agent sessions', { count });
        }
        return count;
    }
    async deleteMessagesByOrderRange(sessionId, from, to) {
        await database_1.pool.query(`DELETE FROM session_messages WHERE session_id = $1 AND message_order >= $2 AND message_order <= $3`, [sessionId, from, to]);
    }
    async getMessageCount(sessionId) {
        const result = await database_1.pool.query(`SELECT COUNT(*) as count FROM session_messages WHERE session_id = $1`, [sessionId]);
        return parseInt(result.rows[0].count, 10);
    }
    // --- Compression persistence ---
    async saveSummary(sessionId, content, messageRangeFrom, messageRangeTo, tokenEstimate) {
        await database_1.pool.query(`INSERT INTO session_summaries (session_id, content, message_range_from, message_range_to, token_estimate)
             VALUES ($1, $2, $3, $4, $5)`, [sessionId, content, messageRangeFrom, messageRangeTo, tokenEstimate]);
    }
    async loadSummaries(sessionId) {
        const result = await database_1.pool.query(`SELECT content, message_range_from, message_range_to, token_estimate, created_at
             FROM session_summaries WHERE session_id = $1 ORDER BY message_range_from ASC`, [sessionId]);
        return result.rows;
    }
    async saveKeyFact(sessionId, factType, content, relatedPaperIndices) {
        await database_1.pool.query(`INSERT INTO session_key_facts (session_id, fact_type, content, related_paper_indices)
             VALUES ($1, $2, $3, $4)`, [sessionId, factType, content, JSON.stringify(relatedPaperIndices)]);
    }
    async loadKeyFacts(sessionId) {
        const result = await database_1.pool.query(`SELECT fact_type, content, related_paper_indices, extracted_at
             FROM session_key_facts WHERE session_id = $1 ORDER BY extracted_at ASC`, [sessionId]);
        return result.rows;
    }
}
exports.sessionPersistence = new SessionPersistenceService();
