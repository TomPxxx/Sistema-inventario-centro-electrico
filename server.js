import app from './src/app.js';
import { config } from './src/config/env.js';
import { testConnection } from './src/config/db.js';

const PORT = config.port;

const startServer = async () => {
  console.log('====================================================');
  console.log('⚡ SISTEMA DE INVENTARIO MULTISEDE - BACKEND INICIADO');
  console.log('====================================================');

  // Probamos la conexión con la base de datos al arrancar
  const dbOk = await testConnection();
  if (!dbOk) {
    console.warn('⚠️  Nota: Si la base de datos aún no está creada, puedes ejecutar:');
    console.warn('    npm run db:init');
    console.warn('    o hacer una petición POST a: http://localhost:' + PORT + '/api/auth/init-db');
  }

  app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log(`📡 Endpoints principales:`);
    console.log(`   - Login:   POST http://localhost:${PORT}/api/auth/login`);
    console.log(`   - Perfil:  GET  http://localhost:${PORT}/api/auth/me`);
    console.log(`   - Init DB: POST http://localhost:${PORT}/api/auth/init-db`);
    console.log(`   - Health:  GET  http://localhost:${PORT}/api/health`);
    console.log('====================================================');
  });
};

startServer();
