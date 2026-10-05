import { Router } from 'express';
import { knowledgeController } from './knowledge.controller.js';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

// Ingestion supports authenticated user or fallback webhook secret
router.post('/ingest', optionalAuth, knowledgeController.ingest);

// Document management (supports both authenticated and guest users)
router.get('/documents', optionalAuth, knowledgeController.listDocuments);
router.get('/documents/:id', optionalAuth, knowledgeController.getDocument);
router.delete('/documents/:id', optionalAuth, knowledgeController.deleteDocument);
router.post('/delete', optionalAuth, knowledgeController.deleteDocument); // For legacy webhook compatibility

export default router;
