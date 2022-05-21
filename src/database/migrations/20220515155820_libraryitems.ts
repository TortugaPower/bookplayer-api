import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('library_items', function (table) {
      table.increments('id_library_item');
      table.integer('user_id').unsigned().notNullable();
      table.foreign('user_id').references('id_user').inTable('users');
      table.string('key', 150);
      table.string('title', 100);
      table.float('speed').nullable();
      table.string('actual_time', 20).nullable();
      table.string('duration', 20).nullable();
      table.float('percent_completed').nullable();
      table.integer('order_rank');
      table.integer('last_play_date').nullable();
      table.integer('type');
      table.boolean('is_finish').defaultTo(false);
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    })
}


export async function down(knex: Knex): Promise<void> {
}

