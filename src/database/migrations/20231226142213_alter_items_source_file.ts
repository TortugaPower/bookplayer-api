import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('library_items', function (table) {
    table.string('source_path', 450).nullable().defaultTo(null);
  });
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('library_items', function (table) {
    table.dropColumn('source_path');
  });
}
