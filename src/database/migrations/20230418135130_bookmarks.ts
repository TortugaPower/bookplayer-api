import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('bookmarks', function (table) {
    table.integer('library_item_id').unsigned().notNullable();
    table
      .foreign('library_item_id')
      .references('id_library_item')
      .inTable('library_items');
    table.string('note', 300);
    table.integer('time').notNullable();
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {}
