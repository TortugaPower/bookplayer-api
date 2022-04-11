import { IRequest, IResponse, INext } from './IRequest';

export interface IUserController {
  InitLogin(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
  getAuth(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
}
