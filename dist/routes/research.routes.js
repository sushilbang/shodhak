"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const research_controller_1 = require("../controllers/research.controller");
const auth_middlware_1 = require("../middleware/auth.middlware");
/*
research routes - the url map for all research related API endpoints.

route naming conventionL
- plural nouns for resources: /sessions, /papers, /knowledge
- nested routes for relationships: /sessions/:id/papers
- verbs for actions: /sessions/:id/clarify, /sessions/:id/search

- Router(): Express mini-application for modular routes
- .bind(controller): Preserves this context in class methods (without this, this would be undefined inside methods)
- :id in path: Dynamic parameter accessed via req.params.id
- Middleware chain: authMiddleware runs before controller method
*/
const router = (0, express_1.Router)();
const controller = new research_controller_1.ResearchController();
router.post('/sessions', auth_middlware_1.authMiddleware, controller.createSession.bind(controller));
router.get('/sessions', auth_middlware_1.authMiddleware, controller.getUserSessions.bind(controller));
router.get('/sessions/:id', auth_middlware_1.authMiddleware, controller.getSession.bind(controller));
router.post('/sessions/:id/clarify', auth_middlware_1.authMiddleware, controller.startClarification.bind(controller));
router.post('/sessions/:id/answers', auth_middlware_1.authMiddleware, controller.submitAnswers.bind(controller));
router.post('/sessions/:id/search', auth_middlware_1.authMiddleware, controller.searchPapers.bind(controller));
router.get('/sessions/:id/papers', auth_middlware_1.authMiddleware, controller.getSessionPapers.bind(controller));
router.post('/sessions/:id/select', auth_middlware_1.authMiddleware, controller.selectPapers.bind(controller));
router.post('/sessions/:id/report', auth_middlware_1.authMiddleware, controller.generateReport.bind(controller));
router.get('/sessions/:id/reports', auth_middlware_1.authMiddleware, controller.getSessionReports.bind(controller));
router.post('/sessions/:id/ask', auth_middlware_1.authMiddleware, controller.askQuestion.bind(controller));
router.post('/sessions/:id/search-within', auth_middlware_1.authMiddleware, controller.searchWithinSession.bind(controller));
router.post('/papers/:id/annotations', auth_middlware_1.authMiddleware, controller.addAnnotation.bind(controller));
router.get('/knowledge', auth_middlware_1.authMiddleware, controller.getUserKnowledge.bind(controller));
router.get('/knowledge/search', auth_middlware_1.authMiddleware, controller.searchKnowledge.bind(controller));
router.put('/knowledge/:id', auth_middlware_1.authMiddleware, controller.updateAnnotation.bind(controller));
router.delete('/knowledge/:id', auth_middlware_1.authMiddleware, controller.deleteAnnotation.bind(controller));
router.get('/papers/search', auth_middlware_1.authMiddleware, controller.directSearch.bind(controller));
router.get('/papers/similar', auth_middlware_1.authMiddleware, controller.findSimilarPapers.bind(controller));
exports.default = router;
