import dotenv from 'dotenv';
import { readFileSync } from 'fs';
dotenv.config({
  path: `${process.env.NODE_ENV || '.development'}.env`,
});

// Off for a local server. With DB_SSL_CA set (the deploy's migration step, connecting through a tunnel at
// 127.0.0.1), the server's certificate is verified against that CA bundle for DB_SSL_SERVERNAME — the RDS endpoint
// name, which is what the certificate carries. Otherwise the historical behaviour: encrypted, server unverified.
const sslConfig = () => {
  if (process.env.DB_HOST === 'localhost') return false;
  if (process.env.DB_SSL_CA) {
    return {
      ca: readFileSync(process.env.DB_SSL_CA, 'utf8'),
      servername: process.env.DB_SSL_SERVERNAME || process.env.DB_HOST,
      rejectUnauthorized: true,
    };
  }
  return { rejectUnauthorized: false };
};

module.exports = {
  development: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST,
      // Default 5432; the deploy's migration step sets it to the local end of its SSM tunnel.
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      ssl: sslConfig(),
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './src/database/migrations',
    },
    seeds: {
      directory: './src/database/seeds',
    },
  },
};
