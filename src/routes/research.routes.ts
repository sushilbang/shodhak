import { Router } from 'express';
import { ResearchController } from '../controllers/research.controller'
import { authMiddleware } from '../middleware/auth.middlware';

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

const router = Router();
const controller = new ResearchController();

router.post(
    '/sessions',
    authMiddleware,
    controller.createSession.bind(controller)
);

router.get(
    '/sessions',
    authMiddleware,
    controller.getUserSessions.bind(controller)
);

router.get(
    '/sessions/:id',
    authMiddleware,
    controller.getSession.bind(controller)
);

router.post(
    '/sessions/:id/clarify',
    authMiddleware,
    controller.startClarification.bind(controller)
);

router.post(
    '/sessions/:id/answers',
    authMiddleware,
    controller.submitAnswers.bind(controller)
);

router.post(
    '/sessions/:id/search',
    authMiddleware,
    controller.searchPapers.bind(controller)
);

router.get(
    '/sessions/:id/papers',
    authMiddleware,
    controller.getSessionPapers.bind(controller)
);

router.post(
    '/sessions/:id/select',
    authMiddleware,
    controller.selectPapers.bind(controller)
);

router.post(
    '/sessions/:id/report',
    authMiddleware,
    controller.generateReport.bind(controller)
);

router.get(
    '/sessions/:id/reports',
    authMiddleware,
    controller.getSessionReports.bind(controller)
);

router.post(
    '/sessions/:id/ask',
    authMiddleware,
    controller.askQuestion.bind(controller)
);

router.post(
    '/sessions/:id/search-within',
    authMiddleware,
    controller.searchWithinSession.bind(controller)
);

router.post(
    '/papers/:id/annotations',
    authMiddleware,
    controller.addAnnotation.bind(controller)
);

router.get(
    '/knowledge',
    authMiddleware,
    controller.getUserKnowledge.bind(controller)
);

router.get(
    '/knowledge/search',
    authMiddleware,
    controller.searchKnowledge.bind(controller)
);

router.put(
    '/knowledge/:id',
    authMiddleware,
    controller.updateAnnotation.bind(controller)
);

router.delete(
    '/knowledge/:id',
    authMiddleware,
    controller.deleteAnnotation.bind(controller)
);

router.get(
    '/papers/search',
    authMiddleware,
    controller.directSearch.bind(controller)
);

router.get(
    '/papers/similar',
    authMiddleware,
    controller.findSimilarPapers.bind(controller)
);

export default router;