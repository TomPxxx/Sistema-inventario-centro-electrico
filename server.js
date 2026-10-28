import app from './src/app.js';
import { config } from './src/config/env.js';
import { testConnection } from './src/config/db.js';
import http from 'http';
import { Server } from 'socket.io';
import { initBackupScheduler } from './src/services/backupScheduler.js';

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

  // Guardar la instancia de socket.io y el mapa de presencia en app para usarlos en los controladores
  const onlineUsers = new Map(); // userId (number) -> Set<socket.id>
  app.set('io', io);
  app.set('onlineUsers', onlineUsers);

  const broadcastPresence = () => {
    const onlineUserIds = [];
    for (const [uid, sockets] of onlineUsers.entries()) {
      if (sockets.size > 0) onlineUserIds.push(Number(uid));
    }
    io.emit('presencia_usuarios_actualizada', { onlineUserIds });
  };

  io.on('connection', (socket) => {
    console.log(`📡 [Socket.io] Nuevo cliente conectado: ${socket.id}`);
    
    // Opcional: El cliente puede unirse a una "sala" (room) por sede o por rol
    socket.on('join_sede', (sedeId) => {
      socket.join(`sede_${sedeId}`);
      console.log(`[Socket.io] Cliente ${socket.id} se unió a la sala sede_${sedeId}`);
    });

    // Sala de espera para usuarios recién registrados pendientes de aprobación
    socket.on('join_pending_user', (userId) => {
      if (userId) {
        socket.join(`pending_user_${userId}`);
        console.log(`[Socket.io] Usuario pendiente #${userId} esperando aprobación en sala pending_user_${userId}`);
      }
    });

    // Presencia en tiempo real de usuarios autenticados
    socket.on('register_presence', (data) => {
      const uid = Number(data?.userId);
      if (!uid) return;
      socket.data.userId = uid;
      if (!onlineUsers.has(uid)) {
        onlineUsers.set(uid, new Set());
      }
      onlineUsers.get(uid).add(socket.id);
      socket.join(`user_${uid}`);
      broadcastPresence();
    });

    socket.on('leave_presence', () => {
      const uid = socket.data.userId;
      if (uid && onlineUsers.has(uid)) {
        onlineUsers.get(uid).delete(socket.id);
        if (onlineUsers.get(uid).size === 0) {
          onlineUsers.delete(uid);
        }
        socket.data.userId = null;
        broadcastPresence();
      }
    });

    socket.on('disconnect', () => {
      const uid = socket.data.userId;
      if (uid && onlineUsers.has(uid)) {
        onlineUsers.get(uid).delete(socket.id);
        if (onlineUsers.get(uid).size === 0) {
          onlineUsers.delete(uid);
        }
        broadcastPresence();
      }
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
    
    // Iniciar servicio de respaldos automáticos
    initBackupScheduler();
  });
};

startServer();
