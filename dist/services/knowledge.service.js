"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgeService = void 0;
const database_1 = require("../config/database");
const logger_1 = require("../utils/logger");
const embedding_service_1 = require("./embedding.service");
const llm_service_1 = require("./llm.service");
class KnowledgeService {
    // create a new annotation(note) for a paper. generates an embedding for the content to enable semantic search across all user notes later
    async addAnnotation(userId, paperId, content, noteType = 'annotation') {
        // generate embedding for the annotation content
        const embedding = await embedding_service_1.embeddingService.generateEmbedding(content);
        const result = await database_1.pool.query(`INSERT INTO user_knowledge (user_id, paper_id, content, embedding, note_type)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`, [userId, paperId, content, JSON.stringify(embedding), noteType]);
        logger_1.logger.info('Added user annotation', {
            userId, paperId, noteType,
        });
        return {
            id: result.rows[0].id,
            user_id: result.rows[0].user_id,
            paper_id: result.rows[0].paper_id,
            content: result.rows[0].content,
            embedding: result.rows[0].embedding,
            note_type: result.rows[0].note_type,
            created_at: result.rows[0].created_at,
        };
    }
    // get all notes for a user
    async getUserKnowledge(userId, paperId) {
        let query = 'SELECT * FROM user_knowledge WHERE user_id = $1';
        const params = [userId];
        if (paperId) {
            query += ' AND paper_id = $2';
            params.push(paperId);
        }
        query += ' ORDER BY created_at DESC';
        const result = await database_1.pool.query(query, params);
        return result.rows.map((row) => ({
            id: row.id,
            user_id: row.user_id,
            paper_id: row.paper_id,
            content: row.content,
            embedding: row.embedding,
            note_type: row.note_type,
            created_at: row.created_at,
        }));
    }
    // semantic search across notes
    async searchUserKnowledge(userId, query, limit = 10) {
        const queryEmbedding = await embedding_service_1.embeddingService.generateEmbedding(query);
        const result = await database_1.pool.query('SELECT * FROM user_knowledge WHERE user_id = $1', [userId]);
        const scored = result.rows.map((row) => {
            const knowledgeEmbedding = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
            const score = this.cosineSimilarity(queryEmbedding, knowledgeEmbedding);
            return {
                knowledge: {
                    id: row.id,
                    user_id: row.user_id,
                    paper_id: row.paper_id,
                    content: row.content,
                    note_type: row.note_type,
                    created_at: row.created_at,
                },
                score,
            };
        });
        return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    }
    cosineSimilarity(a, b) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    async generatePaperSummary(userId, paper) {
        const summary = await llm_service_1.llmService.summarizePaper(paper);
        return this.addAnnotation(userId, paper.id, summary, 'summary');
    }
    async updateAnnotation(knowledgeId, userId, newContent) {
        // verify ownership
        const existing = await database_1.pool.query('SELECT * FROM user_knowledge WHERE id = $1 AND user_id = $2', [knowledgeId, userId]);
        if (existing.rows.length === 0) {
            logger_1.logger.warn('Annotation not found or access denied', {
                knowledgeId,
                userId,
            });
            return null;
        }
        // regenerate embedding for updated content
        const embedding = await embedding_service_1.embeddingService.generateEmbedding(newContent);
        const result = await database_1.pool.query(`UPDATE user_knowledge
            SET content = $1, embedding = $2
            WHERE id = $3 AND user_id = $4
            RETURNING *`, [newContent, JSON.stringify(embedding), knowledgeId, userId]);
        logger_1.logger.info('Updated annotation', { knowledgeId, userId });
        return {
            id: result.rows[0].id,
            user_id: result.rows[0].user_id,
            paper_id: result.rows[0].paper_id,
            content: result.rows[0].content,
            embedding: result.rows[0].embedding,
            note_type: result.rows[0].note_type,
            created_at: result.rows[0].created_at,
        };
    }
    async deleteAnnotation(knowledgeId, userId) {
        const result = await database_1.pool.query('DELETE FROM user_knowledge WHERE id = $1 AND user_id = $2', [knowledgeId, userId]);
        if (result.rowCount === 0) {
            return false;
        }
        logger_1.logger.info('Deleted annotation', { knowledgeId, userId });
        return true;
    }
    async getKnowledgeWithPapers(userId) {
        const result = await database_1.pool.query(`SELECT uk.*, p.external_id, p.title, p.authors, p.abstract,
                      p.url, p.doi, p.year, p.venue, p.citation_count, p.source
              FROM user_knowledge uk
              JOIN papers p ON uk.paper_id = p.id
              WHERE uk.user_id = $1
              ORDER BY uk.created_at DESC`, [userId]);
        return result.rows.map((row) => ({
            knowledge: {
                id: row.id,
                user_id: row.user_id,
                paper_id: row.paper_id,
                content: row.content,
                note_type: row.note_type,
                created_at: row.created_at,
            },
            paper: {
                id: row.paper_id,
                external_id: row.external_id,
                title: row.title,
                authors: row.authors,
                abstract: row.abstract,
                url: row.url,
                doi: row.doi,
                year: row.year,
                venue: row.venue,
                citation_count: row.citation_count,
                source: row.source,
            },
        }));
    }
    async getRecentActivity(userId, limit = 20) {
        const result = await database_1.pool.query(`SELECT * FROM user_knowledge
              WHERE user_id = $1
              ORDER BY created_at DESC
              LIMIT $2`, [userId, limit]);
        return result.rows.map((row) => ({
            id: row.id,
            user_id: row.user_id,
            paper_id: row.paper_id,
            content: row.content,
            note_type: row.note_type,
            created_at: row.created_at,
        }));
    }
}
exports.knowledgeService = new KnowledgeService();
