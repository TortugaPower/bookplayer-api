import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { IRequest, IResponse } from '../../interfaces/IRequest';

let redisClient: ReturnType<typeof createClient> | null = null;

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
  validate: { xForwardedForHeader: false },
};

function createRedisStore(prefix: string): RedisStore | undefined {
  if (!redisClient) {
    return undefined; // Use default memory store
  }

  return new RedisStore({
    sendCommand: (...args: string[]) => redisClient!.sendCommand(args),
    prefix: `${process.env.REDIS_ENV || ''}rate_limit:${prefix}:`,
  });
}

function createGlobalRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    ...baseOptions,
    windowMs: 60 * 1000,
    max: 200,
    store: createRedisStore('global'),
    keyGenerator: (req: IRequest) => getClientIp(req),
    handler: (_req: IRequest, res: IResponse) => {
      res.status(429).json({
        message: 'Too many requests, please try again later.',
      });
    },
    skip: (req: IRequest) => {
      return req.path === '/v1/status';
    },
  });
}

function createAuthRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    ...baseOptions,
    windowMs: 60 * 1000,
    max: 10,
    store: createRedisStore('auth'),
    keyGenerator: (req: IRequest) => getClientIp(req),
    handler: (_req: IRequest, res: IResponse) => {
      res.status(429).json({
        message: 'Too many authentication attempts, please try again later.',
      });
    },
  });
}

function createEmailVerificationRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    ...baseOptions,
    windowMs: 60 * 60 * 1000,
    max: 5,
    store: createRedisStore('email_verify'),
    keyGenerator: (req: IRequest) => {
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
}

// Rate limiters - initialized with memory store, upgraded to Redis if available
export let globalRateLimiter: RateLimitRequestHandler = createGlobalRateLimiter();
export let authRateLimiter: RateLimitRequestHandler = createAuthRateLimiter();
export let emailVerificationRateLimiter: RateLimitRequestHandler = createEmailVerificationRateLimiter();

// Initialize Redis connection and recreate rate limiters with Redis store
export async function initRateLimitRedis(): Promise<void> {
  if (!process.env.REDIS_URL) {
    console.log('Rate limiting using memory store (REDIS_URL not configured)');
    return;
  }

  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 10000, // 10 second timeout
      },
    });
    redisClient.on('error', (err) => {
      console.error('Rate limit Redis error:', err.message);
    });
    await redisClient.connect();
    console.log('Rate limit Redis connection established');

    // Recreate rate limiters with Redis store
    globalRateLimiter = createGlobalRateLimiter();
    authRateLimiter = createAuthRateLimiter();
    emailVerificationRateLimiter = createEmailVerificationRateLimiter();
    console.log('Rate limiters upgraded to Redis store');
  } catch (err) {
    console.error('Rate limit Redis connection failed, using memory store:', err.message);
    redisClient = null;
  }
}
