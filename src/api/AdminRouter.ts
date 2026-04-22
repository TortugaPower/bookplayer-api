import express from 'express';
import { AdminController } from '../controllers/AdminController';
import { checkUserAdmin } from './middlewares/admin';

const AdminRouter = express.Router();
const controller = new AdminController();

AdminRouter.get('/users_usage', checkUserAdmin, (req, res, next) =>
  controller.SetUserUsage(req, res).catch(next),
);
AdminRouter.get('/validate_sync', checkUserAdmin, (req, res, next) =>
  controller.validateSyncBooks(req, res).catch(next),
);

export default AdminRouter;
