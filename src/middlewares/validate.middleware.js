import { errorResponse } from '../utils/response.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Basic presence validation for required fields
 */
export function validateFields(requiredFields = []) {
  return (req, res, next) => {
    const missing = [];
    for (const field of requiredFields) {
      const val = req.body?.[field];
      if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return errorResponse(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    next();
  };
}

export const validateBody = validateFields;

/**
 * Pure JavaScript Schema Validator
 * Supports: type, required, min, max, regex, isEmail, isUuid, sanitize
 */
export function validateSchema(schema) {
  return (req, res, next) => {
    const errors = [];
    const sanitizedBody = {};

    for (const [field, rules] of Object.entries(schema)) {
      let val = req.body?.[field];

      // Check required
      if (rules.required && (val === undefined || val === null || (typeof val === 'string' && val.trim() === ''))) {
        errors.push(`Field '${field}' is required`);
        continue;
      }

      if (val === undefined || val === null) {
        if (rules.default !== undefined) {
          sanitizedBody[field] = typeof rules.default === 'function' ? rules.default() : rules.default;
        }
        continue;
      }

      // Check type
      if (rules.type) {
        if (rules.type === 'array' && !Array.isArray(val)) {
          errors.push(`Field '${field}' must be an array`);
          continue;
        } else if (rules.type === 'number') {
          const num = Number(val);
          if (isNaN(num)) {
            errors.push(`Field '${field}' must be a number`);
            continue;
          }
          val = num;
        } else if (rules.type === 'boolean') {
          val = Boolean(val);
        } else if (rules.type === 'string' && typeof val !== 'string') {
          errors.push(`Field '${field}' must be a string`);
          continue;
        }
      }

      // String sanitization & constraints
      if (typeof val === 'string') {
        if (rules.trim !== false) {
          val = val.trim();
        }
        if (rules.min && val.length < rules.min) {
          errors.push(`Field '${field}' must be at least ${rules.min} characters`);
        }
        if (rules.max && val.length > rules.max) {
          errors.push(`Field '${field}' must be at most ${rules.max} characters`);
        }
        if (rules.isEmail && !EMAIL_REGEX.test(val)) {
          errors.push(`Field '${field}' must be a valid email address`);
        }
        if (rules.isUuid && !UUID_REGEX.test(val)) {
          errors.push(`Field '${field}' must be a valid UUID`);
        }
        if (rules.regex && !rules.regex.test(val)) {
          errors.push(`Field '${field}' has an invalid format`);
        }
      }

      // Number constraints
      if (typeof val === 'number') {
        if (rules.min !== undefined && val < rules.min) {
          errors.push(`Field '${field}' must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && val > rules.max) {
          errors.push(`Field '${field}' must be at most ${rules.max}`);
        }
      }

      sanitizedBody[field] = val;
    }

    if (errors.length > 0) {
      return errorResponse(res, `Validation error: ${errors.join('; ')}`, 400);
    }

    // Merge validated fields back to req.body
    req.body = { ...req.body, ...sanitizedBody };
    next();
  };
}
