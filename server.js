import app from './src/app.js';
import { config } from './src/config/env.js';
import { testConnection } from './src/config/db.js';
import http from 'http';
import { Server } from 'socket.io';

const PORT = config.port;

const startServer = async () => {
  console.log('====================================================');
  console.log('⚡ SISTEMA DE INVENTARIO MULTISEDE - BACKEND INICIADO');
  console.log('====================================================');

  const server = http.createServer(app);
  
  // Inicialización de Socket.io
  const io = new Server(server, {
    cors: {
      origin: '*', // Permitir cualquier origen por ahora
      methods: ['GET', 'POST']
    }
  });

  // Guardar la instancia de socket.io en app para usarla en los controladores
  app.set('io', io);

  io.on('connection', (socket) => {
    console.log(`📡 [Socket.io] Nuevo cliente conectado: ${socket.id}`);
    
    // Opcional: El cliente puede unirse a una "sala" (room) por sede o por rol
    socket.on('join_sede', (sedeId) => {
      socket.join(`sede_${sedeId}`);
      console.log(`[Socket.io] Cliente ${socket.id} se unió a la sala sede_${sedeId}`);
    });

    socket.on('disconnect', () => {
      console.log(`📡 [Socket.io] Cliente desconectado: ${socket.id}`);
    });
  });

  // Probamos la conexión con la base de datos al arrancar
  const dbOk = await testConnection();
  if (!dbOk) {
    console.warn('⚠️  Nota: Si la base de datos aún no está creada, puedes ejecutar:');
    console.warn('    npm run db:init');
    console.warn('    o hacer una petición POST a: http://localhost:' + PORT + '/api/auth/init-db');
  }

  server.listen(PORT, () => {
    console.log(`🚀 Servidor HTTP y WebSockets ejecutándose en http://localhost:${PORT}`);
    console.log(`📡 Endpoints principales:`);
    console.log(`   - Login:   POST http://localhost:${PORT}/api/auth/login`);
    console.log(`   - Perfil:  GET  http://localhost:${PORT}/api/auth/me`);
    console.log(`   - Init DB: POST http://localhost:${PORT}/api/auth/init-db`);
    console.log(`   - Health:  GET  http://localhost:${PORT}/api/health`);
    console.log('====================================================');
  });
};

startServer();
