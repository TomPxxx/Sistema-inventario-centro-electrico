import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { pool } from '../config/db.js';

/**
 * Middleware para validar el token JWT en las peticiones que requieren autenticación.
 */
export const authenticateJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Acceso no autorizado. Se requiere un token Bearer válido.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    // Opcional: verificar que el usuario siga existiendo y esté ACTIVO en la BD
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre_completo, u.username, u.email, u.rol, u.sede_id, u.estado, s.nombre AS sede_nombre
       FROM usuarios u
       LEFT JOIN sedes s ON u.sede_id = s.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'El usuario asociado a este token ya no existe.'
      });
    }

    const user = rows[0];

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
      return res.status(401).json({
        success: false,
        message: 'La sesión ha expirado. Por favor, inicia sesión nuevamente.',
        code: 'TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Token inválido o corrupto.'
    });
  }
};
