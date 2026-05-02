/**
 * UserPreferencesController
 *
 * HTTP handlers for `/v1/user/preferences` (GET / PATCH / DELETE).
 * All routes are gated by `auth` + `checkSubscription` at the router
 * level; controllers also defensively guard `req.user` and return 403
 * if it's missing (matches `UserController.deleteAccount` precedent).
 *
 * Status code mapping:
 *   200 — success
 *   403 — auth missing / `req.user` undefined
 *   422 — request body shape or validation rejected
 *   500 — unexpected internal error
 */
import { logger } from '../services/LoggerService';
import { UserPreferencesService } from '../services/UserPreferencesService';
import { IRequest, IResponse } from '../types/http';

export class UserPreferencesController {
  private readonly _logger = logger;

  constructor(
    private _prefsService: UserPreferencesService = new UserPreferencesService(),
  ) {}

  public async getPreferences(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      if (!user) {
        return res.status(403).json({ message: 'The user is invalid' });
      }

      const prefix =
        typeof req.query.prefix === 'string' ? req.query.prefix : undefined;

      const entries = await this._prefsService.getPreferences(
        user.id_user,
        prefix,
      );
      if (entries === null) {
        return res.status(500).json({ message: 'Internal error' });
      }

      return res.json({ entries });
    } catch (err) {
      this._logger.log(
        {
          origin: 'UserPreferencesController.getPreferences',
          message: err.message,
          data: { user: req.user?.id_user },
        },
        'error',
      );
      return res.status(500).json({ message: 'Internal error' });
    }
  }

  public async setPreferences(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      if (!user) {
        return res.status(403).json({ message: 'The user is invalid' });
      }

      const entries = req.body?.entries;
      if (!Array.isArray(entries)) {
        return res
          .status(422)
          .json({ message: 'entries must be an array' });
      }

      const result = await this._prefsService.upsertPreferences(
        user.id_user,
        entries,
      );
      if (result === null) {
        return res.status(422).json({ message: 'Invalid entries' });
      }

      return res.json({ success: true });
    } catch (err) {
      this._logger.log(
        {
          origin: 'UserPreferencesController.setPreferences',
          message: err.message,
          data: { user: req.user?.id_user },
        },
        'error',
      );
      return res.status(500).json({ message: 'Internal error' });
    }
  }

  public async deletePreferences(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const user = req.user;
      if (!user) {
        return res.status(403).json({ message: 'The user is invalid' });
      }

      const keys = req.body?.keys;
      if (!Array.isArray(keys)) {
        return res.status(422).json({ message: 'keys must be an array' });
      }

      const result = await this._prefsService.deletePreferences(
        user.id_user,
        keys,
      );
      if (result === null) {
        return res.status(422).json({ message: 'Invalid keys' });
      }

      return res.json({ success: true });
    } catch (err) {
      this._logger.log(
        {
          origin: 'UserPreferencesController.deletePreferences',
          message: err.message,
          data: { user: req.user?.id_user },
        },
        'error',
      );
      return res.status(500).json({ message: 'Internal error' });
    }
  }
}
