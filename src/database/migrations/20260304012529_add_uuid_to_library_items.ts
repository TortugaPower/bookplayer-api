import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    return knex.schema.alterTable('library_items', (table) => {
        table.uuid('uuid').nullable();
        table.index('uuid');
    });
}


export async function down(knex: Knex): Promise<void> {
    return knex.schema.alterTable('library_items', (table) => {
        table.dropIndex('uuid');
        table.dropColumn('uuid');
    });
}

