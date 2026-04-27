import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_sub_events_orig_user_id ON subscription_events (original_app_user_id)',
  );
  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_sub_events_app_user_id ON subscription_events ((json->>'app_user_id'))",
  );
  await knex.raw(
    "CREATE INDEX IF NOT EXISTS idx_sub_events_aliases_gin ON subscription_events USING GIN ((json->'aliases'))",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_sub_events_aliases_gin');
  await knex.raw('DROP INDEX IF EXISTS idx_sub_events_app_user_id');
  await knex.raw('DROP INDEX IF EXISTS idx_sub_events_orig_user_id');
}
