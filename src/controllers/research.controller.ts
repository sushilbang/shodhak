/*
this is the httml layer: it handles incoming requests, validates input, calls the appropriate service methods, and formats responses.
*/

// no business logic, just request/response handling

import { Request, Response } from 'express';
import { sessionService } from '../services/session.service';
import { knowledgeService } from '../services/knowledge.service';
import { embeddingService } from '../services/embedding.service';
import { searchService } from '../services/search.service';
import { logger } from '../utils/logger';

// extended request type that includes authenticated user
interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        email: string;
    };
}

class ResearchController {
    // POST /api/research/sessions - Start a new research session
    async createSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { query } = req.body;

            if (!query || typeof query !== 'string' || query.trim().length === 0) {
                res.status(400).json({
                    error: 'Query is required'
                });
                return;
            }

            const session = await sessionService.createSession(userId, query.trim());
            res.status(201).json(session);
        } catch (error) {
            logger.error('Failed to create session', { error });
            res.status(500).json({ error: 'Failed to create research session' });
        }
    }

    // GET /api/research/sessions - Get users session history
    async getUserSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const limit = parseInt(req.query.limit as string) || 20;
            const sessions = await sessionService.getUserSessions(userId, limit);
            res.json(sessions);
        } catch (error) {
            logger.error('Failed to get user sessions', { error });
            res.status(500).json({ error: 'Failed to retrieve sessions' });
        }
    }

    // GET /api/research/sessions/:id - get a specific session
    async getSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);

            if (isNaN(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }

            const session = await sessionService.getSession(sessionId, userId);

            if (!session) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            res.json(session);
        } catch (error) {
            logger.error('Failed to get session', { error });
            res.status(500).json({ error: 'Failed to retrieve session' });
        }
    }

    // POST /api/research/sessions/:id/clarify - get clarifying questions
    async startClarification(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);
            if (isNaN(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }
            const questions = await sessionService.startClarification(sessionId, userId);
            res.json({ questions });
        } catch (error) {
            logger.error('Failed to start clarification', { error });
            res.status(500).json({ error: 'Failed to generate clarifying questions' });
        }
    }

    // POST /api/research/sessions/:id/answers - submit answers and refine query
    async submitAnswers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);
            const { answers } = req.body;

            if (isNaN(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }

            if (!answers || !Array.isArray(answers)) {
                res.status(400).json({ error: 'Answers must be an array' });
                return;
            }

            const refinedQuery = await sessionService.processClarificationAnswers(sessionId, userId, answers);

            res.json({ refined_query: refinedQuery });
        } catch (error) {
            logger.error('Failed to process answers', { error });
            res.status(500).json({ error: 'Failed to process answers' });
        }
    }

    // POST /api/research/sessions/:id/search - execute paper search
    async searchPapers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);
            const limit = parseInt(req.body.limit) || 20;

            if (isNaN(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }

            const papers = await sessionService.searchPapers(sessionId, userId, limit);

            res.json({ papers, count: papers.length });
        } catch (error) {
            logger.error('Failed to search papers', { error });
            res.status(500).json({ error: 'Failed to search papers' });
        }
    }

    // GET /api/research/sessions/:id/papers - get sessions papers
    async getSessionPapers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);

            if (isNaN(sessionId)) {
                res.status(500).json({ error: 'Invalid session ID' });
                return;
            }

            const papers = await sessionService.getSessionPapers(sessionId, userId);
            res.json(papers);
        } catch (error) {
            logger.error('Failed to get session papers', { error });
            res.status(500).json({ error: 'Failed to retrieve papers' });
        }
    }

    // POST /api/research/sessions/:id/select - select papers for report
    async selectPapers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);
            const { paper_ids } = req.body;
            if (isNaN(sessionId)) {
                res.status(500).json({ error: 'Invalid session ID' });
                return;
            }

            if (!paper_ids || !Array.isArray(paper_ids)) {
                res.status(400).json({ error: 'paper_ids must be an array' });
                return;
            }

            await sessionService.selectPapers(sessionId, userId, paper_ids);

            res.json({ message: 'Papers selected successfully' });
        } catch (error) {
            logger.error('Failed to select papers', { error });
            res.status(500).json({ error: 'Failed to select papers' });
        }
    }

    // POST /api/research/sessions/:id/report - generate report
    async generateReport(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);
            const { report_type } = req.body;

            if (isNaN(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }

            const validTypes = ['literature_review', 'summary', 'comparison'];

            const type = validTypes.includes(report_type) ? report_type : 'literature_review';

            const report = await sessionService.generateReport(sessionId, userId, type);
            res.status(201).json(report);
        } catch (error) {
            logger.error('Failed to generate report', { error });
            res.status(500).json({ error: 'Failed to generate report' });
        }
    }

    // GET /api/research/sessions/:id/reports - get sessions reports
    async getSessionReports(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);

            if (isNaN(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }

            const reports = await sessionService.getSessionReports(sessionId, userId);
            res.json(reports);
        } catch (error) {
            logger.error('Failed to get reports', { error });
            res.status(500).json({ error: 'Failed to retrieve reports' });
        }
    }

    // POST /api/research/sessions/:id/ask - ask a question about papers
    async askQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);
            const { question } = req.body;

            if (isNaN(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }

            if (!question || typeof question !== 'string') {
                res.status(400).json({ error: 'Question is required' });
                return;
            }

            const answer = await sessionService.askQuestion(sessionId, userId, question);
            res.json({ answer });
        } catch (error) {
            logger.error('Failed to answer question', { error });
            res.status(500).json({ error: 'Failed to process question' });
        }
    }

    // POST /api/research/sessions/:id/search-within - semantic sesarch within session
    async searchWithinSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = parseInt(req.params.id);
            const { query } = req.body;

            if (isNaN(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID' });
                return;
            }

            if (!query || typeof query !== 'string') {
                res.status(400).json({ error: 'Query is required' });
                return;
            }

            const results = await sessionService.searchWithinSession(sessionId, userId, query);
            res.json(results);
        } catch (error) {
            logger.error('Failed to search within session', { error });
            res.status(500).json({ error: 'Failed to search' });
        }
    }

    // POST /api/research/papers/:id/annotations - Add annotation to paper
    async addAnnotation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const paperId = parseInt(req.params.id);
            const { content, note_type } = req.body;

            if (isNaN(paperId)) {
                res.status(400).json({ error: 'Invalid paper ID' });
                return;
            }

            if (!content || typeof content !== 'string') {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const validTypes = ['annotation', 'summary', 'highlight'];
            const type = validTypes.includes(note_type) ? note_type : 'annotation';

            const annotation = await knowledgeService.addAnnotation(userId, paperId, content, type);
            res.status(201).json(annotation);
        } catch (error) {
            logger.error('Failed to add annotation', { error });
            res.status(500).json({ error: 'Failed to add annotation' });
        }
    }

    // GET /api/research/knowledge - Get user's knowledge base
    async getUserKnowledge(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const paperId = req.query.paper_id ? parseInt(req.query.paper_id as string) : undefined;

            const knowledge = await knowledgeService.getUserKnowledge(userId, paperId);
            res.json(knowledge);
        } catch (error) {
            logger.error('Failed to get knowledge', { error });
            res.status(500).json({ error: 'Failed to retrieve knowledge' });
        }
    }

    // GET /api/research/knowledge/search - Search user's knowledge
    async searchKnowledge(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const query = req.query.q as string;
            const limit = parseInt(req.query.limit as string) || 10;

            if (!query) {
                res.status(400).json({ error: 'Search query (q) is required' });
                return;
            }

            const results = await knowledgeService.searchUserKnowledge(userId, query, limit);
            res.json(results);
        } catch (error) {
            logger.error('Failed to search knowledge', { error });
            res.status(500).json({ error: 'Failed to search knowledge' });
        }
    }

    // PUT /api/research/knowledge/:id - Update annotation
    async updateAnnotation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const knowledgeId = parseInt(req.params.id);
            const { content } = req.body;

            if (isNaN(knowledgeId)) {
                res.status(400).json({ error: 'Invalid knowledge ID' });
                return;
            }

            if (!content || typeof content !== 'string') {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const updated = await knowledgeService.updateAnnotation(knowledgeId, userId, content);

            if (!updated) {
                res.status(404).json({ error: 'Annotation not found' });
                return;
            }

            res.json(updated);
        } catch (error) {
            logger.error('Failed to update annotation', { error });
            res.status(500).json({ error: 'Failed to update annotation' });
        }
    }

    // DELETE /api/research/knowledge/:id - Delete annotation
    async deleteAnnotation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const knowledgeId = parseInt(req.params.id);

            if (isNaN(knowledgeId)) {
                res.status(400).json({ error: 'Invalid knowledge ID' });
                return;
            }

            const deleted = await knowledgeService.deleteAnnotation(knowledgeId, userId);

            if (!deleted) {
                res.status(404).json({ error: 'Annotation not found' });
                return;
            }

            res.status(204).send();
        } catch (error) {
            logger.error('Failed to delete annotation', { error });
            res.status(500).json({ error: 'Failed to delete annotation' });
        }
    }

    // GET /api/research/papers/search - Direct paper search (outside session)
    async directSearch(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const query = req.query.q as string;
            const limit = parseInt(req.query.limit as string) || 10;

            if (!query) {
                res.status(400).json({ error: 'Search query (q) is required' });
                return;
            }

            const papers = await searchService.searchPapers(query, limit);
            res.json({ papers, count: papers.length });
        } catch (error) {
            logger.error('Failed to search papers', { error });
            res.status(500).json({ error: 'Failed to search papers' });
        }
    }

    // GET /api/research/papers/similar - Find semantically similar papers
    async findSimilarPapers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const query = req.query.q as string;
            const limit = parseInt(req.query.limit as string) || 10;

            if (!query) {
                res.status(400).json({ error: 'Search query (q) is required' });
                return;
            }

            const results = await embeddingService.searchSimilarPapers(query, limit);
            res.json(results);
        } catch (error) {
            logger.error('Failed to find similar papers', { error });
            res.status(500).json({ error: 'Failed to find similar papers' });
        }
    }
}

export { ResearchController };