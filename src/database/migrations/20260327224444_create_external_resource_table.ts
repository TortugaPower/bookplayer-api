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

    table.string("provider_name").notNullable();
    table.string("provider_id").notNullable();
    table.string("sync_status").notNullable();
    table.timestamp("last_synced_at").nullable();
    table.boolean("processed_file").notNullable().defaultTo(false);

    // Constraints & Indices
    table.unique(["library_item_id", "provider_name", "provider_id"]);
    table.index(["provider_name"]);
    table.index(["provider_id"]);
    table.index(["sync_status"]);
    table.index(["library_item_id"]); // Indexing the FK for faster joins

    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists("external_resources");
}