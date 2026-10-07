import pg from 'pg';
import { config } from './src/config/env.js';

const { Client } = pg;

async function run() {
  const client = new Client({
    connectionString: config.db.connectionString,
    ssl: config.db.connectionString.includes('neon.tech') ? { rejectUnauthorized: false } : false
  });
  
  await client.connect();
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
          id SERIAL PRIMARY KEY,
          token TEXT NOT NULL UNIQUE,
          revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NULL
      );
      CREATE INDEX IF NOT EXISTS idx_token_blacklist_token ON token_blacklist (token);
    `);
    console.log("Migration successful: token_blacklist table created.");
  } catch(e) {
    console.error("Migration failed:", e);
  } finally {
    await client.end();
  }
}

run();
