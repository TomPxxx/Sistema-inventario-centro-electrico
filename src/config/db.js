import pkg from 'pg';
const { Pool } = pkg;
import { config } from './env.js';

// Creamos un Pool de conexiones para PostgreSQL
export const pool = new Pool({
  connectionString: config.db.connectionString,
  ssl: (config.db.connectionString.includes('neon.tech') || config.db.connectionString.includes('sslmode=require')) ? { rejectUnauthorized: false } : false,
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
});

// Evitar que el servidor Node.js caiga si Neon Cloud recicla una conexión inactiva del pool
pool.on('error', (err) => {
  console.warn('[DB Pool] Conexión inactiva reciclada por el servidor:', err.message);
});

// En PostgreSQL, pg devuelve tipos numéricos (DECIMAL) como strings por defecto
// para evitar pérdida de precisión en JS. Para convertir a float automáticamente:
import pg from 'pg';
pg.types.setTypeParser(1700, function(val) {
  return parseFloat(val);
});

// Función para comprobar la salud de la conexión con PostgreSQL
export const testConnection = async () => {
  try {
    const client = await pool.connect();
    await client.query('ALTER TABLE categorias ALTER COLUMN imagen_url TYPE TEXT; ALTER TABLE productos ALTER COLUMN imagen_url TYPE TEXT;').catch(() => {});
    console.log(`[DB] Conectado exitosamente a PostgreSQL`);
    client.release();
    return true;
  } catch (error) {
    console.error('[DB Error] No se pudo conectar a PostgreSQL:', error.message);
    return false;
  }
};
