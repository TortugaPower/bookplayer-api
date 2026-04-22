import { Envs } from './config/envs';
Envs();

import { Server } from './server';

new Server().run();
