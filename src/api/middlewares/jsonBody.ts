import bodyParser from 'body-parser';
import { NextFunction, Request, Response } from 'express';

// Routes that parse their own JSON body, with a larger limit, once they've checked the
// caller: POST /v1/library/status carries every uuid in the client's library. Everything
// else keeps body-parser's 100 KB, so an unauthenticated request can't make the server
// buffer and parse a large body.
const OWN_BODY_ROUTES = new Set(['/v1/library/status']);

const defaultJsonBody = bodyParser.json();

export function jsonBody(req: Request, res: Response, next: NextFunction): void {
  // Matched the way Express routes: case-insensitive, trailing slash ignored. Otherwise a
  // spelling the route still accepts would be parsed here first, at 100 KB
  if (OWN_BODY_ROUTES.has(req.path.toLowerCase().replace(/\/+$/, ''))) {
    next();
    return;
  }
  defaultJsonBody(req, res, next);
}

// For those routes, after their subscription and tier checks: about 130k uuids at ~39 bytes each
export const largeJsonBody = bodyParser.json({ limit: '5mb' });
