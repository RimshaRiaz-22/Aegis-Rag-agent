import { Router } from 'express';
import { ragController } from './rag.controller.js';
import { optionalAuth } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';

const router = Router();

router.post('/retrieve', optionalAuth, validateBody(['query']), ragController.retrieve);
router.post('/chat', optionalAuth, validateBody(['query']), ragController.chat);

export default router;
