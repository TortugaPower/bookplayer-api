import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  return knex.schema.raw("ALTER TYPE param_type ADD VALUE 'beta_user'");
}


export async function down(knex: Knex): Promise<void> {
}

