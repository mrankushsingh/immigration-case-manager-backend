/**
 * Safe error response utility
 * Prevents information disclosure in production
 */

export function getSafeErrorMessage(error: any, defaultMessage: string): string {
  // In development, show detailed errors
  if (process.env.NODE_ENV === 'development') {
    return error?.message || defaultMessage;
  }
  
  // In production, only return generic messages
  return defaultMessage;
}

/**
 * Get safe error response object
 */
export function getSafeErrorResponse(error: any, defaultMessage: string, statusCode: number = 500) {
  const message = getSafeErrorMessage(error, defaultMessage);
  
  const response: any = {
    error: message,
  };
  
  // Only include stack trace in development
  if (process.env.NODE_ENV === 'development' && error?.stack) {
    response.stack = error.stack;
  }
  
  return {
    statusCode,
    response,
  };
}

