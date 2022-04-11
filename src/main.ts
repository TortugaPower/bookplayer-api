import 'reflect-metadata';
import { Envs } from './config/envs';

import { container } from './container';
import { TYPES } from './ContainerTypes';
import { IServer } from './interfaces/IServer';

const startApp = async () => {
  Envs();
  const server = container.get<IServer>(TYPES.Server);
  return server.run();
};

startApp();
