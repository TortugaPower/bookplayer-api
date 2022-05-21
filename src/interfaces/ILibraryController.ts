
import { IRequest, IResponse, INext } from './IRequest';

export interface ILibraryController {
  getLibraryContentPath(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
}
