import { Router } from 'express';
import { visitorsController } from './visitors.controller.js';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware.js';
import { validateFields } from '../../middlewares/validate.middleware.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.middleware.js';

const router = Router();

const visitorTrackingLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many tracking requests.',
});

// Public widget visitor tracking routes (optionalAuth to identify admin preview)
router.post(
  '/session',
  visitorTrackingLimiter,
  optionalAuth,
  validateFields(['visitorToken', 'sessionToken']),
  visitorsController.trackSession
);
router.post('/duration', visitorTrackingLimiter, optionalAuth, visitorsController.updateDuration);

// Admin dashboard routes — strictly requires authenticated JWT
router.get('/analytics', authenticate, visitorsController.getAnalytics);
router.get('/', authenticate, visitorsController.getVisitors);
router.get('/:visitorId', authenticate, visitorsController.getVisitorDetails);
router.delete('/:visitorId', authenticate, visitorsController.deleteVisitor);

export default router;
