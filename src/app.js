import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/index.js';
import { testConnection } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares globales
app.use(cors({
  origin: '*', // Permite peticiones desde frontend local o herramientas como Postman/ThunderClient
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
