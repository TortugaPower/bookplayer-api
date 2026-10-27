import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { IRequest, IResponse } from '../../types/http';

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

// Billing session routes call Stripe (and can move money): 10 a minute per
// account, or per IP for a request without one.
function createBillingRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    ...baseOptions,
    windowMs: 60 * 1000,
    max: 10,
    store: createRedisStore('billing'),
    keyGenerator: (req: IRequest) =>
      req.user?.id_user ? `user:${req.user.id_user}` : getClientIp(req),
    handler: (_req: IRequest, res: IResponse) => {
      res.status(429).json({
        message: 'Too many billing requests, please try again later.',
      });
    },
  });
}

// Tips need no account, and each one creates a Stripe Checkout Session on the
// Stripe account paying users also check out on. Signed-out tips share ONE
// bucket instead of one per IP: the IP comes from X-Forwarded-For, which a
// caller can rewrite on every request, so a per-IP key could be sidestepped.
// Signed-in tips skip it and keep billingRateLimiter's per-account limit.
export function createAnonymousTipRateLimiter(
  max = 20,
): RateLimitRequestHandler {
  return rateLimit({
    ...baseOptions,
    windowMs: 60 * 1000,
    max,
    store: createRedisStore('tip_anonymous'),
    keyGenerator: () => 'anonymous',
    skip: (req: IRequest) => Boolean(req.user?.id_user),
    handler: (_req: IRequest, res: IResponse) => {
      res.status(429).json({
        message: 'Too many tips right now, please try again in a minute.',
      });
    },
  });
}

// Rate limiters - initialized with memory store, upgraded to Redis if available
export let globalRateLimiter: RateLimitRequestHandler = createGlobalRateLimiter();
export let authRateLimiter: RateLimitRequestHandler = createAuthRateLimiter();
export let emailVerificationRateLimiter: RateLimitRequestHandler = createEmailVerificationRateLimiter();
export let billingRateLimiter: RateLimitRequestHandler = createBillingRateLimiter();
export let anonymousTipRateLimiter: RateLimitRequestHandler = createAnonymousTipRateLimiter();

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
    billingRateLimiter = createBillingRateLimiter();
    anonymousTipRateLimiter = createAnonymousTipRateLimiter();
    console.log('Rate limiters upgraded to Redis store');
  } catch (err) {
    console.error('Rate limit Redis connection failed, using memory store:', err.message);
    redisClient = null;
  }
}
