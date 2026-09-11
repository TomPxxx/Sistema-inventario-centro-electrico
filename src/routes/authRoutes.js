import { Router } from 'express';
import { 
  login, 
  register, 
  forgotPassword, 
  resetPassword, 
  getSedesList, 
  getProfile, 
  handleInitDb 
} from '../controllers/authController.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';

const router = Router();

// Rutas públicas de autenticación y utilidades
router.post('/login', login);
router.post('/register', register);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/sedes', getSedesList);
router.post('/init-db', handleInitDb);

// Rutas protegidas por JWT
router.get('/me', authenticateJWT, getProfile);

export default router;
