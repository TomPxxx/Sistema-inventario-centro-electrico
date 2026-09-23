import { Router } from 'express';
import { notificationSystem } from '../utils/NotificationObserver.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';

const router = Router();

// Endpoint SSE para suscribirse a notificaciones
// Requiere autenticación para saber a quién enviarle qué
router.get('/stream', authenticateJWT, (req, res) => {
  notificationSystem.subscribe(req, res);
});

export default router;
