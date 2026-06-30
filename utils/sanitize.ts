import validator from 'validator';

/**
 * Sanitize string input to prevent XSS attacks
 */
export function sanitizeString(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  // Trim and escape HTML
  return validator.escape(validator.trim(input));
}

/**
 * Sanitize email address
 */
export function sanitizeEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') {
    return '';
  }
  const trimmed = validator.trim(email);
  // Validate and normalize email
  if (validator.isEmail(trimmed)) {
    return validator.normalizeEmail(trimmed) || trimmed;
  }
  return trimmed;
}

/**
 * Sanitize phone number
 */
export function sanitizePhone(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  // Remove non-digit characters except +, -, spaces, and parentheses
  return validator.trim(phone.replace(/[^\d+\-() ]/g, ''));
}

/**
 * Sanitize text area (strip HTML tags; preserve plain text including / in dates).
 * React escapes on render — no need to entity-encode slashes.
 */
export function sanitizeText(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return validator.trim(text).replace(/<[^>]*>/g, '');
}

/** Reverse validator.escape-style entities in stored notes (legacy data). */
export function decodeHtmlEntities(input: string): string {
  if (!input) return input;
  return input
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

export function normalizeStoredText(text: string | null | undefined): string | undefined {
  if (text == null || text === '') return text === '' ? '' : undefined;
  return decodeHtmlEntities(String(text));
}

/**
 * Sanitize object with string fields
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
  const sanitized = { ...obj };
  for (const field of fields) {
    if (typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeString(sanitized[field]) as any;
    }
  }
  return sanitized;
}

/**
 * Validate and sanitize filename to prevent path traversal
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'file';
  }
  
  // Remove path traversal attempts
  let sanitized = filename.replace(/\.\./g, '').replace(/\//g, '_').replace(/\\/g, '_');
  
  // Remove any remaining dangerous characters
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Ensure it's not empty
  if (!sanitized || sanitized.length === 0) {
    return 'file';
  }
  
  // Limit length
  if (sanitized.length > 255) {
    const ext = sanitized.substring(sanitized.lastIndexOf('.'));
    sanitized = sanitized.substring(0, 255 - ext.length) + ext;
  }
  
  return sanitized;
}

