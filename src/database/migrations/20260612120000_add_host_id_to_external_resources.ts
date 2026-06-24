import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable("external_resources", (table) => {
    table.string("host_id").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable("external_resources", (table) => {
    table.dropColumn("host_id");
  });
}
