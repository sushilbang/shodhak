import { Router } from 'express';
import { agentController } from '../controllers/agent.controller';
import { authMiddleware } from '../middleware/auth.middlware';

const router = Router();

// POST /api/agent/chat - Main chat endpoint
router.post(
    '/chat',
    authMiddleware,
    agentController.chat.bind(agentController)
);

// GET /api/agent/sessions - List active sessions for user
router.get(
    '/sessions',
    authMiddleware,
    agentController.listSessions.bind(agentController)
);

// GET /api/agent/sessions/:id - Get session info
router.get(
    '/sessions/:id',
    authMiddleware,
    agentController.getSession.bind(agentController)
);

// DELETE /api/agent/sessions/:id - End session
router.delete(
    '/sessions/:id',
    authMiddleware,
    agentController.endSession.bind(agentController)
);

export default router;
