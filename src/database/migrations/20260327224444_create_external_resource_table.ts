import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable("external_resources", (table) => {
    table.increments("id").primary();

    // The foreign key relation
    table.integer("library_item_id")
      .unsigned() 
      .notNullable()
      .references("id_library_item") 
      .inTable("library_items")
      .onDelete("CASCADE")
      .onUpdate("CASCADE");

    table.string("providerName").notNullable();
    table.string("providerId").notNullable();
    table.string("syncStatus").notNullable();
    table.timestamp("lastSyncedAt").nullable();
    table.boolean("processedFile").notNullable().defaultTo(false);

    // Constraints & Indices
    table.unique(["library_item_id", "providerName", "providerId"]);
    table.index(["providerName"]);
    table.index(["providerId"]);
    table.index(["syncStatus"]);
    table.index(["library_item_id"]); // Indexing the FK for faster joins

    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists("external_resources");
}