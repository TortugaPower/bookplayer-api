import { ZodTypeAny } from 'zod';
import { IRequest, IResponse, INext } from '../types/http';

// Route-level body-validation middleware. Mount it after the auth/subscription
// middlewares and before the controller, alongside `checkSubscription` etc.:
//
//   Router.put('/external', checkSubscription, validateBody(schema), handler)
//
// On failure it responds 422 with the first issue's message (matching the
// codebase's `{ message }` convention) and does not call the handler. On
// success it overwrites `req.body` with the parsed/coerced data — defaults
// applied, unknown keys stripped — so the controller can trust its shape.
export const validateBody =
  (schema: ZodTypeAny) =>
  (req: IRequest, res: IResponse, next: INext): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(422).json({ message: issue?.message ?? 'Invalid request body' });
      return;
    }
    req.body = parsed.data;
    next();
  };
