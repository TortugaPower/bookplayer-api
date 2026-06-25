import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable("external_resources", (table) => {
    table.boolean("active").notNullable().defaultTo(true);
    table.index(["active"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable("external_resources", (table) => {
    table.dropColumn("active");
  });
}
