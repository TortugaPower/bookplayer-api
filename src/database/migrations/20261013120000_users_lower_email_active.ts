import type { Knex } from 'knex';

// CREATE INDEX CONCURRENTLY can't run inside a transaction, and it keeps
// `users` writable (sign-ups) while the index builds.
export const config = { transaction: false };

// Account lookups by email ignore case (`lower(email) = lower(?)`), which
// `users_email_active_unique` can't serve. Not unique: active accounts whose
// emails differ only in case already exist and are merged by hand.
export async function up(knex: Knex): Promise<void> {
  // A concurrent build that fails leaves an INVALID index the planner never
  // uses; IF NOT EXISTS would then skip it for good. Drop any leftover first.
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS users_lower_email_active');
  await knex.raw(`
    CREATE INDEX CONCURRENTLY users_lower_email_active
    ON users (lower(email))
    WHERE active = true
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS users_lower_email_active');
}
