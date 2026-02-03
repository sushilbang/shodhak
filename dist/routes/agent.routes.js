"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const agent_controller_1 = require("../controllers/agent.controller");
const auth_middlware_1 = require("../middleware/auth.middlware");
const router = (0, express_1.Router)();
// POST /api/agent/chat - Main chat endpoint
router.post('/chat', auth_middlware_1.authMiddleware, agent_controller_1.agentController.chat.bind(agent_controller_1.agentController));
// GET /api/agent/sessions - List active sessions for user
router.get('/sessions', auth_middlware_1.authMiddleware, agent_controller_1.agentController.listSessions.bind(agent_controller_1.agentController));
// GET /api/agent/sessions/:id - Get session info
router.get('/sessions/:id', auth_middlware_1.authMiddleware, agent_controller_1.agentController.getSession.bind(agent_controller_1.agentController));
// DELETE /api/agent/sessions/:id - End session
router.delete('/sessions/:id', auth_middlware_1.authMiddleware, agent_controller_1.agentController.endSession.bind(agent_controller_1.agentController));
exports.default = router;
