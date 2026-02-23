import type { Knex } from "knex";

const BATCH_SIZE = 1000;
const TABLE_NAME = 'users';

export async function up(knex: Knex): Promise<void> {
    let count = 0;
    let batch;

    do {
        batch = await knex(TABLE_NAME)
            .select('id_user')
            .where('active', false)
            .andWhereNot('external_id', 'like', '%-deleted%')
            .limit(BATCH_SIZE);

        if (batch.length > 0) {
            const ids = batch.map((row: { id_user: number | string }) => row.id_user);

            await knex(TABLE_NAME)
                .whereIn('id_user', ids)
                .update({
                    external_id: knex.raw(
                        "?? || '-deleted' || CAST(EXTRACT(EPOCH FROM ??) AS BIGINT)", 
                        ['external_id', 'updated_at']
                    )
                });

            count += batch.length;
            console.log(`[UP] Progress: Updated ${count} rows...`);
        }
    } while (batch.length === BATCH_SIZE);
}


export async function down(knex: Knex): Promise<void> {
    let count = 0;
    let batch;

    do {
        batch = await knex(TABLE_NAME)
            .select('id_user')
            .where('active', false)
            .andWhere('external_id', 'like', '%-deleted%')
            .limit(BATCH_SIZE);

        if (batch.length > 0) {
            const ids = batch.map((row: { id_user: number | string }) => row.id_user);

            await knex(TABLE_NAME)
                .whereIn('id_user', ids)
                .update({
                    external_id: knex.raw(
                        "REGEXP_REPLACE(??, '-deleted[0-9]+$', '')", 
                        ['external_id']
                    )
                });

            count += batch.length;
            console.log(`[DOWN] Progress: Reverted ${count} rows...`);
        }
    } while (batch.length === BATCH_SIZE);
}

