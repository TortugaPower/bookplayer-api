import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.raw('DROP INDEX IF EXISTS library_items_uuid_unique');

    await knex.raw(`
        CREATE UNIQUE INDEX library_items_uuid_user_unique 
        ON library_items (uuid, user_id) 
        WHERE active = true
    `);
};

export async function down(knex: Knex): Promise<void> {
    await knex.raw('DROP INDEX IF EXISTS library_items_uuid_user_unique');

    // 2. Restore the original single-column partial index
    await knex.raw(`
        CREATE UNIQUE INDEX library_items_uuid_unique 
        ON library_items (uuid) 
        WHERE active = true
    `);
};
