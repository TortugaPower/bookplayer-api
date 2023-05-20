import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('library_items', function (table) {
    table.string('thumbnail', 150).defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {}
