import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('apple_clients', function (table) {
    table.increments('id_apple_client');
    table.string('apple_id', 300);
    table.string('origin').notNullable().unique();
    table.string('email', 200).nullable();
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {}
