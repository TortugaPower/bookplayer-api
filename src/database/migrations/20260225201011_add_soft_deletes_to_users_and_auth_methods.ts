import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        UPDATE auth_methods
            SET active = false
            FROM users
            WHERE auth_methods.user_id = users.id_user 
            AND users.active = false 
            AND auth_methods.active = true;
    `);
    
    await knex.raw(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_mail_unique;
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_public_id_unique;

        CREATE UNIQUE INDEX users_email_active_unique ON users (email) WHERE active = true;
        CREATE UNIQUE INDEX users_external_id_active_unique ON users (external_id) WHERE active = true;

        ALTER TABLE auth_methods DROP CONSTRAINT IF EXISTS auth_methods_auth_type_external_id_unique;

        CREATE UNIQUE INDEX auth_methods_auth_type_external_id_active_unique ON auth_methods (auth_type, external_id) WHERE active = true;
    `);
}


export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
        DROP INDEX IF EXISTS users_email_active_unique;
        DROP INDEX IF EXISTS users_external_id_active_unique;
        DROP INDEX IF EXISTS auth_methods_auth_type_external_id_active_unique;
    `);

    await knex.raw(`
        UPDATE users 
        SET 
        email = CASE 
            WHEN email NOT LIKE '%-deleted%' 
            THEN email || '-deleted' || (EXTRACT(EPOCH FROM created_at)::BIGINT)
            ELSE email 
        END,
        external_id = CASE 
            WHEN external_id NOT LIKE '%-deleted%' 
            THEN external_id || '-deleted' || (EXTRACT(EPOCH FROM created_at)::BIGINT)
            ELSE external_id 
        END
        WHERE active = false;
    `);

    await knex.raw(`
        UPDATE auth_methods 
        SET 
        external_id = CASE 
            WHEN external_id NOT LIKE '%-deleted%' 
            THEN external_id || '-deleted' || (EXTRACT(EPOCH FROM created_at)::BIGINT)
            ELSE external_id 
        END
        WHERE active = false;
    `);

    await knex.raw(`
        ALTER TABLE users ADD CONSTRAINT users_user_mail_unique UNIQUE (email);
        ALTER TABLE users ADD CONSTRAINT users_public_id_unique UNIQUE (external_id);
        ALTER TABLE auth_methods ADD CONSTRAINT auth_methods_auth_type_external_id_unique UNIQUE (auth_type, external_id);
    `);
}

