import { INext, IRequest, IResponse } from './IRequest';

export interface IVersionMiddleware {
  checkVersion(req: IRequest, res: IResponse, _: INext): Promise<void>;
}
