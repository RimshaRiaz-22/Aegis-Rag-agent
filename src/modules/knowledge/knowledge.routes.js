import { Router } from 'express';
import { knowledgeController } from './knowledge.controller.js';
import { requireUserOrGuest } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(requireUserOrGuest);

router.post('/ingest', knowledgeController.ingest);
router.post('/scrape-url', knowledgeController.scrapeUrl);
router.get('/documents', knowledgeController.listDocuments);
router.get('/documents/:id', knowledgeController.getDocument);
router.delete('/documents/:id', knowledgeController.deleteDocument);
router.post('/delete', knowledgeController.deleteDocument);

export default router;
