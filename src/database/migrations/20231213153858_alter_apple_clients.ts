import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('apple_clients', function (table) {
    table.string('app_version', 10).defaultTo('latest');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('apple_clients', function (table) {
    table.dropColumn('app_version');
  });
}
