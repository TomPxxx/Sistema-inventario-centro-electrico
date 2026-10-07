import { pool } from './src/config/db.js';

async function alterDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Add imagen_url to categorias if it doesn't exist
    await client.query(`
      ALTER TABLE categorias 
      ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255) DEFAULT null;
    `);

    // Add imagen_url to productos if it doesn't exist
    await client.query(`
      ALTER TABLE productos 
      ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255) DEFAULT null;
    `);

    await client.query('COMMIT');
    console.log('Database altered successfully: added imagen_url to categorias and productos.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error altering database:', error);
  } finally {
    client.release();
    process.exit(0);
  }
}

alterDb();
