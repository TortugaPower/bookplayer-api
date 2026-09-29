import type { Knex } from 'knex';

// Each step commits on its own, so no statement holds an exclusive lock on
// library_items (~1.6M rows) while the table is scanned: a plain SET NOT NULL
// would scan it under ACCESS EXCLUSIVE and block the API for the whole scan.
export const config = { transaction: false };

const CHECK = 'library_items_active_not_null';

// `active` was created nullable (20220515155820). Every read filters on
// `active = true`, so a NULL row is already invisible to clients: effectively
// deleted. Backfill those rows as deleted (false, not true: true would bring
// them back into users' libraries, and could collide with the active-only
// unique indexes on (user_id, key) and (uuid, user_id)), then forbid NULL.
// POST /status counts a deleted row as seen, so no answer depends on NULL.
export async function up(knex: Knex): Promise<void> {
  // A failed earlier run may have left the check behind
  await knex.raw(`ALTER TABLE library_items DROP CONSTRAINT IF EXISTS ${CHECK}`);
  // NOT VALID: enforced for every write from now on (so no NULL can arrive
  // between the backfill and the validation), without scanning existing rows
  await knex.raw(`ALTER TABLE library_items ADD CONSTRAINT ${CHECK} CHECK (active IS NOT NULL) NOT VALID`);
  await knex.raw('UPDATE library_items SET active = false WHERE active IS NULL');
  // Scans the table under SHARE UPDATE EXCLUSIVE: reads and writes carry on
  await knex.raw(`ALTER TABLE library_items VALIDATE CONSTRAINT ${CHECK}`);
  // Postgres proves NOT NULL from the validated check, without a second scan
  await knex.raw('ALTER TABLE library_items ALTER COLUMN active SET NOT NULL');
  await knex.raw('ALTER TABLE library_items ALTER COLUMN active SET DEFAULT true');
  await knex.raw(`ALTER TABLE library_items DROP CONSTRAINT ${CHECK}`);
}

// The backfilled rows stay false: which of them were NULL isn't recorded.
export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE library_items DROP CONSTRAINT IF EXISTS ${CHECK}`);
  await knex.raw('ALTER TABLE library_items ALTER COLUMN active DROP NOT NULL');
}
