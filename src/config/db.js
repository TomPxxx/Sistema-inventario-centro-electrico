import pkg from 'pg';
const { Pool } = pkg;
import { config } from './env.js';

// Creamos un Pool de conexiones para PostgreSQL
export const pool = new Pool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  port: config.db.port,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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
    console.log(`[DB] Conectado exitosamente a PostgreSQL (Base de datos: ${config.db.database})`);
    client.release();
    return true;
  } catch (error) {
    console.error('[DB Error] No se pudo conectar a PostgreSQL:', error.message);
    return false;
  }
};
