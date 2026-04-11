import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('library_items', (table) => {
    table.dropUnique(['uuid']);
  });
  // Partial unique index: only enforce uniqueness for active rows
  await knex.raw(
    'CREATE UNIQUE INDEX library_items_uuid_unique ON library_items (uuid) WHERE active = true'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS library_items_uuid_unique');
  await knex.schema.alterTable('library_items', (table) => {
    table.unique(['uuid']);
  });
}
