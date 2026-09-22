import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import UserRepository from '../repositories/UserRepository.js';

/**
 * Middleware para validar el token JWT en las peticiones que requieren autenticación.
 */
export const authenticateJWT = async (req, res, next) => {
  // Ahora el token vendrá de la cookie httpOnly (Fase 2)
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Acceso no autorizado. Se requiere iniciar sesión.'
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    // Verificar que el usuario siga existiendo y esté ACTIVO usando el Repositorio
    const user = await UserRepository.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'El usuario asociado a esta sesión ya no existe.'
      });
    }

    if (user.estado !== 'ACTIVO') {
      return res.status(403).json({
        success: false,
        message: 'Tu cuenta de usuario ha sido desactivada. Contacta al administrador.'
      });
    }

    // Inyectamos el usuario decodificado y verificado en la petición
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      // Si expira, limpiamos la cookie de inmediato
      res.clearCookie('token', {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict'
      });
      return res.status(401).json({
        success: false,
        message: 'La sesión ha expirado por inactividad. Por favor, inicia sesión nuevamente.',
        code: 'TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Token inválido o corrupto.'
    });
  }
};

