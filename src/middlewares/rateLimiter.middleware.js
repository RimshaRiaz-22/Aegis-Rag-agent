import { errorResponse } from '../utils/response.js';

/**
 * Enterprise-grade in-memory sliding window rate limiter
 * Features:
 * - Bounded memory map (maximum 10,000 clients) preventing memory exhaustion
 * - Periodic cleanup with unref() so timers don't block server graceful shutdown
 * - Sanitized IP resolution
 */
export function createRateLimiter({
  windowMs = 60 * 1000,
  max = 60,
  message = 'Too many requests, please try again later.',
  maxEntries = 10000,
} = {}) {
  const requests = new Map();

  // Periodic cleanup of expired entries
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of requests.entries()) {
      if (now - data.startTime > windowMs) {
        requests.delete(key);
      }
    }
  }, windowMs);

  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return (req, res, next) => {
    // Resolve client IP safely
    let clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    if (typeof clientIp === 'string' && clientIp.includes(',')) {
      clientIp = clientIp.split(',')[0].trim();
    }

    const now = Date.now();

    // Prevent memory exhaustion attacks: if Map exceeds maxEntries, evict oldest
    if (requests.size >= maxEntries && !requests.has(clientIp)) {
      const oldestKey = requests.keys().next().value;
      if (oldestKey) requests.delete(oldestKey);
    }

    if (!requests.has(clientIp)) {
      requests.set(clientIp, { count: 1, startTime: now });
      return next();
    }

    const data = requests.get(clientIp);
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
