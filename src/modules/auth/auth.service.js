import { authRepository } from './auth.repository.js';
import { hashPassword, comparePassword } from '../../utils/password.js';
import { generateTokens, verifyRefreshToken } from '../../utils/token.js';

export const authService = {
  async signup({ email, password, name }) {
    const existing = await authRepository.findByEmail(email);
    if (existing) {
      const err = new Error('An account with this email address already exists.');
      err.statusCode = 409;
      throw err;
    }

    const passwordHash = await hashPassword(password);
    const user = await authRepository.createUser({
      email,
      passwordHash,
      name: name || email.split('@')[0],
    });

    const tokens = generateTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.created_at,
      },
      ...tokens,
    };
  },

  async login({ email, password }) {
    const user = await authRepository.findByEmail(email);
    if (!user) {
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      throw err;
    }

    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      throw err;
    }

    const tokens = generateTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.created_at,
      },
      ...tokens,
    };
  },

  async refresh(refreshToken) {
    if (!refreshToken) {
      const err = new Error('Refresh token is required.');
      err.statusCode = 400;
      throw err;
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (err) {
      const error = new Error('Invalid or expired refresh token.');
      error.statusCode = 401;
      throw error;
    }

    const user = await authRepository.findById(payload.id);
    if (!user) {
      const error = new Error('User account not found.');
      error.statusCode = 404;
      throw error;
    }

    const tokens = generateTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.created_at,
      },
      ...tokens,
    };
  },

  async getMe(userId) {
    const user = await authRepository.findById(userId);
    if (!user) {
      const error = new Error('User not found.');
      error.statusCode = 404;
      throw error;
    }
    return user;
  },
};
