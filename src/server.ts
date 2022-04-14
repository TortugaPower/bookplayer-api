import { injectable, inject } from 'inversify';
import express from 'express';
import bodyParser from 'body-parser';
import compress from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import authMiddleware from './api/middlewares/auth';

import { IRouterHttp } from './interfaces/IRouters';
import { TYPES } from './ContainerTypes';
import { handleError } from './api/middlewares/error';
import { IRestClientService } from './interfaces/IRestClientService';

@injectable()
export class Server {
  @inject(TYPES.RouterHttp) private _authRouter: IRouterHttp;
  @inject(TYPES.RestClientService) private _restClient: IRestClientService;
  run(): void {
    const app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(compress());
    app.use(helmet());
    app.use(helmet());
    app.use(authMiddleware);
    app.use(
      cors({
        credentials: true,
        origin: 'http://localhost:3000',
      }),
    );

    app.use('/v1', this._authRouter.get());
    app.use(handleError);

    this._restClient.setupClient();

    app.listen(5000, () => {
      console.log('todo proper logger');
    });
    
  }
}
