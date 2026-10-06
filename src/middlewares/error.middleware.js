import { errorResponse } from '../utils/response.js';

export function errorHandler(err, req, res, next) {
  console.error('[Unhandled Error]', {
    method: req.method,
    url: req.originalUrl,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  const statusCode = err.statusCode || (err.status && typeof err.status === 'number' ? err.status : 500);
  const isDev = process.env.NODE_ENV === 'development';
  const message = statusCode >= 500 && !isDev
    ? 'An unexpected error occurred. Please try again later.'
    : (err.message || 'Request failed');

  return errorResponse(res, message, statusCode, isDev ? err.stack : undefined);
}
