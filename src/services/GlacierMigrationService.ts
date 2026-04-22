import { S3Service } from './S3Service';
import { logger } from './LoggerService';
import { RestClientService } from './RestClientService';
import { SubscriptionDB } from './db/SubscriptionDB';

export class GlacierMigrationService {
  private readonly _logger = logger;

  constructor(
    private _s3: S3Service = new S3Service(),
    private _restClient: RestClientService = new RestClientService(),
    private _subscriptionDB: SubscriptionDB = new SubscriptionDB(),
  ) {}

  async handleExpirationEvent(
    userId: number,
    email: string,
    externalId: string,
  ): Promise<void> {
    try {
      const isExpired = await this.isProEntitlementExpired(externalId);
      if (!isExpired) {
        this._logger.log({
          origin: 'GlacierMigrationService.handleExpirationEvent',
          message: 'Pro entitlement still active, skipping migration',
          data: { userId },
        });
        return;
      }

      const hasActive = await this._subscriptionDB.hasActiveGlacierMigration(userId);
      if (hasActive) {
        this._logger.log({
          origin: 'GlacierMigrationService.handleExpirationEvent',
          message: 'Active migration already exists, skipping',
          data: { userId },
        });
        return;
      }

      const ruleId = `glacier-migrate-${userId}`;
      // Using email without trailing slash matches both {email}/ and {email}_thumbnail/
      const success = await this._s3.addLifecycleRule(
        ruleId,
        email,
        'DEEP_ARCHIVE',
      );

      if (!success) {
        this._logger.log(
          {
            origin: 'GlacierMigrationService.handleExpirationEvent',
            message: 'Failed to create lifecycle rule',
            data: { userId, ruleId },
          },
          'error',
        );
        return;
      }

      await this._subscriptionDB.insertGlacierMigration({
        user_id: userId,
        direction: 'to_glacier',
        lifecycle_rule_id: ruleId,
      });

      this._logger.log({
        origin: 'GlacierMigrationService.handleExpirationEvent',
        message: 'Lifecycle rule created for glacier migration',
        data: { userId, ruleId },
      });
    } catch (err) {
      this._logger.log(
        {
          origin: 'GlacierMigrationService.handleExpirationEvent',
          message: err.message,
          data: { userId },
        },
        'error',
      );
    }
  }

  private async isProEntitlementExpired(externalId: string): Promise<boolean> {
    try {
      const { subscriber } = await this._restClient.callService({
        baseURL: process.env.REVENUECAT_API,
        service: `subscribers/${externalId}`,
        method: 'get',
        headers: { authorization: `Bearer ${process.env.REVENUECAT_KEY}` },
      });

      if (!subscriber?.entitlements?.pro) {
        return true;
      }

      const expiresDate = new Date(
        subscriber.entitlements.pro.expires_date,
      ).getTime();

      return expiresDate < Date.now();
    } catch (err) {
      this._logger.log(
        {
          origin: 'GlacierMigrationService.isProEntitlementExpired',
          message: err.message,
          data: { externalId },
        },
        'error',
      );
      // Fail-safe: don't migrate if we can't verify
      return false;
    }
  }
}
