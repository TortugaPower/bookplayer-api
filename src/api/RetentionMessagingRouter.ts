import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IRetentionMessagingController } from '../interfaces/IRetentionMessagingController';
import { IRetentionMessagingRouter } from '../interfaces/IRouters';

@injectable()
export class RetentionMessagingRouter implements IRetentionMessagingRouter {
  @inject(TYPES.RetentionMessagingController)
  private _controller: IRetentionMessagingController;

  get(): express.Router {
    const router = express.Router();

    // POST / - Handle Apple Retention Messaging API requests
    // Note: This endpoint does not require user authentication
    // as it's a server-to-server call from Apple
    router.post('/', (req, res, next) =>
      this._controller.HandleRetentionRequest(req, res, next).catch(next),
    );

    return router;
  }
}
