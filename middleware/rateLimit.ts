import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';

// Rate limit configuration for different endpoint types
export const rateLimitConfig = {
  // General API endpoints (GET, POST, PUT, DELETE for most resources)
  general: {
    max: 100, // 100 requests
    timeWindow: 15 * 60 * 1000, // per 15 minutes
    errorResponseBuilder: (request: FastifyRequest, context: any) => {
      return {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(context.ttl / 1000), // seconds
      };
    },
  },

  // File upload endpoints (more restrictive)
  fileUpload: {
    max: 20, // 20 requests
    timeWindow: 15 * 60 * 1000, // per 15 minutes
    errorResponseBuilder: (request: FastifyRequest, context: any) => {
      return {
        error: 'Too many file uploads',
        message: 'File upload rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
  },

  // Sensitive operations (user management, database copy, data export/import)
  sensitive: {
    max: 10, // 10 requests
    timeWindow: 15 * 60 * 1000, // per 15 minutes
    errorResponseBuilder: (request: FastifyRequest, context: any) => {
      return {
        error: 'Too many sensitive operations',
        message: 'Rate limit exceeded for sensitive operations. Please try again later.',
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
  },

  // Analytics endpoints (moderate limit)
  analytics: {
    max: 50, // 50 requests
    timeWindow: 15 * 60 * 1000, // per 15 minutes
    errorResponseBuilder: (request: FastifyRequest, context: any) => {
      return {
        error: 'Too many analytics requests',
        message: 'Analytics rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
  },
};

// Helper function to get client identifier for rate limiting
// Uses user ID if authenticated, otherwise falls back to IP
export function getRateLimitKey(request: FastifyRequest): string {
  const authRequest = request as any;
  if (authRequest.user?.uid) {
    return `user:${authRequest.user.uid}`;
  }
  // Fallback to IP address
  const ip = request.ip || request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

// Register rate limiting plugin with custom key generator
export async function registerRateLimit(fastify: any, config: typeof rateLimitConfig.general) {
  await fastify.register(rateLimit, {
    max: config.max,
    timeWindow: config.timeWindow,
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: config.errorResponseBuilder,
    // Use Redis or memory store (memory is fine for single instance)
    // For distributed systems, use Redis: store: new Redis({ host: 'localhost' })
  });
}

