import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_params');
  await knex.raw('DROP TYPE IF EXISTS param_type');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    "CREATE TYPE param_type AS ENUM ('subscription', 'apple_id', 'beta_user')",
  );
  await knex.schema.createTable('user_params', function (table) {
    table.increments('id_param');
    table.integer('user_id').unsigned().notNullable();
    table.foreign('user_id').references('id_user').inTable('users');
    table.specificType('param', 'param_type').notNullable();
    table.string('value', 60).nullable();
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
  });
}
