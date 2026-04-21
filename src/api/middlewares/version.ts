import { IRequest, IResponse, INext } from '../../types/http';
import { UserServices } from '../../services/UserServices';
import { RedisService } from '../../services/RedisService';

export class VersionMiddleware {
  constructor(
    private _userService: UserServices,
    public _cacheService: RedisService,
  ) {}
  async checkVersion(
    req: IResponse,
    res: IRequest,
    next: INext,
  ): Promise<void> {
    try {
      const requestAppVersion = req.headers['accept-version']?.trim();
      const dateFormat = /^\d{4}-\d{2}-\d{2}$/;
      if (
        requestAppVersion?.length &&
        requestAppVersion !== 'latest' &&
        !dateFormat.test(requestAppVersion)
      ) {
        return res
          .status(400)
          .json({ message: 'Invalid format of accept-version' });
      } else if (!requestAppVersion && req.headers.origin?.length) {
        const origin = req.headers.origin
          .replace('https://', '')
          .replace('http://', '');
        const cacheKey = `domain_app_version_${origin}`;
        let appVersion = (await this._cacheService.getObject(cacheKey)) as {
          version: string;
        };
        if (!appVersion) {
          const client_domain = await this._userService.getClientID({
            origin: origin,
          });
          if (!client_domain) {
            return res.status(403).json({
              message: 'Your domain is not registered to use our API',
            });
          }
          appVersion = {
            version: client_domain.app_version,
          };
          await this._cacheService.setObject(cacheKey, appVersion);
        }
        req.app_version = appVersion.version;
      } else {
        req.app_version = requestAppVersion;
      }
      next();
    } catch (error) {
      next(error);
    }
  }
}
