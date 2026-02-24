import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_events', function (table) {
    table.index(['external_id', 'event_name', 'created_at'], 'idx_user_events_ext_event_created');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_events', function (table) {
    table.dropIndex(['external_id', 'event_name', 'created_at'], 'idx_user_events_ext_event_created');
  });
}
