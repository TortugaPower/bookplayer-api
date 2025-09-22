/* eslint-disable @typescript-eslint/no-unused-vars */
import { IRequest, IResponse, INext } from '../../interfaces/IRequest';

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
  _req: IResponse,
  res: IRequest,
  _next: INext,
) => {
  const status = error.status || 500;
  const message = error.message || 'Something went wrong';
  return res.status(status).send({
    status,
    message,
  });
};
