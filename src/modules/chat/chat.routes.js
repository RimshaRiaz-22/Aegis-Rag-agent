import { Router } from 'express';
import { chatController } from './chat.controller.js';
import { requireUserOrGuest } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(requireUserOrGuest);

router.get('/sessions', chatController.getSessions);
router.post('/sessions', chatController.saveSessions);
router.put('/sessions/:id', chatController.saveSingleSession);
router.patch('/sessions/:id/pin', chatController.togglePin);
router.delete('/sessions', chatController.deleteAllSessions);
router.delete('/sessions/:id', chatController.deleteSession);

export default router;
