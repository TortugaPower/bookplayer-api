import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Add public_id UUID column to users table
  await knex.schema.alterTable('users', function (table) {
    table.uuid('public_id').unique().defaultTo(knex.raw('gen_random_uuid()'));
  });

  // Backfill existing users with UUIDs
  await knex.raw('UPDATE users SET public_id = gen_random_uuid() WHERE public_id IS NULL');

  // Make public_id NOT NULL after backfill
  await knex.schema.alterTable('users', function (table) {
    table.uuid('public_id').notNullable().alter();
  });

  // 2. Create auth_methods table
  await knex.schema.createTable('auth_methods', function (table) {
    table.increments('id_auth_method');
    table.integer('user_id').unsigned().notNullable();
    table.foreign('user_id').references('id_user').inTable('users');
    table.string('auth_type', 20).notNullable(); // 'apple', 'passkey'
    table.string('external_id', 512).notNullable(); // Apple sub or credential ID (base64url)
    table.jsonb('metadata').defaultTo('{}');
    table.boolean('is_primary').defaultTo(false);
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);

    table.unique(['auth_type', 'external_id']);
    table.index(['user_id']);
    table.index(['auth_type', 'external_id']);
  });

  // 3. Create passkey_credentials table
  await knex.schema.createTable('passkey_credentials', function (table) {
    table.increments('id_passkey');
    table.integer('auth_method_id').unsigned().notNullable();
    table.foreign('auth_method_id').references('id_auth_method').inTable('auth_methods');
    table.binary('credential_id').notNullable().unique();
    table.binary('public_key').notNullable();
    table.bigInteger('counter').defaultTo(0);
    table.string('device_type', 32).notNullable(); // 'singleDevice', 'multiDevice'
    table.boolean('backed_up').defaultTo(false);
    table.specificType('transports', 'text[]').defaultTo('{}');
    table.string('device_name', 255).nullable();
    table.timestamp('last_used_at', { useTz: true }).nullable();
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);

    table.index(['auth_method_id']);
  });

  // 4. Create webauthn_challenges table
  await knex.schema.createTable('webauthn_challenges', function (table) {
    table.increments('id_challenge');
    table.binary('challenge').notNullable().unique();
    table.integer('user_id').unsigned().nullable();
    table.foreign('user_id').references('id_user').inTable('users');
    table.string('email', 120).nullable();
    table.string('challenge_type', 20).notNullable(); // 'registration', 'authentication'
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamps(true, true);

    table.index(['challenge']);
    table.index(['expires_at']);
  });

  // 5. Migrate existing Apple IDs from user_params to auth_methods
  // Use DISTINCT ON to handle duplicate Apple IDs (same Apple ID linked to multiple users)
  // This keeps only the oldest occurrence based on created_at
  await knex.raw(`
    INSERT INTO auth_methods (user_id, auth_type, external_id, is_primary, active, created_at, updated_at)
    SELECT DISTINCT ON (up.value)
      up.user_id,
      'apple' as auth_type,
      up.value as external_id,
      true as is_primary,
      up.active,
      up.created_at,
      up.updated_at
    FROM user_params up
    WHERE up.param = 'apple_id'
    AND up.active = true
    ORDER BY up.value, up.created_at ASC
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order due to foreign key constraints
  await knex.schema.dropTableIfExists('webauthn_challenges');
  await knex.schema.dropTableIfExists('passkey_credentials');
  await knex.schema.dropTableIfExists('auth_methods');

  // Remove public_id column from users
  await knex.schema.alterTable('users', function (table) {
    table.dropColumn('public_id');
  });
}
