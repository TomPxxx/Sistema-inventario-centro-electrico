import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/index.js';
import { testConnection } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Seguridad HTTP con Helmet (CSP desactivado para evitar conflictos con CDNs)
app.use(helmet({ 
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginEmbedderPolicy: false
}));

// Confiar en proxies para evitar bloqueos por misma IP (Localtunnel, Nginx, NAT)
app.set('trust proxy', 1);

// Rate Limiting Global (Prevención de DDoS adaptada a multi-dispositivos)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1500, // 1500 solicitudes por ventana para soportar múltiples cajeros simultáneos
  message: { success: false, message: 'Demasiadas solicitudes desde esta IP.' }
});

// Forzar HTTPS en producción
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https' && !req.secure) {
    return res.redirect(`https://${req.hostname}${req.url}`);
  }
  next();
});

app.use('/api', globalLimiter);

// Middlewares globales
app.use(cors({
  origin: 'http://localhost:5173', // Cambiado temporalmente a un origen explícito para permitir cookies (credentials: true)
  credentials: true, // Importante para enviar/recibir cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir archivos estáticos del frontend desde la carpeta 'public'
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Ruta raíz explícita para servir la interfaz
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Verificación de salud y estado general
app.get('/api/health', async (req, res) => {
  const isDbConnected = await testConnection();
  res.status(isDbConnected ? 200 : 503).json({
    status: isDbConnected ? 'UP' : 'DATABASE_DOWN',
    timestamp: new Date().toISOString(),
    database: isDbConnected ? 'Connected' : 'Disconnected'
  });
});

import fs from 'fs';

app.post('/api/debug-log', (req, res) => {
  const logStr = `[${new Date().toISOString()}] CLIENT-SIDE DEBUG LOG: ${JSON.stringify(req.body)}\n`;
  console.log("🚨", logStr);
  fs.appendFileSync('debug.log', logStr);
  res.sendStatus(200);
});

// Enrutador principal de la API
app.use('/api', apiRouter);

// Manejador de rutas no encontradas (404)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: [${req.method}] ${req.originalUrl}`
  });
});

// Manejador global de errores (500)
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Ocurrió un error inesperado en el servidor.',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

export default app;
