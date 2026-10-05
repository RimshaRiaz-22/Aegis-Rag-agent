import { verifyAccessToken } from '../utils/token.js';
import { errorResponse } from '../utils/response.js';

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
}

export function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return errorResponse(res, 'Authentication required. Missing Bearer token.', 401);
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 'Session token expired. Please refresh your session.', 401);
    }
    return errorResponse(res, 'Invalid authentication token.', 401);
  }
}

export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
    } catch {
      // Ignored for optional auth
    }
  }
  next();
}
