import { errorResponse } from '../utils/response.js';

/**
 * Lightweight in-memory sliding window rate limiter
 */
export function createRateLimiter({ windowMs = 60 * 1000, max = 60, message = 'Too many requests, please try again later.' } = {}) {
  const requests = new Map();

  // Periodic cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of requests.entries()) {
      if (now - data.startTime > windowMs) {
        requests.delete(ip);
      }
    }
  }, windowMs);

  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!requests.has(ip)) {
      requests.set(ip, { count: 1, startTime: now });
      return next();
    }

    const data = requests.get(ip);
    if (now - data.startTime < windowMs) {
      data.count++;
      if (data.count > max) {
        return errorResponse(res, message, 429);
      }
      return next();
    }

    // Reset window
    data.count = 1;
    data.startTime = now;
    return next();
  };
}
