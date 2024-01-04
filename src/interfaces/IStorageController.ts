import { IRequest, IResponse, INext } from './IRequest';

export interface IStorageController {
  getProxyLibrary(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
}
