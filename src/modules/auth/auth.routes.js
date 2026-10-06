import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validateFields } from '../../middlewares/validate.middleware.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.middleware.js';

const router = Router();

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
});

router.post('/signup', authLimiter, validateFields(['email', 'password']), authController.signup);
router.post('/login', authLimiter, validateFields(['email', 'password']), authController.login);
router.post('/refresh', validateFields(['refreshToken']), authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.getMe);
router.post('/guest-purge', authController.purgeGuest);

export default router;
