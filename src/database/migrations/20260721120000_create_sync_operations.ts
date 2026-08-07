import { Knex } from 'knex';

// Append-only audit log of state-mutating sync operations a client executes
// against /v1/library. Lets us replay the exact ordered sequence that led a
// library into a corrupt state (see docs/sync-operations-audit-plan.md).
//
// Not partitioned: retention is a nightly DELETE on last_seen_at. Partitioning
// would force the partition key into the coalescing unique index below, which
// must be cross-time (a client can retry the same failing op for hours).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sync_operations', function (table) {
    table.bigIncrements('id');

    // No FK to users on purpose: an audit trail must survive account deletion
    // (a CASCADE would erase the forensic history we're keeping). Retention is
    // handled by the nightly purge on last_seen_at, not by cascade.
    table.integer('user_id').unsigned().notNullable();
    table
      .timestamp('occurred_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.string('job_type', 40).notNullable();
    table.string('http_method', 8).notNullable();
    table.string('route', 64).notNullable();

    table.uuid('item_uuid').nullable();
    table.string('relative_path', 1024).nullable();
    table.jsonb('params').nullable();

    table.integer('status_code').nullable();
    table.string('outcome', 12).notNullable(); // 'applied' | 'error'
    table.string('error_message', 512).nullable();

    table.string('app_version', 16).nullable();

    // Error coalescing (see the partial unique index below).
    table.text('fingerprint').nullable();
    table
      .timestamp('first_seen_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('last_seen_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.integer('occurrence_count').notNullable().defaultTo(1);
  });

  // Primary forensic query: a user's operations in order.
  await knex.schema.raw(
    'CREATE INDEX sync_ops_user_time ON sync_operations (user_id, occurred_at)',
  );
  // "History of this item".
  await knex.schema.raw(
    'CREATE INDEX sync_ops_item_uuid ON sync_operations (item_uuid) WHERE item_uuid IS NOT NULL',
  );
  // Retry coalescing: at most one open error row per (user, fingerprint). The
  // predicate makes this the ON CONFLICT arbiter for error inserts only;
  // 'applied' rows never satisfy it, so successful mutations always insert.
  await knex.schema.raw(
    "CREATE UNIQUE INDEX sync_ops_error_fingerprint ON sync_operations (user_id, fingerprint) WHERE outcome = 'error'",
  );
  // Retention: the nightly purge deletes by last_seen_at.
  await knex.schema.raw(
    'CREATE INDEX sync_ops_last_seen ON sync_operations (last_seen_at)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sync_operations');
}
