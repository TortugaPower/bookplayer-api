import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import {
  createAnonymousTipBackstopLimiter,
  createAnonymousTipRateLimiter,
  getClientIp,
} from '../../api/middlewares/rateLimit';

function makeApp(limiter: express.RequestHandler) {
  const app = express();
  // Behind one load balancer, as in production (TRUST_PROXY_HOPS=1).
  app.set('trust proxy', 1);
  // Stands in for authMiddleware: a session when the test sends one.
  app.use((req, _res, next) => {
    if (req.headers['x-test-user']) {
      (req as any).user = { id_user: Number(req.headers['x-test-user']) };
    }
    next();
  });
  app.post('/tip', limiter, (_req, res) => res.json({ ok: true }));
  return app;
}

// The load balancer appends the caller's real address last.
const from = (app: express.Express, ip: string) =>
  request(app).post('/tip').set('X-Forwarded-For', `198.51.100.250, ${ip}`);

describe('signed-out tip limits', () => {
  it('per IP: one caller hitting the limit leaves other visitors able to tip', async () => {
    const app = makeApp(createAnonymousTipRateLimiter(2));

    expect((await from(app, '203.0.113.1')).status).toBe(200);
    expect((await from(app, '203.0.113.1')).status).toBe(200);
    const third = await from(app, '203.0.113.1');
    expect(third.status).toBe(429);
    expect(third.body.message).toMatch(/Too many tips/);
    expect((await from(app, '203.0.113.2')).status).toBe(200);
  });

  it('the backstop is shared by every signed-out tipper', async () => {
    const app = makeApp(createAnonymousTipBackstopLimiter(2));

    expect((await from(app, '203.0.113.1')).status).toBe(200);
    expect((await from(app, '203.0.113.2')).status).toBe(200);
    expect((await from(app, '203.0.113.3')).status).toBe(429);
  });

  it('signed-in tips are counted by neither', async () => {
    for (const limiter of [
      createAnonymousTipRateLimiter(1),
      createAnonymousTipBackstopLimiter(1),
    ]) {
      const app = makeApp(limiter);
      for (let i = 0; i < 3; i++) {
        const res = await from(app, '203.0.113.1').set('X-Test-User', '7');
        expect(res.status).toBe(200);
      }
    }
  });
});

describe('getClientIp', () => {
  function ipApp(trustProxyHops?: number) {
    const app = express();
    if (trustProxyHops) app.set('trust proxy', trustProxyHops);
    app.get('/ip', (req, res) => res.json({ ip: getClientIp(req as any) }));
    return app;
  }

  it('behind the load balancer, takes the address it appended, not the one the client wrote', async () => {
    const res = await request(ipApp(1))
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.7, 203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('without a trusted proxy, ignores X-Forwarded-For entirely', async () => {
    const res = await request(ipApp())
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.7');
    expect(res.body.ip).not.toBe('198.51.100.7');
    expect(res.body.ip).toMatch(/127\.0\.0\.1|::1/);
  });
});
