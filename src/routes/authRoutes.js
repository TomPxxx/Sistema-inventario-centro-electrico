import { Router } from 'express';
import { 
  login, 
  logout,
  register, 
  forgotPassword, 
  resetPassword, 
  getSedesList, 
  getProfile, 
  handleInitDb,
  acceptPolicy
} from '../controllers/authController.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validateMiddleware.js';
import { registerSchema } from '../validators/authValidator.js';

const router = Router();

// Rutas públicas de autenticación y utilidades
router.post('/login', login);
router.post('/logout', logout);
router.post('/register', validate(registerSchema), register);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/sedes', getSedesList);
router.post('/init-db', handleInitDb);

// Rutas protegidas por JWT
router.get('/me', authenticateJWT, getProfile);
router.post('/accept-policy', authenticateJWT, acceptPolicy);

export default router;
