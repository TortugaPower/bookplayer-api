import { Knex } from 'knex';

// Per-user flag selecting which S3 prefix the user's files live under.
// false (default) -> legacy prefix = the auth token email (e.g. Apple relay)
// true            -> canonical prefix = users.external_id
// New accounts are created with `true` (see UserDB.insertUser); existing
// accounts stay `false` until their objects are copied to the external_id
// prefix and the flag is flipped.
export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('users', function (table) {
    table.boolean('storage_uses_external_id').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('users', function (table) {
    table.dropColumn('storage_uses_external_id');
  });
}
