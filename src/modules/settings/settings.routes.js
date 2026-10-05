import { Router } from 'express';
import { settingsController } from './settings.controller.js';
import { optionalAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(optionalAuth);

router.get('/', settingsController.getSettings);
router.put('/', settingsController.updateSettings);
router.post('/', settingsController.updateSettings);

export default router;
