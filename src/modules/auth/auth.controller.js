import { authService } from './auth.service.js';
import { successResponse } from '../../utils/response.js';

export const authController = {
  async signup(req, res, next) {
    try {
      const { email, password, name } = req.body;
      const result = await authService.signup({ email, password, name });
      return successResponse(res, result, 'Account created successfully', 201);
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const result = await authService.login({ email, password });
      return successResponse(res, result, 'Logged in successfully', 200);
    } catch (err) {
      next(err);
    }
  },

  async refresh(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refresh(refreshToken);
      return successResponse(res, result, 'Session refreshed successfully', 200);
    } catch (err) {
      next(err);
    }
  },

  async logout(req, res) {
    // Stateless token is cleared client-side from sessionStorage
    return successResponse(res, null, 'Logged out successfully', 200);
  },

  async getMe(req, res, next) {
    try {
      const user = await authService.getMe(req.user.id);
      return successResponse(res, {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.created_at,
      });
    } catch (err) {
      next(err);
    }
  },
};
