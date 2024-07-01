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
  IStorageRouter,
} from './interfaces/IRouters';
import { SubscriptionController } from './controllers/SubscriptionController';
import { ISubscriptionController } from './interfaces/ISubscriptionController';
import { SubscriptionService } from './services/SubscriptionService';
import { ISubscriptionService } from './interfaces/ISubscriptionService';
import { IRestClientService } from './interfaces/IRestClientService';
import { RestClientService } from './services/RestClientService';
import { IStorageService } from './interfaces/IStorageService';
import { StorageService } from './services/StorageService';
import {
  ILibraryService,
  ILibraryServiceDeprecated,
} from './interfaces/ILibraryService';
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
import { IUserAdminMiddleware } from './interfaces/IUserAdminMiddleware';
import { UserAdminMiddleware } from './api/middlewares/admin';
import { S3Service } from './services/S3Service';
import { IS3Service } from './interfaces/IS3Service';
import { StorageRouter } from './api/StorageRouter';
import { StorageController } from './controllers/StorageController';
import { IStorageController } from './interfaces/IStorageController';
import { IVersionMiddleware } from './interfaces/IVersionMiddleware';
import { VersionMiddleware } from './api/middlewares/version';
import { LibraryServiceDeprecated } from './services/LibraryServiceDeprecated';
import { IEmailService } from './interfaces/IEmailService';
import { EmailService } from './services/EmailService';

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
container.bind<IS3Service>(TYPES.S3Service).to(S3Service);
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
container
  .bind<IUserAdminMiddleware>(TYPES.UserAdminMiddleware)
  .to(UserAdminMiddleware);
container.bind<IAdminService>(TYPES.AdminService).to(AdminService);
container.bind<IAdminController>(TYPES.AdminController).to(AdminController);
container.bind<IAdminRouter>(TYPES.AdminRouter).to(AdminRouter);
container.bind<IStorageRouter>(TYPES.StorageRouter).to(StorageRouter);
container
  .bind<IStorageController>(TYPES.StorageController)
  .to(StorageController);
container
  .bind<IVersionMiddleware>(TYPES.VersionMiddleware)
  .to(VersionMiddleware);
container.bind<IEmailService>(TYPES.EmailService).to(EmailService);

// deprecated use for migration
container
  .bind<ILibraryServiceDeprecated>(TYPES.LibraryServiceDeprecated)
  .to(LibraryServiceDeprecated);
export { container };
