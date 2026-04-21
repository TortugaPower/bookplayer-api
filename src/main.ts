import { Envs } from './config/envs';
import { composeServer } from './composition';

const startApp = async () => {
  Envs();
  const server = composeServer();
  return server.run();
};

startApp();
