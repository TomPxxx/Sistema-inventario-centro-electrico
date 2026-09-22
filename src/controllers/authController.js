import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { initializeDatabase } from '../database/initDb.js';
import UserRepository from '../repositories/UserRepository.js';
import SedeRepository from '../repositories/SedeRepository.js';

// Configuración de la cookie compartida
const cookieOptions = {
  httpOnly: true, // No accesible mediante JavaScript (Previene XSS)
  secure: config.nodeEnv === 'production', // Solo HTTPS en producción
  sameSite: 'strict', // Previene ataques CSRF
  maxAge: 12 * 60 * 60 * 1000 // 12 horas en milisegundos
};

// Versión actual de la política de tratamiento de datos
const CURRENT_POLICY_VERSION = 'v1.0';

/**
 * Iniciar sesión (Login)
 * POST /api/auth/login
 * Body: { username, password, _honey }
 */
export const login = async (req, res) => {
  try {
    const { username, password, _honey } = req.body;

    // Validación Honeypot (Trampa anti-bots)
    // Si el campo oculto '_honey' tiene algún valor, asumimos que es un bot automatizado
    if (_honey) {
      console.warn(`[Seguridad] Intento de login bloqueado por Honeypot. IP: ${req.ip}`);
      // Simulamos un error genérico o tardamos en responder para despistar al bot
      return res.status(401).json({ success: false, message: 'Por favor, ingresa tu nombre de usuario y contraseña.' });
    }

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Por favor, ingresa tu nombre de usuario y contraseña.' });
    }

    const trimmedUser = username.trim();
    const user = await UserRepository.findByUsernameOrEmail(trimmedUser);

    if (!user) {
      return res.status(401).json({ success: false, error_type: 'USER_NOT_FOUND', message: 'Usuario no encontrado.' });
    }

    if (user.estado !== 'ACTIVO') {
      return res.status(403).json({ success: false, message: 'Tu cuenta está desactivada.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, error_type: 'INVALID_PASSWORD', message: 'Contraseña incorrecta.' });
    }

    // Verificar política de datos
    const hasAcceptedPolicy = await UserRepository.hasAcceptedPolicy(user.id, CURRENT_POLICY_VERSION);

    await UserRepository.updateLastLogin(user.id);

    const payload = {
      id: user.id, username: user.username, rol: user.rol,
      sede_id: user.sede_id, sede_nombre: user.sede_nombre,
      sede_direccion: user.sede_direccion, nombre_completo: user.nombre_completo,
      email: user.email
    };

    const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

    // Guardamos el token en una cookie segura
    res.cookie('token', token, cookieOptions);

    return res.status(200).json({
      success: true,
      message: 'Inicio de sesión exitoso.',
      requires_policy_acceptance: !hasAcceptedPolicy,
      current_policy_version: CURRENT_POLICY_VERSION,
      user: { ...payload, ultimo_login: new Date() }
    });
  } catch (error) {
    console.error('[Auth Error] Error en login:', error);
    return res.status(500).json({ success: false, message: 'Error interno al intentar iniciar sesión.' });
  }
};

/**
 * Cerrar sesión (Logout)
 * POST /api/auth/logout
 */
export const logout = async (req, res) => {
  // Para destruir la sesión, simplemente limpiamos la cookie 'token'
  res.clearCookie('token', { ...cookieOptions, maxAge: 0 });
  return res.status(200).json({
    success: true,
    message: 'Sesión finalizada correctamente.'
  });
};

/**
 * Registro de nuevo usuario según cargo
 * POST /api/auth/register
 */
export const register = async (req, res) => {
  try {
    const { nombre_completo, username, email, password, rol, sede_id, _honey } = req.body;

    // Validación Honeypot en el registro
    if (_honey) {
      console.warn(`[Seguridad] Intento de registro bloqueado por Honeypot. IP: ${req.ip}`);
      return res.status(400).json({ success: false, message: 'Solicitud inválida.' });
    }

    const selectedRol = rol.toUpperCase();

    let finalSedeId = null;
    if (selectedRol === 'ENCARGADO') {
      finalSedeId = Number(sede_id);
    }

    const cleanUsername = username.trim();
    const cleanEmail = email ? email.trim().toLowerCase() : null;

    const existing = await UserRepository.checkExists(cleanUsername, cleanEmail);
    if (existing.length > 0) return res.status(409).json({ success: false, message: 'El usuario o email ya existe.' });

    const password_hash = await bcrypt.hash(password, 10);

    const insertId = await UserRepository.create({
      nombre_completo: nombre_completo.trim(), username: cleanUsername, email: cleanEmail,
      password_hash, rol: selectedRol, sede_id: finalSedeId
    });

    const newUser = await UserRepository.findById(insertId);

    const payload = {
      id: newUser.id, username: newUser.username, rol: newUser.rol,
      sede_id: newUser.sede_id, sede_nombre: newUser.sede_nombre,
      sede_direccion: newUser.sede_direccion, nombre_completo: newUser.nombre_completo,
      email: newUser.email
    };

    const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    
    // Iniciar sesión automáticamente tras el registro
    res.cookie('token', token, cookieOptions);

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente.',
      user: newUser
    });
  } catch (error) {
    console.error('[Register Error]:', error);
    return res.status(500).json({ success: false, message: 'Error interno.' });
  }
};

/**
 * Aceptar la política de tratamiento de datos
 * POST /api/auth/accept-policy
 */
export const acceptPolicy = async (req, res) => {
  try {
    const userId = req.user.id;
    const { version } = req.body;

    if (!version) {
      return res.status(400).json({ success: false, message: 'La versión de la política es requerida.' });
    }

    await UserRepository.acceptPolicy(userId, version);

    return res.status(200).json({
      success: true,
      message: 'Política aceptada exitosamente.'
    });
  } catch (error) {
    console.error('[Policy Error]:', error);
    return res.status(500).json({ success: false, message: 'Error interno al registrar la política.' });
  }
};

/**
 * Solicitud de recuperación de contraseña por correo/usuario
 * POST /api/auth/forgot-password
 * Body: { identifier } (email o username)
 */
export const forgotPassword = async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Ingresa tu correo corporativo o tu nombre de usuario para recuperar tu contraseña.'
      });
    }

    const clean = identifier.trim();
    const user = await UserRepository.findByUsernameOrEmail(clean);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No se encontró ninguna cuenta asociada a este usuario o correo en la base de datos.'
      });
    }

    const recoveryPin = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    await UserRepository.setRecoveryToken(user.id, recoveryPin, expiresAt);

    return res.status(200).json({
      success: true,
      message: `Se ha generado el código de recuperación para ${user.email || user.username}. En caso de que se te olvide, se envía al correo registrado.`,
      emailTarget: user.email || `${user.username}@grupoelectrico.com`,
      recoveryCodePreview: recoveryPin
    });
  } catch (error) {
    console.error('[Forgot Password Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar la solicitud de recuperación.'
    });
  }
};

/**
 * Confirmar y restablecer contraseña con el código
 * POST /api/auth/reset-password
 * Body: { identifier, pin, newPassword }
 */
export const resetPassword = async (req, res) => {
  try {
    const { identifier, pin, newPassword } = req.body;
    if (!identifier || !pin || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Todos los campos son obligatorios: Identificador, Código PIN y Nueva Contraseña.'
      });
    }

    const clean = identifier.trim();
    const user = await UserRepository.findByRecoveryToken(clean, pin.trim());

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Código de recuperación inválido o usuario incorrecto.'
      });
    }

    if (new Date(user.token_recuperacion_expira) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'El código de recuperación ha expirado. Solicita uno nuevo.'
      });
    }

    const saltRounds = 10;
    const newHash = await bcrypt.hash(newPassword, saltRounds);

    await UserRepository.resetPasswordAndClearToken(user.id, newHash);

    return res.status(200).json({
      success: true,
      message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión con tu nueva contraseña.'
    });
  } catch (error) {
    console.error('[Reset Password Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al restablecer la contraseña.'
    });
  }
};

/**
 * Obtener listado de sedes activas
 * GET /api/auth/sedes
 */
export const getSedesList = async (req, res) => {
  try {
    const sedes = await SedeRepository.findAllActive();
    return res.status(200).json({
      success: true,
      sedes
    });
  } catch (error) {
    console.error('[Get Sedes Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener las sedes del sistema.'
    });
  }
};

/**
 * Obtener perfil del usuario autenticado (validar token)
 * GET /api/auth/me
 */
export const getProfile = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error('[Auth Error] Error al obtener perfil:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener el perfil de usuario.'
    });
  }
};

/**
 * Endpoint para inicializar o restaurar la base de datos desde el software
 * POST /api/auth/init-db
 */
export const handleInitDb = async (req, res) => {
  try {
    const result = await initializeDatabase();
    return res.status(200).json({
      success: true,
      message: 'Base de datos y datos de prueba inicializados correctamente desde el script SQL.',
      result
    });
  } catch (error) {
    console.error('[Init DB Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al inicializar la base de datos: ' + error.message
    });
  }
};
