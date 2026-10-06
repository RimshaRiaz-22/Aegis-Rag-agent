import { Router } from 'express';
import { widgetController } from './widget.controller.js';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';

const router = Router();

// Public widget streaming endpoints (placed BEFORE :userId to prevent route collision)
router.post('/chat/stream/:userId', optionalAuth, validateBody(['query']), widgetController.publicChatStream);
router.post('/chat/stream', optionalAuth, validateBody(['query']), widgetController.publicChatStream);

// Public widget standard endpoints
router.get('/config/:userId', widgetController.getConfig);
router.post('/chat/:userId', optionalAuth, validateBody(['query']), widgetController.publicChat);
router.post('/chat', optionalAuth, validateBody(['query']), widgetController.publicChat);

// Authenticated owner endpoints
router.get('/config', authenticate, widgetController.getConfig);
router.put('/config', authenticate, widgetController.updateConfig);

export default router;
