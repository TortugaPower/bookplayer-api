import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('admin_users', function (table) {
    table.increments('id_admin_user');
    table.integer('user_id').unsigned().notNullable();
    table.foreign('user_id').references('id_user').inTable('users');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {}