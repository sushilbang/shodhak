import { Request, Response } from 'express';
import { agentService } from '../services/agent.service';
import { sessionPersistence } from '../services/session-persistence.service';
import { logger } from '../utils/logger';

interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        email: string;
    };
}

class AgentController {

    // POST /api/agent/chat - Main chat endpoint
    async chat(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { message, session_id } = req.body;

            if (!message || typeof message !== 'string' || message.trim().length === 0) {
                res.status(400).json({ error: 'Message is required' });
                return;
            }

            const response = await agentService.chat(
                userId,
                message.trim(),
                session_id
            );

            res.json({
                session_id: response.sessionId,
                response: response.message,
                papers: response.papers?.map((p, idx) => ({
                    index: idx,
                    title: p.title,
                    authors: p.authors.map(a => a.name).join(', '),
                    year: p.year,
                    abstract: p.abstract?.slice(0, 300),
                    doi: p.doi
                })),
                metadata: {
                    tools_used: response.toolsUsed,
                    iterations: response.iterationCount,
                    papers_in_context: response.papers?.length || 0,
                    completed: response.done
                }
            });

        } catch (error) {
            logger.error('Agent chat failed', { error });
            res.status(500).json({
                error: 'Failed to process request',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // GET /api/agent/sessions - List active sessions for user
    async listSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessions = await sessionPersistence.getUserActiveSessions(userId);

            res.json({
                sessions: sessions.map(s => ({
                    session_id: s.id,
                    status: s.status,
                    created_at: s.created_at,
                    last_activity_at: s.last_activity_at,
                    metadata: s.metadata,
                }))
            });
        } catch (error) {
            logger.error('List sessions failed', { error });
            res.status(500).json({ error: 'Failed to retrieve sessions' });
        }
    }

    // GET /api/agent/sessions/:id - Get session info
    async getSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const sessionId = req.params.id;

            const context = await agentService.getSession(sessionId, userId);

            if (!context) {
                res.status(404).json({ error: 'Session not found or expired' });
                return;
            }

            res.json({
                session_id: context.sessionId,
                papers_count: context.papers.length,
                papers: context.papers.map((p, idx) => ({
                    index: idx,
                    title: p.title,
                    authors: p.authors.map(a => a.name).join(', '),
                    year: p.year
                })),
                metadata: context.metadata,
                message_count: context.conversationHistory.length
            });

        } catch (error) {
            logger.error('Get session failed', { error });
            res.status(500).json({ error: 'Failed to retrieve session' });
        }
    }

    // DELETE /api/agent/sessions/:id - End session
    async endSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const sessionId = req.params.id;

            const deleted = await agentService.endSession(sessionId);

            if (!deleted) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            res.json({ message: 'Session ended successfully' });

        } catch (error) {
            logger.error('End session failed', { error });
            res.status(500).json({ error: 'Failed to end session' });
        }
    }
}

export const agentController = new AgentController();
