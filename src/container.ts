import { Container } from 'inversify';
import { TYPES } from './ContainerTypes';

import { IServer } from './interfaces/IServer';
import { Server } from './server';

import { UserRouter } from './api/UserRouter';
import { RouterHttp } from './api/RouterHttp';

import { IUserController } from './interfaces/IUserController';
import { UserController } from './controllers/UserController';

import { UserServices } from './services/UserServices';
import { IUserService } from './interfaces/IUserService';
import {
  IUserRouter,
  IRouterHttp,
  ILibraryRouter,
  IAdminRouter,
} from './interfaces/IRouters';
import { SubscriptionController } from './controllers/SubscriptionController';
import { ISubscriptionController } from './interfaces/ISubscriptionController';
import { SubscriptionService } from './services/SubscriptionService';
import { ISubscriptionService } from './interfaces/ISubscriptionService';
import { IRestClientService } from './interfaces/IRestClientService';
import { RestClientService } from './services/RestClientService';
import { IStorageService } from './interfaces/IStorageService';
import { StorageService } from './services/StorageService';
import { ILibraryService } from './interfaces/ILibraryService';
import { LibraryService } from './services/LibraryService';
import { ILibraryController } from './interfaces/ILibraryController';
import { LibraryController } from './controllers/LibraryController';
import { LibraryRouter } from './api/LibraryRouter';
import { SocketService } from './services/SocketServer';
import { ISocketService } from './interfaces/ISocketService';
import { RedisService } from './services/RedisService';
import { ICacheService } from './interfaces/ICacheService';
import { ISubscriptionMiddleware } from './interfaces/ISubscriptionMiddleware';
import { SubscriptionMiddleware } from './api/middlewares/subscription';
import { ILoggerService } from './interfaces/ILoggerService';
import { LoggerService } from './services/LoggerService';
import { IAdminService } from './interfaces/IAdminService';
import { AdminService } from './services/AdminService';
import { AdminRouter } from './api/AdminRouter';
import { IAdminController } from './interfaces/IAdminController';
import { AdminController } from './controllers/AdminController';

const container = new Container();

container.bind<IServer>(TYPES.Server).to(Server).inSingletonScope();
container.bind<IRouterHttp>(TYPES.RouterHttp).to(RouterHttp);
container.bind<IUserRouter>(TYPES.UserRouter).to(UserRouter);

container.bind<IUserService>(TYPES.UserServices).to(UserServices);
container.bind<IUserController>(TYPES.UserController).to(UserController);
container
  .bind<ISubscriptionController>(TYPES.SubscriptionController)
  .to(SubscriptionController);
container
  .bind<ISubscriptionService>(TYPES.SubscriptionService)
  .to(SubscriptionService);
container
  .bind<IRestClientService>(TYPES.RestClientService)
  .to(RestClientService);
container.bind<IStorageService>(TYPES.StorageService).to(StorageService);
container.bind<ILibraryService>(TYPES.LibraryService).to(LibraryService);
container
  .bind<ILibraryController>(TYPES.LibraryController)
  .to(LibraryController);
container.bind<ILibraryRouter>(TYPES.LibraryRouter).to(LibraryRouter);
container.bind<ISocketService>(TYPES.SocketService).to(SocketService);
container.bind<ICacheService>(TYPES.CacheService).to(RedisService);
container.bind<ILoggerService>(TYPES.LoggerService).to(LoggerService);
container
  .bind<ISubscriptionMiddleware>(TYPES.SubscriptionMiddleware)
  .to(SubscriptionMiddleware);
container.bind<IAdminService>(TYPES.AdminService).to(AdminService);
container.bind<IAdminController>(TYPES.AdminController).to(AdminController);
container.bind<IAdminRouter>(TYPES.AdminRouter).to(AdminRouter);
export { container };
