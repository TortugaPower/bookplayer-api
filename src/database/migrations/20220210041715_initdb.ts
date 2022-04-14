import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('users', function (table) {
      table.increments('id_user');
      table.string('email', 120).unique().notNullable();
      table.string('password', 160).notNullable();
      table.string('user_update', 10).nullable();
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    })
    .createTable('user_devices', function (table) {
      table.increments('id_user_device');
      table.integer('user_id').unsigned().notNullable();
      table.foreign('user_id').references('id_user').inTable('users');
      table.string('session', 80).notNullable();
      table.string('device_os', 10).notNullable();
      table.string('user_update', 10).nullable();
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    })
    .createTable('user_params', function (table) {
      table.increments('id_param');
      table.integer('user_id').unsigned().notNullable();
      table.foreign('user_id').references('id_user').inTable('users');
      table
        .enu('param', ['subscription','apple_id'], {
          useNative: true,
          enumName: 'param_type',
        })
        .notNullable();
      table.string('value', 60).nullable();
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    });
}


export async function down(knex: Knex): Promise<void> {
}

