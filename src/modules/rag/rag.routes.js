import { Router } from 'express';
import { ragController } from './rag.controller.js';
import { requireUserOrGuest } from '../../middlewares/auth.middleware.js';
import { validateSchema } from '../../middlewares/validate.middleware.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.middleware.js';

const router = Router();

const ragLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many RAG requests. Please wait a moment before sending another query.',
});

const querySchema = {
  query: { required: true, type: 'string', min: 1, max: 10000 },
  topK: { required: false, type: 'number', min: 1, max: 20 },
  similarityThreshold: { required: false, type: 'number', min: 0, max: 1 },
};

router.use(requireUserOrGuest);
router.use(ragLimiter);

router.post('/retrieve', validateSchema(querySchema), ragController.retrieve);
router.post('/chat', validateSchema(querySchema), ragController.chat);
router.post('/chat/stream', validateSchema(querySchema), ragController.chatStream);

export default router;
