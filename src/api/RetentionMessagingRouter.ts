import express from 'express';
import { RetentionMessagingController } from '../controllers/RetentionMessagingController';

const RetentionMessagingRouter = express.Router();
const controller = new RetentionMessagingController();

// POST / - Handle Apple Retention Messaging API requests
// Note: This endpoint does not require user authentication
// as it's a server-to-server call from Apple
RetentionMessagingRouter.post('/', (req, res, next) =>
  controller.HandleRetentionRequest(req, res).catch(next),
);

export default RetentionMessagingRouter;
