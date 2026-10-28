import { Router } from 'express';
import { notificationSystem } from '../utils/NotificationObserver.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';

const router = Router();

// Endpoint SSE para suscribirse a notificaciones
// Requiere autenticación para saber a quién enviarle qué
router.get('/stream', authenticateJWT, (req, res) => {
  notificationSystem.subscribe(req, res);
});

// Endpoint SSE para usuarios en espera de aprobación del administrador
router.get('/pending-stream/:userId', (req, res) => {
  notificationSystem.subscribePending(req, res, req.params.userId);
});

export default router;
