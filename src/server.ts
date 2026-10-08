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
import { jsonBody } from './api/middlewares/jsonBody';

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
    // 100 KB, except the routes that parse their own larger body after their
    // subscription check (POST /v1/library/status)
    app.use(jsonBody);
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
        // Lets the web app's browser reuse a preflight for the same URL instead
        // of repeating it (the default is 5s). 2h is Chrome's cap, and bounds how
        // long a domain removed from apple_clients keeps working in a browser.
        maxAge: 7200,
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
