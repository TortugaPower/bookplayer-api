import { Container } from 'inversify';
import { TYPES } from './ContainerTypes';

import { Server } from './server';

import { UserRouter } from './api/UserRouter';
import { RouterHttp } from './api/RouterHttp';

import { UserController } from './controllers/UserController';

import { UserServices } from './services/UserServices';
import { SubscriptionController } from './controllers/SubscriptionController';
import { SubscriptionService } from './services/SubscriptionService';
import { RestClientService } from './services/RestClientService';
import { StorageService } from './services/StorageService';
import { LibraryService } from './services/LibraryService';
import { LibraryController } from './controllers/LibraryController';
import { LibraryRouter } from './api/LibraryRouter';
import { RedisService } from './services/RedisService';
import { SubscriptionMiddleware } from './api/middlewares/subscription';
import { LoggerService } from './services/LoggerService';
import { AdminService } from './services/AdminService';
import { AdminRouter } from './api/AdminRouter';
import { AdminController } from './controllers/AdminController';
import { UserAdminMiddleware } from './api/middlewares/admin';
import { S3Service } from './services/S3Service';
import { StorageRouter } from './api/StorageRouter';
import { StorageController } from './controllers/StorageController';
import { VersionMiddleware } from './api/middlewares/version';
import { EmailService } from './services/EmailService';
import { EmailVerificationService } from './services/EmailVerificationService';
import { PasskeyService } from './services/PasskeyService';
import { PasskeyController } from './controllers/PasskeyController';
import { PasskeyRouter } from './api/PasskeyRouter';
import { RetentionMessagingService } from './services/RetentionMessagingService';
import { RetentionMessagingController } from './controllers/RetentionMessagingController';
import { RetentionMessagingRouter } from './api/RetentionMessagingRouter';
import { GlacierMigrationService } from './services/GlacierMigrationService';

const container = new Container();

container.bind<Server>(TYPES.Server).to(Server).inSingletonScope();
container.bind<RouterHttp>(TYPES.RouterHttp).to(RouterHttp);
container.bind<UserRouter>(TYPES.UserRouter).to(UserRouter);

container.bind<UserServices>(TYPES.UserServices).to(UserServices);
container.bind<UserController>(TYPES.UserController).to(UserController);
container
  .bind<SubscriptionController>(TYPES.SubscriptionController)
  .to(SubscriptionController);
container
  .bind<SubscriptionService>(TYPES.SubscriptionService)
  .to(SubscriptionService);
container
  .bind<RestClientService>(TYPES.RestClientService)
  .to(RestClientService);
container.bind<StorageService>(TYPES.StorageService).to(StorageService);
container.bind<S3Service>(TYPES.S3Service).to(S3Service);
container.bind<LibraryService>(TYPES.LibraryService).to(LibraryService);
container
  .bind<LibraryController>(TYPES.LibraryController)
  .to(LibraryController);
container.bind<LibraryRouter>(TYPES.LibraryRouter).to(LibraryRouter);
container.bind<RedisService>(TYPES.CacheService).to(RedisService);
container.bind<LoggerService>(TYPES.LoggerService).to(LoggerService);
container
  .bind<SubscriptionMiddleware>(TYPES.SubscriptionMiddleware)
  .to(SubscriptionMiddleware);
container
  .bind<UserAdminMiddleware>(TYPES.UserAdminMiddleware)
  .to(UserAdminMiddleware);
container.bind<AdminService>(TYPES.AdminService).to(AdminService);
container.bind<AdminController>(TYPES.AdminController).to(AdminController);
container.bind<AdminRouter>(TYPES.AdminRouter).to(AdminRouter);
container.bind<StorageRouter>(TYPES.StorageRouter).to(StorageRouter);
container
  .bind<StorageController>(TYPES.StorageController)
  .to(StorageController);
container
  .bind<VersionMiddleware>(TYPES.VersionMiddleware)
  .to(VersionMiddleware);
container.bind<EmailService>(TYPES.EmailService).to(EmailService);
container
  .bind<EmailVerificationService>(TYPES.EmailVerificationService)
  .to(EmailVerificationService);
container.bind<PasskeyService>(TYPES.PasskeyService).to(PasskeyService);
container.bind<PasskeyController>(TYPES.PasskeyController).to(PasskeyController);
container.bind<PasskeyRouter>(TYPES.PasskeyRouter).to(PasskeyRouter);

// Retention Messaging (Apple)
container
  .bind<RetentionMessagingService>(TYPES.RetentionMessagingService)
  .to(RetentionMessagingService);
container
  .bind<RetentionMessagingController>(TYPES.RetentionMessagingController)
  .to(RetentionMessagingController);
container
  .bind<RetentionMessagingRouter>(TYPES.RetentionMessagingRouter)
  .to(RetentionMessagingRouter);

// Glacier Migration
container
  .bind<GlacierMigrationService>(TYPES.GlacierMigrationService)
  .to(GlacierMigrationService);

export { container };
