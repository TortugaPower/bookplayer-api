import 'reflect-metadata';
import { Envs } from './config/envs';

import { container } from './container';
import { TYPES } from './ContainerTypes';
import { Server } from './server';

const startApp = async () => {
  Envs();
  const server = container.get<Server>(TYPES.Server);
  return server.run();
};

startApp();
