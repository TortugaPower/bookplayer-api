import { Knex } from 'knex';

// One row per (user, S3 key) whose restore out of Deep Archive was requested.
// Written by the on-demand hook in LibraryService when a Pro user plays or
// downloads a frozen book; read by the glacier-cleanup Lambda, which makes
// each READY restore permanent (self-copy to Intelligent-Tiering) and marks
// the row finalized. A book that freezes again later re-opens its own row.
//
// `library_item_id` lets a listing join open requests per item without a
// single S3 call; `kind` separates a book's file from its artwork, which live
// under different keys. `state = 'archived'` is reserved for the Lambda to
// record frozen objects it sees without restoring them.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('glacier_restore_requests', (table) => {
    table.increments('id_glacier_restore_request');
    table.integer('user_id').unsigned().notNullable();
    table.foreign('user_id').references('id_user').inTable('users');
    table.integer('library_item_id').unsigned().nullable();
    table
      .foreign('library_item_id')
      .references('id_library_item')
      .inTable('library_items')
      .onDelete('SET NULL');
    table.string('kind', 16).notNullable().defaultTo('object'); // object | thumbnail
    table.string('key', 1024).notNullable(); // full S3 key, prefix included
    table.string('tier', 16).notNullable().defaultTo('Standard');
    table.smallint('days').notNullable().defaultTo(30);
    table.string('state', 16).notNullable().defaultTo('requested'); // requested | finalized | failed | archived
    table.smallint('attempts').notNullable().defaultTo(1);
    table.timestamp('requested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('finalized_at', { useTz: true }).nullable();
    table.text('last_error').nullable();
    table.timestamps(true, true);

    table.unique(['user_id', 'key']);
    table.index(['state', 'requested_at']);
    table.index(['library_item_id', 'state']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('glacier_restore_requests');
}
