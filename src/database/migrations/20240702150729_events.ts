import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('user_events', function (table) {
      table.increments('id_user_event');
      table.integer('user_id').unsigned().nullable();
      table.foreign('user_id').references('id_user').inTable('users');
      table.string('external_id', 300).nullable();
      table.string('event_name', 100).notNullable();
      table.jsonb('event_data').nullable();
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    })
    .createTable('events_responses', function (table) {
      table.increments('id_event_response');
      table.string('event_name', 100).notNullable();
      table.string('type', 100).notNullable();
      table.jsonb('response_data').notNullable();
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    });
}

export async function down(knex: Knex): Promise<void> {}
