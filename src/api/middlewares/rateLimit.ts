import rateLimit, { Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { IRequest, IResponse } from '../../interfaces/IRequest';

let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedisClient() {
  if (!redisClient && process.env.REDIS_URL) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL });
      await redisClient.connect();
    } catch (err) {
      console.error('Rate limit Redis connection failed, falling back to memory store:', err.message);
      redisClient = null;
    }
  }
  return redisClient;
}

function createRedisStore(prefix: string) {
  if (!process.env.REDIS_URL) {
    return undefined; // Use default memory store
  }

  return new RedisStore({
    sendCommand: async (...args: string[]) => {
      const client = await getRedisClient();
      if (!client) {
        throw new Error('Redis client not available');
      }
      return client.sendCommand(args);
    },
    prefix: `${process.env.REDIS_ENV || ''}rate_limit:${prefix}:`,
  });
}

// Helper to get client IP from request, handling proxies
function getClientIp(req: IRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip.trim();
  }
  return req.ip || 'unknown';
}

// Base options shared by all rate limiters
const baseOptions: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  // Disable the validation that requires ipKeyGenerator since we handle X-Forwarded-For
  validate: { xForwardedForHeader: false },
};

// Global rate limiter: 200 requests per minute per IP
export const globalRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  store: createRedisStore('global'),
  keyGenerator: (req: IRequest) => getClientIp(req),
  handler: (_req: IRequest, res: IResponse) => {
    res.status(429).json({
      message: 'Too many requests, please try again later.',
    });
  },
  skip: (req: IRequest) => {
    // Skip rate limiting for health checks
    return req.path === '/v1/status';
  },
});

// Strict rate limiter for auth endpoints: 10 requests per minute per IP
export const authRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  store: createRedisStore('auth'),
  keyGenerator: (req: IRequest) => getClientIp(req),
  handler: (_req: IRequest, res: IResponse) => {
    res.status(429).json({
      message: 'Too many authentication attempts, please try again later.',
    });
  },
});

// Email verification rate limiter: 5 requests per hour per email
export const emailVerificationRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  store: createRedisStore('email_verify'),
  keyGenerator: (req: IRequest) => {
    // Rate limit by email address if provided
    const email = req.body?.email?.toLowerCase?.() || '';
    const ip = getClientIp(req);
    return email ? `${email}:${ip}` : ip;
  },
  handler: (_req: IRequest, res: IResponse) => {
    res.status(429).json({
      message: 'Too many verification attempts, please try again later.',
    });
  },
});
