import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // For each (user_id, key) with more than one active row, keep the "best" row
  // and deactivate the rest. Best = (synced AND source_path IS NOT NULL) first,
  // tiebreak by oldest created_at, tiebreak by lowest id_library_item.
  //
  // Deactivated rows have uuid set to NULL so they don't trip the existing
  // partial unique index `library_items_uuid_user_unique`.
  await knex.raw(`
    WITH ranked AS (
      SELECT
        id_library_item,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, key
          ORDER BY
            (synced = true AND source_path IS NOT NULL) DESC,
            created_at ASC,
            id_library_item ASC
        ) AS rn
      FROM library_items
      WHERE active = true
    )
    UPDATE library_items li
    SET active = false,
        uuid = NULL,
        updated_at = NOW()
    FROM ranked r
    WHERE li.id_library_item = r.id_library_item
      AND r.rn > 1;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX library_items_user_key_active_unique
    ON library_items (user_id, key)
    WHERE active = true
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS library_items_user_key_active_unique');
  // The dedupe in up() is intentionally not reversed. Re-activating the rows we
  // soft-deleted would restore the same duplicate state that motivated this
  // migration in the first place, and we'd lose the human/audit signal that
  // those rows were known duplicates. Dropping the index alone is safe — the
  // partial unique constraint only enforced uniqueness on active=true rows, so
  // any historical inactive rows that share (user_id, key) are unaffected.
}
