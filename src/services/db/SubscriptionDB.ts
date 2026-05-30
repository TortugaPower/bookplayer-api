import { Knex } from 'knex';
import database from '../../database';
import { logger } from '../LoggerService';
import { RevenuecatEvent } from '../../types/user';

export type LatestSubscriptionEvent = {
  type: string | null;
  period_type: string | null;
  expiration_at_ms: string | null;
};

export class SubscriptionDB {
  private readonly _logger = logger;
  private db = database;

  async getLatestActiveEvent(
    externalId: string,
    trx?: Knex.Transaction,
  ): Promise<LatestSubscriptionEvent | null> {
    try {
      const db = trx || this.db;
      const result = await db.raw(
        `SELECT type, period_type, expiration_at_ms
         FROM (
           SELECT id_subscription_event, type, period_type, expiration_at_ms, json
             FROM subscription_events WHERE original_app_user_id = ?
           UNION ALL
           SELECT id_subscription_event, type, period_type, expiration_at_ms, json
             FROM subscription_events WHERE (json->>'app_user_id') = ?
           UNION ALL
           SELECT id_subscription_event, type, period_type, expiration_at_ms, json
             FROM subscription_events WHERE EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(json->'aliases') AS elem
               WHERE elem = ?
             )
         ) e
         ORDER BY (json->>'event_timestamp_ms')::bigint DESC NULLS LAST,
                  id_subscription_event DESC
         LIMIT 1`,
        [externalId, externalId, externalId],
      );
      return result.rows[0] || null;
    } catch (err) {
      this._logger.log({
        origin: 'SubscriptionDB.getLatestActiveEvent',
        message: err.message,
        data: { externalId },
      });
      return null;
    }
  }

  async insertSubscriptionEvent(
    event: RevenuecatEvent,
    trx?: Knex.Transaction,
  ): Promise<number | null> {
    try {
      const db = trx || this.db;
      const [row] = await db('subscription_events')
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
      return row.id_subscription_event;
    } catch (err) {
      this._logger.log({
        origin: 'SubscriptionDB.insertSubscriptionEvent',
        message: err.message,
        data: { event },
      });
      return null;
    }
  }

  async hasActiveGlacierMigration(
    user_id: number,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    try {
      const db = trx || this.db;
      const existing = await db('glacier_migrations')
        .where({ user_id, rule_cleaned_up: false })
        .first();
      return !!existing;
    } catch (err) {
      this._logger.log({
        origin: 'SubscriptionDB.hasActiveGlacierMigration',
        message: err.message,
        data: { user_id },
      });
      return false;
    }
  }

  async insertGlacierMigration(
    params: {
      user_id: number;
      direction: string;
      lifecycle_rule_id: string;
    },
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    try {
      const db = trx || this.db;
      await db('glacier_migrations').insert({
        user_id: params.user_id,
        direction: params.direction,
        lifecycle_rule_id: params.lifecycle_rule_id,
        rule_cleaned_up: false,
      });
      return true;
    } catch (err) {
      this._logger.log({
        origin: 'SubscriptionDB.insertGlacierMigration',
        message: err.message,
        data: { params },
      });
      return false;
    }
  }
}
