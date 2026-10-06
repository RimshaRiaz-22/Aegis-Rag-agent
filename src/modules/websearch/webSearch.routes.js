import { Router } from 'express';
import { webSearchController } from './webSearch.controller.js';
import { requireUserOrGuest } from '../../middlewares/auth.middleware.js';
import { validateSchema } from '../../middlewares/validate.middleware.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.middleware.js';

const router = Router();

const searchLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many search requests. Please wait a minute before searching again.',
});

const searchSchema = {
  query: { required: true, type: 'string', min: 1, max: 1000 },
  maxResults: { required: false, type: 'number', min: 1, max: 10 },
};

router.use(requireUserOrGuest);
router.use(searchLimiter);

router.post('/search', validateSchema(searchSchema), webSearchController.search);

export default router;
