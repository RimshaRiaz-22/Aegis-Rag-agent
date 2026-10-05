import { Router } from 'express';
import { chatController } from './chat.controller.js';
import { optionalAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(optionalAuth);

router.get('/sessions', chatController.getSessions);
router.post('/sessions', chatController.saveSessions);
router.put('/sessions/:id', chatController.saveSingleSession);
router.delete('/sessions/:id', chatController.deleteSession);

export default router;
