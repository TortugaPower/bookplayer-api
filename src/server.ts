import express from 'express';
import bodyParser from 'body-parser';
import compress from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import authMiddleware from './api/middlewares/auth';
import { globalRateLimiter, initRateLimitRedis } from './api/middlewares/rateLimit';
import { maintenanceMode } from './api/middlewares/maintenance';
import { createServer } from 'http';
import { RouterHttp } from './api/RouterHttp';
import { handleError } from './api/middlewares/error';
import { RestClientService } from './services/RestClientService';
import { LoggerService } from './services/LoggerService';
import { VersionMiddleware } from './api/middlewares/version';
import { IResponse, IRequest, INext } from './types/http';

export class Server {
  constructor(
    private _authRouter: RouterHttp,
    private _restClient: RestClientService,
    private _logger: LoggerService,
    private version: VersionMiddleware,
  ) {}
  async run(): Promise<void> {
    // Initialize Redis for rate limiting before starting the server
    await initRateLimitRedis();

    const app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(compress());
    app.use(helmet());
    app.use(maintenanceMode);
    app.use(globalRateLimiter);
    app.use(authMiddleware);
    app.use((req: IResponse, res: IRequest, next: INext) => {
      return this.version.checkVersion(req, res, next);
    });
    app.use(
      cors({
        origin: true,
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
