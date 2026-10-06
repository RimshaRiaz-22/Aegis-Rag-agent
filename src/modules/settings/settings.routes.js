import { Router } from 'express';
import { settingsController } from './settings.controller.js';
import { requireUserOrGuest } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(requireUserOrGuest);

router.get('/', settingsController.getSettings);
router.put('/', settingsController.updateSettings);
router.post('/', settingsController.updateSettings);

export default router;
