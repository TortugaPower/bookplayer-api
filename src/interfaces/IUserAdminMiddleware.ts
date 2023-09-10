import { INext, IRequest, IResponse } from './IRequest';

export interface IUserAdminMiddleware {
  checkUserAdmin(req: IRequest, res: IResponse, _: INext): Promise<void>;
}
