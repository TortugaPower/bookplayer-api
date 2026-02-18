import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('glacier_migrations', function (table) {
    table.increments('id_glacier_migration');
    table.integer('user_id').unsigned().notNullable();
    table.foreign('user_id').references('id_user').inTable('users');
    table.string('direction', 20).notNullable().defaultTo('to_glacier');
    table.string('lifecycle_rule_id', 255).notNullable();
    table.boolean('rule_cleaned_up').defaultTo(false);
    table.timestamps(true, true);

    table.index(['user_id', 'rule_cleaned_up']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('glacier_migrations');
}
