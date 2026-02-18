import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IRequest, IResponse } from '../interfaces/IRequest';
import { ISubscriptionController } from '../interfaces/ISubscriptionController';
import { ILoggerService } from '../interfaces/ILoggerService';
import { RevenuecatEvent, SubscriptionEventType } from '../types/user';
import { ISubscriptionService } from '../interfaces/ISubscriptionService';
import { IGlacierMigrationService } from '../interfaces/IGlacierMigrationService';

@injectable()
export class SubscriptionController implements ISubscriptionController {
  @inject(TYPES.SubscriptionService)
  private _subscriptionService: ISubscriptionService;
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  @inject(TYPES.GlacierMigrationService)
  private _glacierService: IGlacierMigrationService;

  public async RevenuecatWebhook(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const authorization = req.headers.authorization;
      if (!authorization || authorization !== process.env.REVENUECAT_HEADER) {
        res.status(400).json({ message: 'Invalid authorization' });
        return;
      }
      const { event } = req.body;
      const revenueEvent = event as RevenuecatEvent;
      const user = await this._subscriptionService.ParseNewEvent(revenueEvent);
      const updated = await this._subscriptionService.GetAndUpdateSubscription(
        user,
      );

      if (
        user?.id_user &&
        revenueEvent.type === SubscriptionEventType.EXPIRATION
      ) {
        // Fire-and-forget: don't block webhook response
        this._glacierService
          .HandleExpirationEvent(user.id_user, user.email, user.external_id)
          .catch((err) => {
            this._logger.log(
              {
                origin: 'RevenuecatWebhook.glacierMigration',
                message: err.message,
                data: { userId: user.id_user },
              },
              'error',
            );
          });
      }

      return res.json({ success: updated });
    } catch (err) {
      this._logger.log({ origin: 'RevenuecatWebhook', message: err.message, data: { body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }
}
