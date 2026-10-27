import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import {
  createAnonymousTipRateLimiter,
  getClientIp,
} from '../../api/middlewares/rateLimit';

function makeApp() {
  const app = express();
  // Stands in for authMiddleware: a session when the test sends one.
  app.use((req, _res, next) => {
    if (req.headers['x-test-user']) {
      (req as any).user = { id_user: Number(req.headers['x-test-user']) };
    }
    next();
  });
  app.post('/tip', createAnonymousTipRateLimiter(2), (_req, res) =>
    res.json({ ok: true }),
  );
  return app;
}

describe('createAnonymousTipRateLimiter', () => {
  it('signed-out tips share one bucket, whatever X-Forwarded-For says', async () => {
    const app = makeApp();
    const tip = (ip: string) =>
      request(app).post('/tip').set('X-Forwarded-For', ip);

    expect((await tip('203.0.113.1')).status).toBe(200);
    expect((await tip('203.0.113.2')).status).toBe(200);
    const third = await tip('203.0.113.3');
    expect(third.status).toBe(429);
    expect(third.body.message).toMatch(/Too many tips/);
  });

  it('signed-in tips are not counted against it', async () => {
    const app = makeApp();
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/tip').set('X-Test-User', '7');
      expect(res.status).toBe(200);
    }
    expect((await request(app).post('/tip')).status).toBe(200);
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
