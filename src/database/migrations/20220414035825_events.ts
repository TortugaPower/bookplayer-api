import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('subscription_events', function (table) {
    table.increments('id_subscription_event');
    table.string('id', 120).unique().nullable();
    table.string('currency', 20).nullable();
    table.string('entitlement_id', 50).nullable();
    table.string('environment', 50).nullable();
    table.string('expiration_at_ms', 20).nullable();
    table.string('original_app_user_id', 50).nullable();
    table.string('period_type', 50).nullable();
    table.string('purchased_at_ms', 20).nullable();
    table.float('price').nullable();
    table.string('type', 50).nullable();
    table.float('takehome_percentage').nullable();
    table.jsonb('json').nullable;
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {}
