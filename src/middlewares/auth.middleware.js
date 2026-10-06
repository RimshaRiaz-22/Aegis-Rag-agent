import { verifyAccessToken } from '../utils/token.js';
import { errorResponse } from '../utils/response.js';
import { getRequestUserId, isRegisteredUser, ensureUserExists } from '../utils/userId.js';

function extractToken(req) {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
}

/**
 * Strict authentication: Valid JWT Bearer token is strictly required.
 */
export function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return errorResponse(res, 'Authentication required. Missing Bearer token.', 401);
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    req.tenantId = decoded.id;
    req.isGuest = false;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 'Session token expired. Please refresh your session.', 401);
    }
    return errorResponse(res, 'Invalid authentication token.', 401);
  }
}

/**
 * Optional authentication: Decodes token if present without failing.
 */
export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
      req.tenantId = decoded.id;
      req.isGuest = false;
    } catch {
      // Ignored for optional auth
    }
  }
  next();
}

/**
 * Hybrid authorization guard: Supports registered authenticated users OR isolated ephemeral guests.
 * Crucially guarantees IDOR protection: unauthenticated callers CANNOT claim or access
 * a registered user's account without a valid JWT.
 */
export async function requireUserOrGuest(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
      req.tenantId = decoded.id;
      req.isGuest = false;
      return next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return errorResponse(res, 'Session token expired. Please refresh your session.', 401);
      }
      return errorResponse(res, 'Invalid authentication token.', 401);
    }
  }

  // No bearer token provided: resolve guest identity
  const candidateId = getRequestUserId(req);
  if (!candidateId) {
    return errorResponse(res, 'Authentication or guest session identity required.', 401);
  }

  // IDOR Protection: Check if candidateId belongs to a registered user
  const isRegistered = await isRegisteredUser(candidateId);
  if (isRegistered) {
    return errorResponse(
      res,
      'Access denied. Valid authentication token required to access registered user accounts.',
      403
    );
  }

  // Ephemeral guest user
  const guestUserId = await ensureUserExists(candidateId);
  req.tenantId = guestUserId;
  req.isGuest = true;
  next();
}
