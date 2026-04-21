import { LoggerService } from './services/LoggerService';
import { RestClientService } from './services/RestClientService';
import { AdminService } from './services/AdminService';
import { EmailService } from './services/EmailService';
import { PasskeyService } from './services/PasskeyService';
import { RedisService } from './services/RedisService';
import { RetentionMessagingService } from './services/RetentionMessagingService';
import { S3Service } from './services/S3Service';
import { UserServices } from './services/UserServices';
import { StorageService } from './services/StorageService';
import { GlacierMigrationService } from './services/GlacierMigrationService';
import { SubscriptionService } from './services/SubscriptionService';
import { LibraryService } from './services/LibraryService';
import { EmailVerificationService } from './services/EmailVerificationService';
import { UserAdminMiddleware } from './api/middlewares/admin';
import { SubscriptionMiddleware } from './api/middlewares/subscription';
import { VersionMiddleware } from './api/middlewares/version';
import { AdminController } from './controllers/AdminController';
import { LibraryController } from './controllers/LibraryController';
import { PasskeyController } from './controllers/PasskeyController';
import { RetentionMessagingController } from './controllers/RetentionMessagingController';
import { StorageController } from './controllers/StorageController';
import { SubscriptionController } from './controllers/SubscriptionController';
import { UserController } from './controllers/UserController';
import { UserRouter } from './api/UserRouter';
import { LibraryRouter } from './api/LibraryRouter';
import { AdminRouter } from './api/AdminRouter';
import { StorageRouter } from './api/StorageRouter';
import { PasskeyRouter } from './api/PasskeyRouter';
import { RetentionMessagingRouter } from './api/RetentionMessagingRouter';
import { RouterHttp } from './api/RouterHttp';
import { Server } from './server';

export function composeServer(): Server {
  // T0 — leaves
  const logger = new LoggerService();
  const restClient = new RestClientService();

  // T1
  const redis = new RedisService(logger);
  const userServices = new UserServices(logger);
  const adminService = new AdminService(logger);
  const emailService = new EmailService(logger);
  const passkeyService = new PasskeyService(logger);
  const retentionService = new RetentionMessagingService(logger);
  const s3 = new S3Service(logger);

  // T2
  const storageService = new StorageService(logger, s3);
  const glacierService = new GlacierMigrationService(s3, logger, restClient);
  const subscriptionService = new SubscriptionService(
    restClient,
    userServices,
    logger,
    emailService,
  );

  // T3
  const libraryService = new LibraryService(storageService, logger);
  const emailVerificationService = new EmailVerificationService(
    logger,
    emailService,
    userServices,
  );
  const userAdminMiddleware = new UserAdminMiddleware(userServices);
  const subscriptionMiddleware = new SubscriptionMiddleware(userServices);
  const versionMiddleware = new VersionMiddleware(userServices, redis);

  // T4 — controllers
  const adminController = new AdminController(adminService, storageService, logger);
  const libraryController = new LibraryController(libraryService, logger);
  const passkeyController = new PasskeyController(
    passkeyService,
    emailVerificationService,
    logger,
  );
  const retentionController = new RetentionMessagingController(retentionService, logger);
  const storageController = new StorageController(storageService, libraryService, logger);
  const subscriptionController = new SubscriptionController(
    subscriptionService,
    logger,
    glacierService,
  );
  const userController = new UserController(userServices, subscriptionService);

  // T5 — routers
  const userRouter = new UserRouter(userController, subscriptionController);
  const libraryRouter = new LibraryRouter(libraryController, subscriptionMiddleware);
  const adminRouter = new AdminRouter(adminController, userAdminMiddleware);
  const storageRouter = new StorageRouter(storageController, subscriptionMiddleware);
  const passkeyRouter = new PasskeyRouter(passkeyController);
  const retentionRouter = new RetentionMessagingRouter(retentionController);

  // T6
  const routerHttp = new RouterHttp(
    userRouter,
    libraryRouter,
    adminRouter,
    storageRouter,
    passkeyRouter,
    retentionRouter,
  );

  // T7 — root
  return new Server(routerHttp, restClient, logger, versionMiddleware);
}
