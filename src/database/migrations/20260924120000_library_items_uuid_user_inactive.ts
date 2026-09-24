import type { Knex } from 'knex';

// CREATE INDEX CONCURRENTLY can't run inside a transaction, and it keeps the
// table writable while the index builds (library_items is ~1.6M rows).
export const config = { transaction: false };

// `library_items_uuid_user_unique` only covers active rows, so asking "did this
// user delete the item with this uuid?" was a sequential scan of the table.
// The library routes ask it whenever a request names a uuid that has no active
// row, which old clients repeat every 5 seconds.
export async function up(knex: Knex): Promise<void> {
  // A concurrent build that fails (a cancelled deploy, a timeout) leaves an
  // INVALID index the planner never uses; IF NOT EXISTS would then skip it for
  // good. Drop any leftover and build it fresh.
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS library_items_uuid_user_inactive');
  await knex.raw(`
    CREATE INDEX CONCURRENTLY library_items_uuid_user_inactive
    ON library_items (uuid, user_id)
    WHERE active = false
  `);

  // The same question by key (requests without a uuid) uses the plain key
  // index. Production has it but no migration ever created it, so fresh
  // databases went without; declare it here. A no-op where it exists.
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS library_items_key_index
    ON library_items (key)
  `);
}

// Leaves library_items_key_index alone: production had it before this migration.
export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS library_items_uuid_user_inactive');
}
