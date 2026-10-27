import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createAnonymousTipRateLimiter } from '../../api/middlewares/rateLimit';

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
