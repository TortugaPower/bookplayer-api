import { injectable, inject } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IS3Service } from '../interfaces/IS3Service';
import { ILoggerService } from '../interfaces/ILoggerService';
import { IRestClientService } from '../interfaces/IRestClientService';
import { IGlacierMigrationService } from '../interfaces/IGlacierMigrationService';
import database from '../database';

const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

@injectable()
export class GlacierMigrationService implements IGlacierMigrationService {
  @inject(TYPES.S3Service)
  private _s3: IS3Service;
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  @inject(TYPES.RestClientService)
  private _restClient: IRestClientService;
  private db = database;

  async HandleExpirationEvent(
    userId: number,
    email: string,
    externalId: string,
  ): Promise<void> {
    try {
      const isExpired = await this.IsProEntitlementExpired(externalId);
      if (!isExpired) {
        this._logger.log({
          origin: 'GlacierMigrationService.HandleExpirationEvent',
          message: 'Pro entitlement still active, skipping migration',
          data: { userId },
        });
        return;
      }

      const hasActive = await this.HasActiveMigration(userId);
      if (hasActive) {
        this._logger.log({
          origin: 'GlacierMigrationService.HandleExpirationEvent',
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
            origin: 'GlacierMigrationService.HandleExpirationEvent',
            message: 'Failed to create lifecycle rule',
            data: { userId, ruleId },
          },
          'error',
        );
        return;
      }

      await this.db('glacier_migrations').insert({
        user_id: userId,
        direction: 'to_glacier',
        lifecycle_rule_id: ruleId,
        rule_cleaned_up: false,
      });

      this._logger.log({
        origin: 'GlacierMigrationService.HandleExpirationEvent',
        message: 'Lifecycle rule created for glacier migration',
        data: { userId, ruleId },
      });
    } catch (err) {
      this._logger.log(
        {
          origin: 'GlacierMigrationService.HandleExpirationEvent',
          message: err.message,
          data: { userId },
        },
        'error',
      );
    }
  }

  private async IsProEntitlementExpired(externalId: string): Promise<boolean> {
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
      const now = Date.now();

      return expiresDate + GRACE_PERIOD_MS < now;
    } catch (err) {
      this._logger.log(
        {
          origin: 'GlacierMigrationService.IsProEntitlementExpired',
          message: err.message,
          data: { externalId },
        },
        'error',
      );
      // Fail-safe: don't migrate if we can't verify
      return false;
    }
  }

  private async HasActiveMigration(userId: number): Promise<boolean> {
    const existing = await this.db('glacier_migrations')
      .where({ user_id: userId, rule_cleaned_up: false })
      .first();

    return !!existing;
  }
}
