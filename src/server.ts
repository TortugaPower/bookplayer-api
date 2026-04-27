import express from 'express';
import bodyParser from 'body-parser';
import compress from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import authMiddleware from './api/middlewares/auth';
import { globalRateLimiter, initRateLimitRedis } from './api/middlewares/rateLimit';
import { maintenanceMode } from './api/middlewares/maintenance';
import { createServer } from 'http';
import router from './api/RouterHttp';
import { handleError } from './api/middlewares/error';
import { RestClientService } from './services/RestClientService';
import { RedisService } from './services/RedisService';
import { logger } from './services/LoggerService';
import { checkVersion } from './api/middlewares/version';

export class Server {
  private readonly _logger = logger;

  constructor(
    private _restClient: RestClientService = new RestClientService(),
    private _cache: RedisService = new RedisService(),
  ) {}

  async run(): Promise<void> {
    // Initialize Redis for rate limiting and the shared cache before starting the server
    await initRateLimitRedis();
    await this._cache.connectCacheService();

    const app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(compress());
    app.use(helmet());
    app.use(maintenanceMode);
    app.use(globalRateLimiter);
    app.use(authMiddleware);
    app.use(checkVersion);
    app.use(
      cors({
        origin: true,
        credentials: true,
        exposedHeaders: ['Content-Range'],
      }),
    );

    app.use('/v1', router);
    app.use(handleError);
    this._restClient.setupClient();

    const httpServer = createServer(app);
    httpServer.listen(process.env.API_PORT || 5000, () => {
      this._logger.log({ origin: 'init app' });
    });
  }
}
