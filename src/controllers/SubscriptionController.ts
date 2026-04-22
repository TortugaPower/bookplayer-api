import { IRequest, IResponse } from '../types/http';
import { logger } from '../services/LoggerService';
import { RevenuecatEvent, SubscriptionEventType } from '../types/user';
import { SubscriptionService } from '../services/SubscriptionService';
import { GlacierMigrationService } from '../services/GlacierMigrationService';

export class SubscriptionController {
  private readonly _logger = logger;

  constructor(
    private _subscriptionService: SubscriptionService = new SubscriptionService(),
    private _glacierService: GlacierMigrationService = new GlacierMigrationService(),
  ) {}

  public async revenuecatWebhook(
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
      const user = await this._subscriptionService.parseNewEvent(revenueEvent);
      const updated = await this._subscriptionService.getAndUpdateSubscription(
        user,
      );

      if (
        user?.id_user &&
        revenueEvent.type === SubscriptionEventType.EXPIRATION
      ) {
        // Fire-and-forget: don't block webhook response
        this._glacierService
          .handleExpirationEvent(user.id_user, user.email, user.external_id)
          .catch((err) => {
            this._logger.log(
              {
                origin: 'SubscriptionController.revenuecatWebhook.glacierMigration',
                message: err.message,
                data: { userId: user.id_user },
              },
              'error',
            );
          });
      }

      return res.json({ success: updated });
    } catch (err) {
      this._logger.log({ origin: 'SubscriptionController.revenuecatWebhook', message: err.message, data: { body: req.body } }, 'error');
      res.status(400).json({ message: err.message });
      return;
    }
  }
}
