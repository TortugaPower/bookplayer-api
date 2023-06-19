import { IRequest, IResponse, INext } from './IRequest';

export interface IAdminController {
  SetUserUsage(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
}
