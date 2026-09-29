import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { jsonBody, largeJsonBody } from '../../api/middlewares/jsonBody';

// server.ts parses JSON with body-parser's 100 KB limit everywhere except the routes that
// parse their own larger body after checking the caller (POST /v1/library/status).
function makeApp() {
  const app = express();
  app.use(jsonBody);
  app.post('/v1/library/status', largeJsonBody, (req, res) => res.json({ count: req.body.uuids.length }));
  app.post('/v1/user/login', (req, res) => res.json({ keys: Object.keys(req.body) }));
  app.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({});
  });
  return app;
}

// ~1 MB: over the 100 KB default, well under 5 MB
const library = { uuids: Array.from({ length: 27_000 }, (_, i) => `2c2d0f44-1111-4111-8111-${`${i}`.padStart(12, '0')}`) };

describe('jsonBody', () => {
  it('lets the missing-items route parse a whole library', async () => {
    const res = await request(makeApp()).post('/v1/library/status').send(library);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 27_000 });
  });

  it('matches the route the way Express does: any case, trailing slash ignored', async () => {
    const res = await request(makeApp()).post('/V1/Library/Status/').send(library);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 27_000 });
  });

  it('keeps every other route at 100 KB', async () => {
    const res = await request(makeApp()).post('/v1/user/login').send(library);

    expect(res.status).toBe(413);
  });

  it('still parses small bodies everywhere else', async () => {
    const res = await request(makeApp()).post('/v1/user/login').send({ token_id: 'abc' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ keys: ['token_id'] });
  });
});
