import { Knex } from 'knex';

// Same-name merges (docs/same-name-merges.md). When an item arrives at a key
// another item already holds, the two become one item: the one already there
// survives, and the arriving item's uuid is kept here as a pointer to it. A
// request that still names the old uuid (a task queued before the merge,
// another device, an app version that ignores the merge) then lands on the
// merged item instead of a 404 that would hold its sync queue forever.
//
// A pointer names the survivor's row id, never its uuid: a row id doesn't
// change. No foreign keys on purpose: adding one locks the referenced table
// (`library_items`, `users`) while the deploy's migration runs, and rows in
// neither table are ever hard-deleted. A pointer to a missing row resolves to
// nothing, the answer the uuid got before the pointer existed.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('library_item_merges', function (table) {
    table.integer('user_id').unsigned().notNullable();
    table.uuid('merged_uuid').notNullable();
    table.integer('into_item_id').unsigned().notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    // The lookup: a uuid that has no active row of its own.
    table.primary(['user_id', 'merged_uuid']);
  });
  // When a survivor is itself merged into another item later, every pointer
  // into it moves to the new survivor in one UPDATE, so a pointer is always
  // one hop from the item it names.
  await knex.schema.raw(
    'CREATE INDEX library_item_merges_into ON library_item_merges (into_item_id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('library_item_merges');
}
