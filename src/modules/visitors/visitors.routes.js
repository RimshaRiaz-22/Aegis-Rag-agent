import { Router } from 'express';
import { visitorsController } from './visitors.controller.js';
import { optionalAuth } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';

const router = Router();

// Public widget visitor tracking routes
router.post('/session', validateBody(['visitorToken', 'sessionToken']), visitorsController.trackSession);
router.post('/duration', visitorsController.updateDuration);

// Admin dashboard routes (supports both logged-in users and guest admins)
router.get('/analytics', optionalAuth, visitorsController.getAnalytics);
router.get('/', optionalAuth, visitorsController.getVisitors);
router.get('/:visitorId', optionalAuth, visitorsController.getVisitorDetails);
router.delete('/:visitorId', optionalAuth, visitorsController.deleteVisitor);

export default router;
