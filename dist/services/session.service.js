"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionService = void 0;
const database_1 = require("../config/database");
const logger_1 = require("../utils/logger");
const search_service_1 = require("./search.service");
const embedding_service_1 = require("./embedding.service");
const llm_service_1 = require("./llm.service");
/*
The session service is the conductor of the research orchestra. It doesn't play any instruments itself -
it coordinates the LLM, search, and embedding services to guide users through their research journey.
A session moves through states: initiated → clarifying → searching → papers_ready → generating → completed
*/
class SessionService {
    // update session status - central state management
    async updateStatus(sessionId, status) {
        await database_1.pool.query(`UPDATE research_sessions
            SET status = $1, updated_at = NOW()
            WHERE id = $2`, [status, sessionId]);
        logger_1.logger.info('Session status updated', { sessionId, status });
    }
    // helper to map database row to Research Session
    mapRowToSession(row) {
        return {
            id: row.id,
            user_id: row.user_id,
            initial_query: row.initial_query,
            refined_query: row.refined_query,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    }
    // get session by ID with ownership verification
    async getSession(sessionId, userId) {
        const result = await database_1.pool.query('SELECT * FROM research_sessions WHERE id = $1 AND user_id = $2', [sessionId, userId]);
        if (result.rows.length === 0)
            return null;
        return this.mapRowToSession(result.rows[0]);
    }
    // get all sessions for a user (for history/dashboard)
    async getUserSessions(userId, limit = 20) {
        const result = await database_1.pool.query(`SELECT * FROM research_sessions
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT $2`, [userId, limit]);
        return result.rows.map(row => this.mapRowToSession(row));
    }
    // get papers assosicated with a session
    async getSessionPapers(sessionId, userId) {
        const session = await this.getSession(sessionId, userId);
        if (!session)
            throw new Error('Session not found');
        const result = await database_1.pool.query(`SELECT p.*, sp.relevance_score, sp.user_selected
            FROM papers p
            JOIN session_papers sp ON p.id = sp.paper_id
            WHERE sp.research_session_id = $1
            ORDER BY sp.relevance_score DESC`, [sessionId]);
        return result.rows.map(row => ({
            paper: {
                id: row.id,
                external_id: row.external_id,
                title: row.title,
                authors: typeof row.authors === 'string' ? JSON.parse(row.authors) : row.authors,
                abstract: row.abstract,
                url: row.url,
                doi: row.doi,
                year: row.year,
                venue: row.venue,
                citation_count: row.citation_count,
                source: row.source,
                metadata: row.metadata,
                created_at: row.created_at,
            },
            relevance_score: row.relevance_score,
            user_selected: row.user_selected,
        }));
    }
    // Get reports for a session
    async getSessionReports(sessionId, userId) {
        const session = await this.getSession(sessionId, userId);
        if (!session)
            throw new Error('Session not found');
        const result = await database_1.pool.query(`SELECT * FROM reports WHERE research_session_id = $1 ORDER BY created_at DESC`, [sessionId]);
        return result.rows.map(row => ({
            id: row.id,
            research_session_id: row.research_session_id,
            content: row.content,
            report_type: row.report_type,
            citations: typeof row.citations === 'string' ? JSON.parse(row.citations) : row.citations,
            created_at: row.created_at,
        }));
    }
    // create a new research session when user starts a research query
    async createSession(userId, initialQuery) {
        const result = await database_1.pool.query(`INSERT INTO research_sessions (user_id, initial_query, status)
            VALUES ($1, $2, 'initiated')
            RETURNING *`, [userId, initialQuery]);
        logger_1.logger.info('Created research session', {
            sessionId: result.rows[0].id,
            userId,
            query: initialQuery,
        });
        return this.mapRowToSession(result.rows[0]);
    }
    // semantic search within session papers
    async searchWithinSession(sessionId, userId, query) {
        const session = await this.getSession(sessionId, userId);
        if (!session)
            throw new Error('Session not found');
        const sessionPaperResult = await database_1.pool.query('SELECT paper_id FROM session_papers WHERE research_session_id = $1', [sessionId]);
        const paperIds = sessionPaperResult.rows.map(r => r.paper_id);
        if (paperIds.length === 0)
            return [];
        const allResults = await embedding_service_1.embeddingService.searchSimilarPapers(query, 100);
        return allResults.filter(r => paperIds.includes(r.paper.id)).slice(0, 10);
    }
    // ask a question about the session's papers
    async askQuestion(sessionId, userId, question) {
        const sessionPapers = await this.getSessionPapers(sessionId, userId);
        const papers = sessionPapers.map(sp => sp.paper);
        if (papers.length === 0) {
            return 'No papers in this session to answer questions about.';
        }
        return llm_service_1.llmService.answerQuestions(question, papers);
    }
    // step1: generate clarifying questions to better understand user's needs
    async startClarification(sessionId, userId) {
        const session = await this.getSession(sessionId, userId);
        if (!session)
            throw new Error('Session not found');
        await this.updateStatus(sessionId, 'clarifying');
        const questions = await llm_service_1.llmService.generateClarifyingQuestions(session.initial_query);
        // store ques in session metadata for reference
        await database_1.pool.query(`UPDATE research_sessions
            SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{clarifying_questions}', $1)
            WHERE id = $2`, [JSON.stringify(questions), sessionId]);
        return questions;
    }
    // step2: process user's answers and refine the search query
    async processClarificationAnswers(sessionId, userId, answers) {
        const session = await this.getSession(sessionId, userId);
        if (!session)
            throw new Error('Session not found');
        const context = `Original query: ${session.initial_query}\nAdditional context: ${answers.join(' ')}`;
        const refinedQuery = await llm_service_1.llmService.refineQuery(context);
        await database_1.pool.query(`UPDATE research_sessions
            SET refined_query = $1, status = 'searching', updated_at = NOW()
            WHERE id = $2`, [refinedQuery, sessionId]);
        return refinedQuery;
    }
    // step3: execture the search and store results
    async searchPapers(sessionId, userId, limit = 20) {
        const session = await this.getSession(sessionId, userId);
        if (!session) {
            throw new Error('Session not found');
        }
        const query = session.refined_query || session.initial_query;
        const papers = await search_service_1.searchService.searchPapers(query, limit);
        const papersWithIds = [];
        for (const paper of papers) {
            const paperId = await search_service_1.searchService.savePaperIfNotExists(paper);
            const paperWithId = { ...paper, id: paperId };
            papersWithIds.push(paperWithId);
            embedding_service_1.embeddingService.embedPaper(paperWithId).catch(err => {
                logger_1.logger.error('Failed to embed paper', { err, paperId });
            });
        }
        // link papers to this session with relevance scores
        for (let i = 0; i < papersWithIds.length; i++) {
            const paper = papersWithIds[i];
            const relevanceScore = 1 - (i / papersWithIds.length);
            await database_1.pool.query(`INSERT INTO session_papers (research_session_id, paper_id, relevance_score)
                VALUES ($1, $2, $3)
                ON CONFLICT (research_session_id, paper_id) DO NOTHING`, [sessionId, paper.id, relevanceScore]);
        }
        await this.updateStatus(sessionId, 'papers_ready');
        return papersWithIds;
    }
    // step4: user selects which papers to include in the report
    async selectPapers(sessionId, userId, paperIds) {
        const session = await this.getSession(sessionId, userId);
        if (!session)
            throw new Error('Session not found');
        // reset all selections for this session
        await database_1.pool.query(`UPDATE session_papers
            SET user_selected = false
            WHERE research_session_id = $1`, [sessionId]);
        // set selected papers
        if (paperIds.length > 0) {
            await database_1.pool.query(`UPDATE session_papers
                SET user_selected = true
                WHERE research_session_id = $1 AND paper_id = ANY($2)`, [sessionId, paperIds]);
        }
        logger_1.logger.info('Papers selected for session', {
            sessionId,
            selectedCount: paperIds.length,
        });
    }
    // step5: generate the literature reivew report
    async generateReport(sessionId, userId, reportType = 'literature_review') {
        const session = await this.getSession(sessionId, userId);
        if (!session)
            throw new Error('Session not found');
        await this.updateStatus(sessionId, 'generating');
        // get selected papers or all if not selected
        const sessionPapers = await this.getSessionPapers(sessionId, userId);
        let papers = sessionPapers.filter(sp => sp.user_selected).map(sp => sp.paper);
        // if not selected user top papers by relevance
        if (papers.length === 0) {
            papers = sessionPapers.slice(0, 10).map(sp => sp.paper);
        }
        // agar fir bhi papers nahi he toh. ek kaam karo chod do IAS ki tayari
        if (papers.length === 0) {
            throw new Error('No papers available for report generation');
        }
        // generate the report based on type
        let content;
        let citations;
        const query = session.refined_query || session.initial_query;
        if (reportType === 'literature_review') {
            const result = await llm_service_1.llmService.generateLiteratureReview(papers, query);
            content = result.content;
            citations = result.citations;
        }
        else if (reportType === 'comparison') {
            content = await llm_service_1.llmService.comparePapers(papers);
            citations = papers.map((p, idx) => ({
                index: idx + 1,
                paper_id: p.id,
                title: p.title,
                authors: p.authors.map(a => a.name).join(', '),
                year: p.year,
                venue: p.venue,
            }));
        }
        else {
            const summaries = await Promise.all(papers.map(p => llm_service_1.llmService.summarizePaper(p)));
            content = summaries.join('\n\n---\n\n');
            citations = papers.map((p, idx) => ({
                index: idx + 1,
                paper_id: p.id,
                title: p.title,
                authors: p.authors.map(a => a.name).join(', '),
                year: p.year,
                venue: p.venue,
            }));
        }
        const result = await database_1.pool.query(`INSERT INTO reports (research_session_id, content, report_type, citations)
            VALUES ($1, $2, $3, $4)
            RETURNING *`, [sessionId, content, reportType, JSON.stringify(citations)]);
        await this.updateStatus(sessionId, 'completed');
        logger_1.logger.info('Generated Report', {
            sessionId,
            reportType,
            paperCount: papers.length,
        });
        return {
            id: result.rows[0].id,
            research_session_id: result.rows[0].research_session_id,
            content: result.rows[0].content,
            report_type: result.rows[0].report_type,
            citations: result.rows[0].citations,
            created_at: result.rows[0].created_at,
        };
    }
}
exports.sessionService = new SessionService();
