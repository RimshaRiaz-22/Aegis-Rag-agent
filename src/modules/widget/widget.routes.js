import { Router } from 'express';
import { widgetController } from './widget.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';

const router = Router();

// Public widget endpoints
router.get('/config/:userId', widgetController.getConfig);
router.post('/chat/:userId', validateBody(['query']), widgetController.publicChat);
router.post('/chat', validateBody(['query']), widgetController.publicChat);

// Authenticated owner endpoints
router.get('/config', authenticate, widgetController.getConfig);
router.put('/config', authenticate, widgetController.updateConfig);

export default router;
