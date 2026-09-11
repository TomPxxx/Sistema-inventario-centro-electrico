import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const initializeDatabase = async () => {
  console.log('[DB Init] Iniciando conexión con MySQL...');

  let connection;
  try {
    connection = await mysql.createConnection({
      host: config.db.host,
      user: config.db.user,
      password: config.db.password,
      port: config.db.port,
      multipleStatements: true
    });

    console.log('[DB Init] Conexión establecida. Leyendo archivo SQL...');
    const schemaPath = path.resolve(__dirname, '../../database_schema.sql');
    const sqlContent = await fs.readFile(schemaPath, 'utf8');

    console.log('[DB Init] Ejecutando script SQL completo...');
    await connection.query(sqlContent);

    console.log('[DB Init] ✅ Base de datos y datos semilla creados exitosamente.');
    return { success: true, message: 'Base de datos inicializada correctamente.' };
  } catch (error) {
    console.error('[DB Init Error]:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('⚠️  Asegúrate de que el servicio de MySQL (MySQL Server / XAMPP / MariaDB) esté INICIADO en tu computador.');
    }
    throw error;
  } finally {
    if (connection) await connection.end();
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initializeDatabase()
    .then(() => {
      console.log('[DB Init] Finalizado correctamente.');
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}
