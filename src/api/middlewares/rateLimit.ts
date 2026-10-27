import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { IRequest, IResponse } from '../../types/http';

let redisClient: ReturnType<typeof createClient> | null = null;

// The client's address, as Express resolves it under `trust proxy` (see
// server.ts). Never the first X-Forwarded-For entry: the client writes that
// one, and rewriting it per request would give each request a fresh limit.
export function getClientIp(req: IRequest): string {
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
// Stripe account paying users also check out on. Signed-out tips get two
// limits on top of billingRateLimiter: a low one per IP (getClientIp, which a
// caller can't forge), and a higher one shared by every signed-out tipper, a
// backstop for many addresses at once. Signed-in tips skip both and keep the
// per-account limit.
function createAnonymousTipLimiter(
  scope: 'ip' | 'all',
  max: number,
): RateLimitRequestHandler {
  return rateLimit({
    ...baseOptions,
    windowMs: 60 * 1000,
    max,
    store: createRedisStore(`tip_anonymous_${scope}`),
    keyGenerator: (req: IRequest) =>
      scope === 'ip' ? `anon:${getClientIp(req)}` : 'anonymous',
    skip: (req: IRequest) => Boolean(req.user?.id_user),
    handler: (_req: IRequest, res: IResponse) => {
      res.status(429).json({
        message: 'Too many tips right now, please try again in a minute.',
      });
    },
  });
}

export const createAnonymousTipRateLimiter = (max = 5) =>
  createAnonymousTipLimiter('ip', max);
export const createAnonymousTipBackstopLimiter = (max = 60) =>
  createAnonymousTipLimiter('all', max);

// Rate limiters - initialized with memory store, upgraded to Redis if available
export let globalRateLimiter: RateLimitRequestHandler = createGlobalRateLimiter();
export let authRateLimiter: RateLimitRequestHandler = createAuthRateLimiter();
export let emailVerificationRateLimiter: RateLimitRequestHandler = createEmailVerificationRateLimiter();
export let billingRateLimiter: RateLimitRequestHandler = createBillingRateLimiter();
export let anonymousTipRateLimiter: RateLimitRequestHandler = createAnonymousTipRateLimiter();
export let anonymousTipBackstopLimiter: RateLimitRequestHandler = createAnonymousTipBackstopLimiter();

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
    anonymousTipBackstopLimiter = createAnonymousTipBackstopLimiter();
    console.log('Rate limiters upgraded to Redis store');
  } catch (err) {
    console.error('Rate limit Redis connection failed, using memory store:', err.message);
    redisClient = null;
  }
}
