import mysql from 'mysql2/promise';
import { config } from './env.js';

// Creamos un Pool de conexiones optimizado para aplicaciones escalables
export const pool = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  port: config.db.port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true, // Devuelve DECIMAL como números/strings formateados
  timezone: 'Z'
});

// Función para comprobar la salud de la conexión con MySQL
export const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log(`[DB] Conectado exitosamente a MySQL (Base de datos: ${config.db.database})`);
    connection.release();
    return true;
  } catch (error) {
    console.error('[DB Error] No se pudo conectar a MySQL:', error.message);
    return false;
  }
};
