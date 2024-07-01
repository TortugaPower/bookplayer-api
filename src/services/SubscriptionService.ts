import { injectable, inject } from 'inversify';
import { AppleUser, RevenuecatEvent, TypeUserParams } from '../types/user';
import verifyAppleToken from 'verify-apple-id-token';
import { Knex } from 'knex';
import database from '../database';
import JWT from 'jsonwebtoken';
import { TYPES } from '../ContainerTypes';
import { IRestClientService } from '../interfaces/IRestClientService';
import { IUserService } from '../interfaces/IUserService';
import { ILoggerService } from '../interfaces/ILoggerService';
import { IEmailService } from '../interfaces/IEmailService';

@injectable()
export class SubscriptionService {
  @inject(TYPES.RestClientService)
  private _restClient: IRestClientService;
  @inject(TYPES.UserServices)
  private _user: IUserService;
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  @inject(TYPES.EmailService)
  private _email: IEmailService;
  private db = database;

  async ParseNewEvent(event: RevenuecatEvent): Promise<AppleUser> {
    try {
      const { original_app_user_id, aliases } = event;
      if (event.type === 'INITIAL_PURCHASE') {
        this._email.sendEmail({
          to: process.env.SUPPORT_EMAIL,
          subject: `BP new user: ${event.price}`,
          html: `<p>
            <strong>User:</strong> ${event.original_app_user_id}
            <strong>Price:</strong> ${event.price}
          </p>`,
        });
      }
      await this.db('subscription_events')
        .insert({
          id: event.id,
          currency: event.currency,
          entitlement_id: event.entitlement_id,
          environment: event.environment,
          expiration_at_ms: event.expiration_at_ms,
          original_app_user_id: event.original_app_user_id,
          period_type: event.period_type,
          purchased_at_ms: event.purchased_at_ms,
          price: event.price,
          type: event.type,
          takehome_percentage: event.takehome_percentage,
          json: JSON.stringify(event),
        })
        .returning('id_subscription_event');
      const user = await this._user.GetUserByAppleID(
        aliases || [original_app_user_id],
      );
      if (!user) {
        return null;
      }
      return user;
    } catch (err) {
      this._logger.log({
        origin: 'ParseNewEvent',
        message: err.message,
        data: { event },
      });
      return null;
    }
  }

  async GetAndUpdateSubscription(user: AppleUser): Promise<boolean> {
    try {
      const apple_id = user[TypeUserParams.apple_id];
      const { subscriber } = await this._restClient.callService({
        baseURL: process.env.REVENUECAT_API,
        service: `subscribers/${apple_id}`,
        method: 'get',
        headers: { authorization: `Bearer ${process.env.REVENUECAT_KEY}` },
      });
      if (subscriber) {
        const subscriptions = Object.keys(subscriber.subscriptions);
        const subs = subscriptions.length ? subscriptions.join(',') : null;
        await this._user.UpdateSubscription(user.id_user, subs);
      }
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'GetAndUpdateSubscription',
        message: err.message,
        data: { user },
      });
      return false;
    }
  }
}
