import express from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import type { RetentionMessagingController } from '../controllers/RetentionMessagingController';

@injectable()
export class RetentionMessagingRouter {
  @inject(TYPES.RetentionMessagingController)
  private _controller: RetentionMessagingController;

  get(): express.Router {
    const router = express.Router();

    // POST / - Handle Apple Retention Messaging API requests
    // Note: This endpoint does not require user authentication
    // as it's a server-to-server call from Apple
    router.post('/', (req, res, next) =>
      this._controller.HandleRetentionRequest(req, res).catch(next),
    );

    return router;
  }
}
