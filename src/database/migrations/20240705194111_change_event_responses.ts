import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.renameTable('events_responses', 'second_onboardings');
  await knex.schema.alterTable('second_onboardings', function (table) {
    table.renameColumn('id_event_response', 'id_second_onboarding');
    table.renameColumn('event_name', 'onboarding_name');
    table.string('onboarding_id', 100).defaultTo(null);
  });
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function down(knex: Knex): Promise<void> {
  //
}
