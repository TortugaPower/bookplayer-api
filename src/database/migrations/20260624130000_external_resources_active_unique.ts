import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Allow duplicate (library_item_id, provider_name, provider_id) rows so a
  // resource can be re-added after being soft-deleted. Postgres truncated the
  // original constraint name to 63 chars, so drop it by that exact name.
  await knex.raw(`
    ALTER TABLE external_resources
    DROP CONSTRAINT IF EXISTS external_resources_library_item_id_provider_name_provider_id_un
  `);

  // ...but at most one ACTIVE row may exist per (item, provider, providerId).
  await knex.raw(`
    CREATE UNIQUE INDEX external_resources_active_unique
    ON external_resources (library_item_id, provider_name, provider_id)
    WHERE active = true
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS external_resources_active_unique`);
  await knex.schema.alterTable("external_resources", (table) => {
    table.unique(["library_item_id", "provider_name", "provider_id"]);
  });
}
