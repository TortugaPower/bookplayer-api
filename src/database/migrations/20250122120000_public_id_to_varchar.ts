import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Change public_id from uuid to varchar(100) to support both UUIDs and Apple IDs
  await knex.schema.alterTable('users', function (table) {
    table.string('public_id', 100).alter();
  });

  // 2. Update existing users with their apple_id from user_params
  // Use DISTINCT ON to handle duplicate Apple IDs - keep the most recent user_params entry
  // This allows subscription lookups to work directly via external_id
  await knex.raw(`
    UPDATE users u
    SET public_id = deduped.value
    FROM (
      SELECT DISTINCT ON (value) user_id, value
      FROM user_params
      WHERE param = 'apple_id' AND active = true
      ORDER BY value, id_param DESC
    ) AS deduped
    WHERE deduped.user_id = u.id_user
  `);

  // 3. Rename public_id to external_id for clarity
  // external_id stores Apple ID for Apple users, or UUID for passkey-only users
  await knex.schema.alterTable('users', function (table) {
    table.renameColumn('public_id', 'external_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  // 1. Rename back to public_id
  await knex.schema.alterTable('users', function (table) {
    table.renameColumn('external_id', 'public_id');
  });

  // 2. Revert Apple ID values back to UUIDs for users that have them
  // Note: This rollback will fail if any values are not valid UUIDs after this step
  await knex.raw(`
    UPDATE users
    SET public_id = gen_random_uuid()::text
    WHERE public_id NOT SIMILAR TO '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  `);

  // 3. Change column back to uuid type
  await knex.schema.alterTable('users', function (table) {
    table.uuid('public_id').alter();
  });
}
