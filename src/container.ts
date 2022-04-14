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
import { IUserRouter, IRouterHttp } from './interfaces/IRouters';
import { SubscriptionController } from './controllers/SubscriptionController';
import { ISubscriptionController } from './interfaces/ISubscriptionController';
import { SubscriptionService } from './services/SubscriptionService';
import { ISubscriptionService } from './interfaces/ISubscriptionService';
import { IRestClientService } from './interfaces/IRestClientService';
import { RestClientService } from './services/RestClientService';

const container = new Container();

container.bind<IServer>(TYPES.Server).to(Server).inSingletonScope();
container.bind<IRouterHttp>(TYPES.RouterHttp).to(RouterHttp);
container.bind<IUserRouter>(TYPES.UserRouter).to(UserRouter);

container.bind<IUserService>(TYPES.UserServices).to(UserServices);
container.bind<IUserController>(TYPES.UserController).to(UserController);
container.bind<ISubscriptionController>(TYPES.SubscriptionController).to(SubscriptionController);
container.bind<ISubscriptionService>(TYPES.SubscriptionService).to(SubscriptionService);
container.bind<IRestClientService>(TYPES.RestClientService).to(RestClientService);

export { container };
