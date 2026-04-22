import express from 'express';
import { StorageController } from '../controllers/StorageController';
import { checkSubscription } from './middlewares/subscription';

const StorageRouter = express.Router();
const controller = new StorageController();

StorageRouter.get('/*', checkSubscription, (req, res, next) =>
  controller.getProxyLibrary(req, res).catch(next),
);

export default StorageRouter;
