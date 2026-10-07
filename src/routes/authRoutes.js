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
  acceptPolicy,
  verifyPassword,
  getRecaptchaConfig,
  googleLogin,
  getPendingUsers,
  approveUser,
  rejectUser
} from '../controllers/authController.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';
import { validate } from '../middlewares/validateMiddleware.js';
import { registerSchema } from '../validators/authValidator.js';
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  windowMs: 3 * 60 * 1000, // 3 minutos
  max: 10, // Máximo 10 intentos por IP
  message: { success: false, message: 'Demasiados intentos de autenticación, intente en 3 minutos.' }
});

const router = Router();

// Rutas públicas de autenticación y utilidades
router.get('/config/recaptcha', getRecaptchaConfig);
router.post('/login', authLimiter, login);
router.post('/google', authLimiter, googleLogin);
router.post('/logout', logout);
router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.get('/sedes', getSedesList);
router.post('/init-db', handleInitDb);

// Rutas protegidas por JWT
router.get('/me', authenticateJWT, getProfile);
router.post('/accept-policy', authenticateJWT, acceptPolicy);
router.post('/verify-password', authenticateJWT, verifyPassword);

// Rutas protegidas para aprobaciones (Solo Administrador)
router.get('/pending-users', authenticateJWT, authorizeRoles('ADMINISTRADOR'), getPendingUsers);
router.post('/approve', authenticateJWT, authorizeRoles('ADMINISTRADOR'), approveUser);
router.post('/reject', authenticateJWT, authorizeRoles('ADMINISTRADOR'), rejectUser);

export default router;
