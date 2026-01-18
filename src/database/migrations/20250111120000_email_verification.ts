import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('email_verification_codes', function (table) {
    table.increments('id');
    table.string('email', 120).notNullable();
    table.string('code', 6).notNullable();
    table.timestamp('expires_at').notNullable();
    table.boolean('verified').defaultTo(false);
    table.integer('attempts').defaultTo(0);
    table.timestamps(true, true);

    table.index(['email', 'code']);
    table.index(['email', 'expires_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('email_verification_codes');
}
