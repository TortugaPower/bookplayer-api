import { injectable, inject } from 'inversify';
import express from 'express';
import bodyParser from 'body-parser';
import compress from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import authMiddleware from './api/middlewares/auth';
import { createServer } from 'http';
import { IRouterHttp } from './interfaces/IRouters';
import { TYPES } from './ContainerTypes';
import { handleError } from './api/middlewares/error';
import { IRestClientService } from './interfaces/IRestClientService';
import { ISocketService } from './interfaces/ISocketService';
import { ICacheService } from './interfaces/ICacheService';

@injectable()
export class Server {
  @inject(TYPES.RouterHttp) private _authRouter: IRouterHttp;
  @inject(TYPES.RestClientService) private _restClient: IRestClientService;
  @inject(TYPES.SocketService) private _socketService: ISocketService;
  @inject(TYPES.CacheService) private _cacheService: ICacheService;
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
      }),
    );

    app.use('/v1', this._authRouter.get());
    app.use(handleError);

    this._restClient.setupClient();

    const httpServer = createServer(app);
    httpServer.listen(5000, () => {
      console.log('todo proper logger');
      this._cacheService.connectCacheService();
      this._socketService.setupClient(httpServer);
    });
  }
}
