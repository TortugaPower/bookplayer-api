import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_preferences', function (table) {
    table.increments('id_user_preference');

    table.integer('user_id').unsigned().notNullable();
    table
      .foreign('user_id')
      .references('id_user')
      .inTable('users')
      .onDelete('CASCADE');

    table.string('key', 128).notNullable();
    table.jsonb('value').notNullable().defaultTo('{}');
    table.boolean('active').defaultTo(true);

    table.timestamps(true, true);

    table.unique(['user_id', 'key']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_preferences');
}
