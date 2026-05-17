import type { Knex } from 'knex';

/**
 * Reconciles drift between the migration history and the prod schema. Every
 * change in here was applied to prod at some point out-of-band (manual SQL,
 * lost migration file, or similar) but never made it into the migration tree.
 *
 * The migration is fully idempotent — every step checks current state and
 * only applies what's missing. Safe on prod (becomes a no-op) and on a fresh
 * CI database (creates everything).
 */

/**
 * Run an `ALTER COLUMN ... TYPE varchar(targetLength)` only if the column is
 * not already at that length. Even "same-type" ALTERs take an ACCESS EXCLUSIVE
 * lock briefly, which we'd rather avoid on hot tables in prod.
 *
 * Pass `targetLength = null` for unbounded varchar (matches prod's
 * `bookmarks.note`).
 */
async function ensureVarcharLength(
  knex: Knex,
  table: string,
  column: string,
  targetLength: number | null,
): Promise<void> {
  const { rows } = await knex.raw(
    `SELECT character_maximum_length
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ?
       AND column_name = ?
       AND data_type = 'character varying'`,
    [table, column],
  );
  // No row means either the column doesn't exist OR it isn't a varchar.
  // Either way this helper can't help; caller is responsible for setup.
  if (!rows[0]) return;
  const current: number | null = rows[0].character_maximum_length;
  if (current === targetLength) return; // already at target — skip
  const typeSql =
    targetLength === null ? 'varchar' : `varchar(${targetLength})`;
  await knex.raw(
    `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE ${typeSql}`,
  );
}

export async function up(knex: Knex): Promise<void> {
  // --- library_items: missing column + 4 length expansions -------------------
  if (!(await knex.schema.hasColumn('library_items', 'original_filename'))) {
    await knex.schema.alterTable('library_items', (table) => {
      table.string('original_filename', 550).nullable();
    });
  }
  await ensureVarcharLength(knex, 'library_items', 'key', 560);
  await ensureVarcharLength(knex, 'library_items', 'title', 600);
  await ensureVarcharLength(knex, 'library_items', 'details', 570);
  await ensureVarcharLength(knex, 'library_items', 'source_path', 580);

  // --- bookmarks: unbounded note + composite primary key ---------------------
  await ensureVarcharLength(knex, 'bookmarks', 'note', null);
  // Composite PK on (library_item_id, time). Prod has it under the name
  // `bookmarks_pk`; create it only if no PK exists yet.
  const bookmarksPkExists = await knex
    .raw(
      `SELECT 1 FROM pg_constraint
       WHERE conrelid = 'bookmarks'::regclass AND contype = 'p'
       LIMIT 1`,
    )
    .then((r) => r.rows.length > 0);
  if (!bookmarksPkExists) {
    await knex.raw(
      `ALTER TABLE bookmarks ADD CONSTRAINT bookmarks_pk PRIMARY KEY (library_item_id, "time")`,
    );
  }

  // --- configs: entire table + 2 enum types ----------------------------------
  // Enum types first (CREATE TYPE has no IF NOT EXISTS in older PG; use a
  // DO block to guard).
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'param_config_type') THEN
        CREATE TYPE param_config_type AS ENUM ('force_file_proxy');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'param_value_type') THEN
        CREATE TYPE param_value_type AS ENUM ('boolean', 'string', 'object', 'number');
      END IF;
    END $$;
  `);

  if (!(await knex.schema.hasTable('configs'))) {
    await knex.raw(`
      CREATE TABLE configs (
        id_config serial PRIMARY KEY,
        config param_config_type NOT NULL,
        value text NOT NULL,
        value_type param_value_type NOT NULL,
        active boolean DEFAULT true,
        created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Seed the single row prod has, so the schemas are identical post-migration.
    await knex.raw(`
      INSERT INTO configs (config, value, value_type)
      VALUES ('force_file_proxy', 'false', 'boolean');
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  // No-op. The drift reflects real prod state; rolling back would risk losing
  // data or shrinking columns below their current content lengths. If a
  // rollback is genuinely needed, do it manually with awareness of what's in
  // each column.
}
