import type { Knex } from 'knex';

// CREATE INDEX CONCURRENTLY can't run inside a transaction, and it keeps
// `users` writable (sign-ups) while the index builds.
export const config = { transaction: false };

// One active account per email, whatever its case. Account lookups match
// `lower(email)`, which `users_email_active_unique` can't serve, and an exact
// match had split people into two accounts (`Jane@` from Apple, `jane@` typed
// at a passkey sign-up). Those pairs were merged before this ran; if one is
// left, the build fails, and the migration can run again once it's merged.
export async function up(knex: Knex): Promise<void> {
  // A concurrent build that fails leaves an INVALID index the planner never
  // uses; IF NOT EXISTS would then skip it for good. Drop any leftover first.
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS users_lower_email_active_unique');
  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY users_lower_email_active_unique
    ON users (lower(email))
    WHERE active = true
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS users_lower_email_active_unique');
}
