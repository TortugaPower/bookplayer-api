import { IRequest, IResponse, INext } from './IRequest';

export interface IRetentionMessagingController {
  HandleRetentionRequest(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
}
