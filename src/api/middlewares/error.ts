/* eslint-disable @typescript-eslint/no-unused-vars */
import { IRequest, IResponse, INext } from '../../types/http';
import { logger } from '../../services/LoggerService';

class HttpException extends Error {
  status: number;
  message: string;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.message = message;
  }
}

export const handleError = (
  error: HttpException,
  req: IRequest,
  res: IResponse,
  _next: INext,
) => {
  const status = error.status || 500;
  const message = error.message || 'Something went wrong';
  /// Uncaught errors reach here with no status (defaulted to 500). Log them —
  /// otherwise handlers that rely on `.catch(next)` (e.g. UserController) 500
  /// silently. Intentional 4xx HttpExceptions are left unlogged.
  if (status >= 500) {
    logger.log(
      {
        origin: 'handleError',
        message,
        data: { method: req.method, url: req.originalUrl, stack: error.stack },
      },
      'error',
    );
  }
  return res.status(status).send({
    status,
    message,
  });
};
