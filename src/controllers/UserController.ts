import { UserServices } from '../services/UserServices';
import { IRequest, IResponse } from '../types/http';
import cookie from 'cookie';
import { UserEventEnum } from '../types/user';
import moment from 'moment-timezone';
import { SubscriptionService } from '../services/SubscriptionService';
import { gte } from 'semver';

export class UserController {
  constructor(
    private _userService: UserServices = new UserServices(),
    private _subscriptionService: SubscriptionService = new SubscriptionService(),
  ) {}

  private readonly minVersion = '5.6.0';

  public async getAuth(req: IRequest, res: IResponse): Promise<IResponse> {
    const user = req.user;
    res.json({ user, message: !user ? 'login' : 'dashboard' });
    return;
  }

  public async initLogin(req: IRequest, res: IResponse): Promise<IResponse | undefined> {
    const { token_id } = req.body;
    const { origin, 'x-platform': platform } = req.headers;
    if (!token_id) {
      res.status(422).json({ message: 'The authentication is missing' });
      return;
    }

    let client_id: {
      apple_id: string;
    } = null;

    if (origin) {
      client_id = await this._userService.getClientID({
        origin: origin.replace('https://', '').replace('http://', ''),
      });
      if (!client_id) {
        res
          .status(422)
          .json({ message: 'Your domain is not registered to use our API' });
        return;
      }
    }

    let authData: {
      auth_type: string;
      external_id: string;
      email: string;
    };

    if (platform === 'android') {
      const googleAuth = await this._userService.verifyGoogleToken(token_id);
      if (!googleAuth.success || !googleAuth.user.email) {
        res.status(422).json({ message: 'Invalid google id' });
        return;
      }

      authData = {
        auth_type: 'google',
        external_id: googleAuth.user.userId,
        email: googleAuth.user.email,
      };
    } else {
      const appleAuth = await this._userService.verifyToken({
        token_id,
        client_id: client_id?.apple_id,
      });

      if (!appleAuth?.email || !appleAuth?.sub) {
        res.status(422).json({ message: 'Invalid apple id' });
        return;
      }

      authData = {
        auth_type: 'apple',
        external_id: appleAuth.sub,
        email: appleAuth.email,
      };
    }

    // Look up the credential by its provider + stable external id (the Apple
    // `sub` / Google `sub`), which is collision-safe unlike matching on email.
    const existingAuthMethod = await this._userService.getAuthMethodByExternalId({
      auth_type: authData.auth_type,
      external_id: authData.external_id,
    });

    let user;

    if (existingAuthMethod) {
      // Existing user - fetch by stored email (safe from collision)
      user = await this._userService.getUser({
        email: existingAuthMethod.email,
        session: authData.external_id,
      });
    } else {
      // No auth_method for this credential yet. Either the user is brand new,
      // or they already own an account (under a different provider) and we are
      // linking this credential to it.
      let existingUser = await this._userService.getUser({
        email: authData.email,
      });

      user = existingUser || await this._userService.addNewUser({
        email: authData.email,
        active: true,
        external_id: authData.external_id,
      });

      // Record the credential under its own provider. Mark it primary only when
      // it's the first credential of a freshly created account; a credential
      // linked to a pre-existing account is secondary.
      if (user && user.id_user) {
        await this._userService.addAuthMethod({
          user_id: user.id_user,
          auth_type: authData.auth_type,
          external_id: authData.external_id,
          is_primary: !existingUser,
        });
      }
    }

    if (!user) {
      res.status(500).json({ message: 'Failed to create or find user' });
      return;
    }

    if (!user.session) {
      await this._userService.addNewDevice({
        user_id: user.id_user,
        session: authData.external_id,
      });
    }

    const token = await this._userService.tokenUser({
      id_user: user.id_user,
      email: authData.email,
      external_id: user.external_id,
      session: authData.external_id,
    });

    if (
      !!client_id &&
      client_id.apple_id !== 'com.tortugapower.audiobookplayer.watchkitapp'
    ) {
      // is from web enable 2 weeks
      const isProd = process.env.NODE_ENV === 'production';
      res.setHeader(
        'Set-Cookie',
        cookie.serialize(process.env.SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          maxAge: 60 * 60 * 24 * 7 * 2,
          sameSite: isProd ? 'none' : null,
          secure: isProd,
          path: '/',
        }),
      );
      return res.json({ email: user.email, token, revenuecat_id: user.external_id });
    }
    return res.json({ email: user.email, token, revenuecat_id: user.external_id });
  }

  public async logout(req: IRequest, res: IResponse): Promise<IResponse> {
    await res.clearCookie(process.env.SESSION_COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      sameSite: 'none',
      secure: true,
    });
    return res.send({
      logout: true,
    });
  }

  public async deleteAccount(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    const user = req.user;
    if (!user) {
      res.status(403).json({ message: 'The user is invalid' });
      return;
    }
    const deleted = await this._userService.deleteAccount(
      user.id_user,
      user.external_id,
    );
    if (!deleted) {
      res
        .status(400)
        .json({ message: 'There is a problem deleting the account' });
      return;
    }
    return res.json({ message: 'The account has been successfully deleted' });
  }

  public async secondOnboarding(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    const { rc_id, region, app_version } = req.body;

    if (rc_id == null) {
      return res.json({});
    }

    const isVersionSupported = gte(app_version, this.minVersion);

    /// Only allow AUS, ESP, PHL, MEX, RUS region for tip only onboarding
    if (
      ['AUS', 'ESP', 'PHL', 'MEX', 'RUS'].includes(region) &&
      isVersionSupported
    ) {
      return this.handleTipOnlyOnboarding(req, res);
    }

    /// Only allow USA, GBR, CAN, DEU regions for default onboarding
    if (['USA', 'GBR', 'CAN', 'DEU'].includes(region)) {
      return this.handleDefaultOnboarding(req, res);
    }

    return res.json({});
  }

  private async handleDefaultOnboarding(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    const { rc_id, first_seen, region, onboarding_name, app_version } =
      req.body;

    const diffdays = moment().diff(moment.unix(first_seen), 'days');

    /// If user hasn't used the app for at least 7 days do nothing
    if (diffdays < 7) {
      return res.json({});
    }

    const lastSkipEvent = await this._userService.getLastUserEvent({
      event_name: UserEventEnum.SECOND_ONBOARDING_SKIP,
      external_id: rc_id,
    });

    /// If the user has skipped and it hasn't been 6 months yet do nothing
    if (lastSkipEvent != null && diffdays < 180) {
      return res.json({});
    }

    let onboarding: string;

    if (lastSkipEvent == null) {
      const lastEvent = await this._userService.getLastUserEvent({
        event_name: UserEventEnum.SECOND_ONBOARDING_START,
        external_id: rc_id,
      });

      if (
        !lastEvent ||
        moment(lastEvent.created_at).isBefore(moment().subtract(7, 'days'))
      ) {
        switch (region) {
          case 'USA':
          case 'GBR':
            onboarding = 'first_seen';
            break;
          case 'CAN':
            onboarding = 'first_seen_no_slider';
            break;
          case 'DEU':
            onboarding = 'first_seen_germanny';
            break;
          default:
            onboarding = onboarding_name;
            break;
        }
      }
    } else if (
      (region === 'USA' ||
        region === 'GBR' ||
        region === 'CAN' ||
        region === 'DEU') &&
      diffdays >= 180 &&
      moment(lastSkipEvent.created_at).isBefore(moment().subtract(7, 'days'))
    ) {
      const lastEvent = await this._userService.getLastUserEvent({
        event_name: UserEventEnum.SECOND_ONBOARDING_START,
        external_id: rc_id,
      });

      /// if the last time it was shown was less than two days ago, interrupt process
      if (
        !moment(lastEvent.created_at).isBefore(moment().subtract(2, 'days'))
      ) {
        return res.json({});
      }

      const hasInAppPurchase = await this._subscriptionService.hasInAppPurchase(
        rc_id as string,
      );

      if (!hasInAppPurchase) {
        const totalCount = await this._userService.getUserEventCount({
          event_name: UserEventEnum.SECOND_ONBOARDING_START,
          external_id: rc_id,
        });

        const isVersionSupported = gte(app_version, this.minVersion);
        switch (region) {
          case 'USA':
            if (totalCount <= 1) {
              onboarding = 'support_paywall';
            } else if (isVersionSupported) {
              onboarding = 'support_paywall_only_tips';
            } else {
              onboarding = 'support_paywall_tips';
            }
            break;
          case 'GBR':
            if (totalCount <= 1) {
              onboarding = 'support_paywall_gbr';
            } else if (isVersionSupported) {
              onboarding = 'support_paywall_only_tips_gbr';
            } else {
              onboarding = 'support_paywall_tips';
            }
            break;
          case 'CAN':
            if (totalCount <= 1) {
              onboarding = 'support_paywall_can';
            } else if (isVersionSupported) {
              onboarding = 'support_paywall_only_tips_can';
            } else {
              onboarding = 'support_paywall_tips';
            }
            break;
          case 'DEU':
            if (totalCount <= 1) {
              onboarding = 'support_paywall_deu';
            } else if (isVersionSupported) {
              onboarding = 'support_paywall_only_tips_deu';
            } else {
              onboarding = 'support_paywall_tips_deu';
            }
            break;
          default:
            /// This case shouldn't happen
            return res.json({});
        }
      } else {
        /// This case shouldn't happen
        return res.json({});
      }
    }

    if (!onboarding) {
      return res.json({});
    }

    const payload = await this._userService.getSecondOnboardings({
      onboarding_name: onboarding,
    });

    return res.json(payload);
  }

  private async handleTipOnlyOnboarding(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    const { rc_id, first_seen, region, onboarding_name } = req.body;

    const diffdays = moment().diff(moment.unix(first_seen), 'days');

    /// If user hasn't used the app for at least 1 months do nothing
    if (diffdays < 30) {
      return res.json({});
    }

    const lastEvent = await this._userService.getLastUserEvent({
      event_name: UserEventEnum.SECOND_ONBOARDING_START,
      external_id: rc_id,
    });

    /// If the user has seen the onboarding before and it hasn't been 7 days since the event yet do nothing
    if (
      lastEvent != null &&
      moment().diff(moment(lastEvent.created_at), 'days') < 7
    ) {
      return res.json({});
    }

    let onboarding: string;

    switch (region) {
      case 'PHL':
        onboarding = 'support_paywall_only_tips_phl';
        break;
      case 'AUS':
        onboarding = 'support_paywall_only_tips_aus';
        break;
      case 'ESP':
        onboarding = 'support_paywall_only_tips_esp';
        break;
      case 'MEX':
        onboarding = 'support_paywall_only_tips_mex';
        break;
      case 'RUS':
        onboarding = 'support_paywall_only_tips_rus';
        break;
      default:
        onboarding = onboarding_name;
        break;
    }

    const payload = await this._userService.getSecondOnboardings({
      onboarding_name: onboarding,
    });

    return res.json(payload);
  }

  public async userEventsHandler(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    const user = req.user;
    const { event, event_data, external_id } = req.body;
    const event_name = event?.toLowerCase();
    if (!Object.values(UserEventEnum).includes(event_name)) {
      return res.status(400).json({ message: 'Invalid event' });
    }
    const eventToInsert = {
      user_id: user?.id_user || null,
      event_name,
      event_data: event_data,
      external_id:
        external_id || event_data.external_id || event_data.rc_id || null,
    };
    await this._userService.insertNewEvent(eventToInsert);
    return res.json({ message: 'event stored' });
  }
}
