import { IRequest, IResponse, INext } from './IRequest';

export interface IUserController {
  InitLogin(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
  Logout(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
  getAuth(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
  DeleteAccount(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
  userEventsHandler(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  secondOnboarding(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
}
