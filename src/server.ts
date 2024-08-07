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
import { ILoggerService } from './interfaces/ILoggerService';
import { IVersionMiddleware } from './interfaces/IVersionMiddleware';
import { IResponse, IRequest, INext } from './interfaces/IRequest';

@injectable()
export class Server {
  @inject(TYPES.RouterHttp) private _authRouter: IRouterHttp;
  @inject(TYPES.RestClientService) private _restClient: IRestClientService;
  @inject(TYPES.LoggerService) private _logger: ILoggerService;
  @inject(TYPES.VersionMiddleware) private version: IVersionMiddleware;
  run(): void {
    const app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(compress());
    app.use(helmet());
    app.use(authMiddleware);
    app.use((req: IResponse, res: IRequest, next: INext) => {
      return this.version.checkVersion(req, res, next);
    });
    app.use(
      cors({
        credentials: true,
        exposedHeaders: ['Content-Range'],
      }),
    );

    app.use('/v1', this._authRouter.get());
    app.use(handleError);
    this._restClient.setupClient();

    const httpServer = createServer(app);
    httpServer.listen(process.env.API_PORT || 5000, () => {
      this._logger.log({ origin: 'init app' });
    });
  }
}
