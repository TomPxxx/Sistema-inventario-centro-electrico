import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/env.js';
import { initializeDatabase } from '../database/initDb.js';
import UserRepository from '../repositories/UserRepository.js';
import SedeRepository from '../repositories/SedeRepository.js';
import AuditRepository from '../repositories/AuditRepository.js';
import { passwordSchema } from '../validators/authValidator.js';
import { notificationSystem } from '../utils/NotificationObserver.js';

const googleClient = new OAuth2Client(config.google.clientId);

// Configuración de la cookie compartida
const cookieOptions = {
  httpOnly: true, // No accesible mediante JavaScript (Previene XSS)
  secure: config.nodeEnv === 'production', // Solo HTTPS en producción
  sameSite: 'strict', // Previene ataques CSRF
  maxAge: 12 * 60 * 60 * 1000 // 12 horas en milisegundos
};

// Versión actual de la política de tratamiento de datos
const CURRENT_POLICY_VERSION = 'v1.0';

// Mapa de últimos tokens JWT emitidos por usuario para revocación directa desde el panel admin
const activeUserTokens = new Map();

/**
 * Iniciar sesión (Login)
 * POST /api/auth/login
 * Body: { username, password, _honey }
 */
export const login = async (req, res) => {
  try {
    const { username, password, _honey, recaptchaToken } = req.body;

    // Validación Honeypot (Trampa anti-bots)
    // Si el campo oculto '_honey' tiene algún valor, asumimos que es un bot automatizado
    if (_honey) {
      console.warn(`[Seguridad] Intento de login bloqueado por Honeypot. IP: ${req.ip}`);
      // Simulamos un error genérico o tardamos en responder para despistar al bot
      return res.status(401).json({ success: false, message: 'Por favor, ingresa tu nombre de usuario y contraseña.' });
    }

    if (config.recaptcha.secretKey) {
      if (!recaptchaToken) {
        return res.status(400).json({ success: false, message: 'Falta validación de seguridad. Por favor verifica que no eres un robot.' });
      }

      if (recaptchaToken.startsWith('math:')) {
        const parts = recaptchaToken.substring(5).split(':');
        if (parts.length === 2) {
          const userAnswer = parts[0];
          const tokenData = parts[1];
          
          const [payload, signature] = tokenData.split('.');
          const expectedSignature = crypto.createHmac('sha256', config.jwt.secret).update(payload).digest('hex');
          
          if (signature !== expectedSignature) {
            return res.status(401).json({ success: false, message: 'Reto matemático inválido (Firma incorrecta).' });
          }
          
          const [correctAnswer, ts] = payload.split('-');
          if (Date.now() - parseInt(ts) > 5 * 60 * 1000) {
            return res.status(401).json({ success: false, message: 'El reto matemático ha expirado. Recarga la página.' });
          }
          
          if (userAnswer !== correctAnswer) {
            return res.status(401).json({ success: false, message: 'Respuesta matemática incorrecta.' });
          }
        } else {
          return res.status(400).json({ success: false, message: 'Formato de reto inválido.' });
        }
      } else {
        const recaptchaVerifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${config.recaptcha.secretKey}&response=${recaptchaToken}`;
        const recaptchaRes = await fetch(recaptchaVerifyUrl, { method: 'POST' });
        const recaptchaData = await recaptchaRes.json();

        if (!recaptchaData.success) {
          console.warn(`[Seguridad] Intento de login fallido por reCAPTCHA. IP: ${req.ip}`);
          return res.status(401).json({ success: false, message: 'Validación de reCAPTCHA fallida. Intenta nuevamente.' });
        }
      }
    }

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Por favor, ingresa tu nombre de usuario y contraseña.' });
    }

    const trimmedUser = username.trim();
    const user = await UserRepository.findByUsernameOrEmail(trimmedUser);

    if (!user) {
      return res.status(401).json({ success: false, error_type: 'USER_NOT_FOUND', message: 'Usuario no encontrado.' });
    }

    if (user.estado === 'PENDIENTE') {
      return res.status(403).json({
        success: false,
        status: 'PENDIENTE',
        error_type: 'ACCOUNT_PENDING',
        message: 'Tu cuenta está pendiente de aprobación por un administrador.',
        user: {
          id: user.id,
          username: user.username,
          nombre_completo: user.nombre_completo,
          email: user.email,
          estado: 'PENDIENTE'
        }
      });
    }

    if (user.estado === 'RECHAZADO') {
      return res.status(403).json({
        success: false,
        status: 'RECHAZADO',
        error_type: 'ACCOUNT_REJECTED',
        message: 'Tu solicitud fue rechazada, contacta al administrador.'
      });
    }

    if (user.estado !== 'ACTIVO') {
      return res.status(403).json({ success: false, error_type: 'ACCOUNT_INACTIVE', message: 'Tu cuenta está desactivada.' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ success: false, error_type: 'INVALID_PASSWORD', message: 'Contraseña incorrecta.' });
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
      email: user.email,
      sessionToken: crypto.randomUUID()
    };

    await UserRepository.updateSessionToken(user.id, payload.sessionToken);

    const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    activeUserTokens.set(Number(user.id), token);

    // Guardamos el token en una cookie segura
    res.cookie('token', token, cookieOptions);

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.emit('usuario_nueva_sesion', {
        userId: user.id,
        sessionToken: payload.sessionToken
      });
    }

    await AuditRepository.logAction(user.id, user.username, 'LOGIN', 'Inicio de sesión exitoso', req.ip);

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
 * Iniciar sesión con Google (Google OAuth)
 * POST /api/auth/google
 */
export const googleLogin = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Falta el token de Google.' });

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload();
    const { email, name } = payload;

    let user = await UserRepository.findByUsernameOrEmail(email);

    if (!user) {
      // Primer login -> crear en estado PENDIENTE sin rol ni sede ni cookie JWT
      const newUserId = await UserRepository.createGoogleUser(name, email);
      user = await UserRepository.findById(newUserId);
      await AuditRepository.logAction(user.id, user.username, 'REGISTRO_PENDIENTE', 'Nuevo registro por Google pendiente de aprobación', req.ip);
      if (req.app.get('io')) {
        req.app.get('io').emit('nuevo_usuario_pendiente', {
          id: user.id,
          username: user.username,
          nombre_completo: user.nombre_completo,
          email: user.email,
          auth_provider: 'GOOGLE'
        });
      }
      return res.status(403).json({
        success: false,
        status: 'PENDIENTE',
        requires_approval: true,
        message: 'Tu cuenta ha sido registrada y está pendiente de aprobación por un administrador.',
        user: {
          id: user.id,
          username: user.username,
          nombre_completo: user.nombre_completo,
          email: user.email,
          rol: null,
          sede_id: null,
          estado: 'PENDIENTE',
          auth_provider: 'GOOGLE'
        }
      });
    }

    if (user.estado === 'PENDIENTE') {
      return res.status(403).json({
        success: false,
        status: 'PENDIENTE',
        requires_approval: true,
        message: 'Tu cuenta está pendiente de aprobación por un administrador.',
        user: {
          id: user.id,
          username: user.username,
          nombre_completo: user.nombre_completo,
          email: user.email,
          rol: null,
          sede_id: null,
          estado: 'PENDIENTE',
          auth_provider: user.auth_provider
        }
      });
    }

    if (user.estado === 'RECHAZADO') {
      return res.status(403).json({ success: false, status: 'RECHAZADO', message: 'Tu solicitud fue rechazada, contacta al administrador.' });
    }

    if (user.estado !== 'ACTIVO') {
      return res.status(403).json({ success: false, message: 'Tu cuenta está inactiva.' });
    }

    // Si existía como LOCAL, actualizar a AMBOS (coexistencia)
    if (user.auth_provider === 'LOCAL') {
      await UserRepository.updateAuthProvider(user.id, 'AMBOS');
    }

    // Login exitoso
    const hasAcceptedPolicy = await UserRepository.hasAcceptedPolicy(user.id, CURRENT_POLICY_VERSION);
    await UserRepository.updateLastLogin(user.id);

    const jwtPayload = {
      id: user.id, username: user.username, rol: user.rol,
      sede_id: user.sede_id, sede_nombre: user.sede_nombre,
      sede_direccion: user.sede_direccion, nombre_completo: user.nombre_completo,
      email: user.email,
      sessionToken: crypto.randomUUID()
    };

    await UserRepository.updateSessionToken(user.id, jwtPayload.sessionToken);

    const jwtToken = jwt.sign(jwtPayload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    activeUserTokens.set(Number(user.id), jwtToken);
    res.cookie('token', jwtToken, cookieOptions);

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.emit('usuario_nueva_sesion', {
        userId: user.id,
        sessionToken: jwtPayload.sessionToken
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Inicio de sesión con Google exitoso.',
      requires_policy_acceptance: !hasAcceptedPolicy,
      current_policy_version: CURRENT_POLICY_VERSION,
      user: { ...jwtPayload, ultimo_login: new Date() }
    });

  } catch (error) {
    console.error('Google Auth Error:', error);
    return res.status(500).json({ success: false, message: 'Error de autenticación con Google.' });
  }
};


/**
 * Cerrar sesión (Logout)
 * POST /api/auth/logout
 */
export const logout = async (req, res) => {
  try {
    const token = req.cookies.token || (req.headers.authorization ? req.headers.authorization.split(' ')[1] : null);
    
    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwt.secret);
        await AuditRepository.logAction(decoded.id, decoded.username, 'LOGOUT', 'Cierre de sesión', req.ip);
      } catch(e) {} // Ignore invalid tokens during logout
      await UserRepository.blacklistToken(token);
    }
    
    res.clearCookie('token', { ...cookieOptions, maxAge: 0 });
    return res.status(200).json({
      success: true,
      message: 'Sesión finalizada correctamente.'
    });
  } catch (error) {
    console.error('[Auth Error] Error en logout:', error);
    res.clearCookie('token', { ...cookieOptions, maxAge: 0 });
    return res.status(500).json({ success: false, message: 'Error interno al intentar cerrar sesión.' });
  }
};

/**
 * Registro de nuevo usuario (siempre en estado PENDIENTE, sin rol ni sede ni cookie JWT)
 * POST /api/auth/register
 */
export const register = async (req, res) => {
  try {
    const { nombre_completo, username, email, password, _honey } = req.body;

    // Validación Honeypot en el registro
    if (_honey) {
      console.warn(`[Seguridad] Intento de registro bloqueado por Honeypot. IP: ${req.ip}`);
      return res.status(400).json({ success: false, message: 'Solicitud inválida.' });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email ? email.trim().toLowerCase() : null;

    const existing = await UserRepository.checkExists(cleanUsername, cleanEmail);
    if (existing.length > 0) return res.status(409).json({ success: false, message: 'El usuario o email ya existe.' });

    const password_hash = await bcrypt.hash(password, 10);

    // Todo usuario nuevo se crea en estado PENDIENTE, sin rol asignado ('PENDIENTE' en BD) ni sede (NULL)
    const insertId = await UserRepository.create({
      nombre_completo: nombre_completo.trim(),
      username: cleanUsername,
      email: cleanEmail,
      password_hash,
      rol: 'PENDIENTE',
      sede_id: null,
      estado: 'PENDIENTE',
      auth_provider: 'LOCAL'
    });

    const newUser = await UserRepository.findById(insertId);

    await AuditRepository.logAction(
      newUser.id,
      newUser.username,
      'REGISTRO_PENDIENTE',
      'Nuevo usuario registrado en espera de aprobación del administrador',
      req.ip
    );

    if (req.app.get('io')) {
      req.app.get('io').emit('nuevo_usuario_pendiente', {
        id: newUser.id,
        username: newUser.username,
        nombre_completo: newUser.nombre_completo,
        email: newUser.email,
        auth_provider: 'LOCAL'
      });
    }

    // NO se genera token JWT ni se asigna cookie de sesión hasta que el administrador lo apruebe
    return res.status(201).json({
      success: true,
      status: 'PENDIENTE',
      requires_approval: true,
      message: 'Tu cuenta ha sido registrada y está pendiente de aprobación por un administrador.',
      user: {
        id: newUser.id,
        username: newUser.username,
        nombre_completo: newUser.nombre_completo,
        email: newUser.email,
        rol: null,
        sede_id: null,
        estado: 'PENDIENTE',
        auth_provider: newUser.auth_provider
      }
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

    const passwordValidation = passwordSchema.safeParse(newPassword);
    if (!passwordValidation.success) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.error.errors[0]?.message || 'La contraseña no cumple con la política de seguridad.'
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

/**
 * Verificar contraseña para desbloquear pantalla (Inactividad)
 * POST /api/auth/verify-password
 */
export const verifyPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Se requiere la contraseña.' });
    }

    const user = await UserRepository.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    // Necesitamos el password_hash para validar. findById no lo trae, usamos el byUsername
    const fullUser = await UserRepository.findByUsernameOrEmail(user.username);
    
    const isPasswordValid = await bcrypt.compare(password, fullUser.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
    }

    return res.status(200).json({ success: true, message: 'Sesión desbloqueada.' });
  } catch (error) {
    console.error('[Verify Password Error]:', error);
    return res.status(500).json({ success: false, message: 'Error interno.' });
  }
};

/**
 * Obtener configuración de reCAPTCHA para el frontend
 * GET /api/auth/config/recaptcha
 */
export const getRecaptchaConfig = (req, res) => {
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  const answer = num1 + num2;
  const timestamp = Date.now();
  
  const mathPayload = `${answer}-${timestamp}`;
  const mathSignature = crypto.createHmac('sha256', config.jwt.secret).update(mathPayload).digest('hex');
  const fallbackChallenge = `${num1} + ${num2}`;
  const fallbackToken = `${mathPayload}.${mathSignature}`;

  return res.status(200).json({
    success: true,
    siteKey: config.recaptcha.siteKey || '',
    googleClientId: config.google.clientId || '',
    fallbackChallenge,
    fallbackToken
  });
};

/**
 * Obtener usuarios pendientes de aprobación
 * GET /api/auth/pending-users
 */
export const getPendingUsers = async (req, res) => {
  try {
    const users = await UserRepository.findPendingUsers();
    return res.status(200).json({ success: true, users });
  } catch (error) {
    console.error('Error fetching pending users:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener usuarios.' });
  }
};

/**
 * Aprobar un usuario
 * POST /api/auth/approve
 */
export const approveUser = async (req, res) => {
  try {
    const { userId, rol, sedeId } = req.body;
    const validRoles = ['ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'];
    if (!userId || !validRoles.includes(rol)) {
      return res.status(400).json({ success: false, message: 'Debes seleccionar un rol válido (ADMINISTRADOR, ENCARGADO o EMPLEADO).' });
    }
    if (rol === 'ENCARGADO' && !sedeId) {
      return res.status(400).json({ success: false, message: 'El rol ENCARGADO requiere asignar una sede obligatoriamente.' });
    }
    const finalSedeId = (rol === 'ENCARGADO') ? Number(sedeId) : null;
    
    await UserRepository.approveUser(userId, rol, finalSedeId, req.user.id);
    const approvedUser = await UserRepository.findById(userId);

    const approvalEventPayload = {
      type: 'USUARIO_APROBADO',
      userId: Number(userId),
      username: approvedUser?.username,
      nombre_completo: approvedUser?.nombre_completo,
      rol,
      sede_id: finalSedeId,
      sede_nombre: approvedUser?.sede_nombre || null,
      message: '¡Registro exitoso! Tu cuenta ha sido aprobada por el administrador.'
    };

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`pending_user_${userId}`).emit('usuario_aprobado', approvalEventPayload);
      io.emit('usuario_aprobado', approvalEventPayload);
    }
    notificationSystem.notifyPendingUser(Number(userId), approvalEventPayload);

    await AuditRepository.logAction(req.user.id, req.user.username, 'APROBAR_USUARIO', `Aprobó al usuario ID ${userId} con rol ${rol}${finalSedeId ? ` y sede ${finalSedeId}` : ''}`, req.ip);
    return res.status(200).json({ success: true, message: 'Usuario aprobado exitosamente.', user: approvedUser });
  } catch (error) {
    console.error('Error approving user:', error);
    return res.status(500).json({ success: false, message: 'Error al aprobar usuario.' });
  }
};

/**
 * Rechazar un usuario
 * POST /api/auth/reject
 */
export const rejectUser = async (req, res) => {
  try {
    const { userId } = req.body;
    await UserRepository.rejectUser(userId, req.user.id);

    const rejectEventPayload = {
      type: 'USUARIO_RECHAZADO',
      userId: Number(userId),
      message: 'Tu solicitud de registro fue rechazada por el administrador.'
    };

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`pending_user_${userId}`).emit('usuario_rechazado', rejectEventPayload);
      io.emit('usuario_rechazado', rejectEventPayload);
    }
    notificationSystem.notifyPendingUser(Number(userId), rejectEventPayload);

    await AuditRepository.logAction(req.user.id, req.user.username, 'RECHAZAR_USUARIO', `Rechazó al usuario ID ${userId}`, req.ip);
    return res.status(200).json({ success: true, message: 'Usuario rechazado.' });
  } catch (error) {
    console.error('Error rejecting user:', error);
    return res.status(500).json({ success: false, message: 'Error al rechazar usuario.' });
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = await AuditRepository.getLogs(limit);
    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ success: false, message: 'Error fetching logs' });
  }
};

/**
 * Panel Admin: Obtener todos los usuarios con su estado en línea / desconectado (Socket.IO)
 * GET /api/auth/users
 */
export const getAllUsers = async (req, res) => {
  try {
    const users = await UserRepository.findAllUsers();
    const onlineUsersMap = req.app.get('onlineUsers');

    const enrichedUsers = users.map((u) => {
      const uid = Number(u.id);
      const isOnline = Boolean(onlineUsersMap && onlineUsersMap.has(uid) && onlineUsersMap.get(uid).size > 0);
      return {
        id: u.id,
        nombre_completo: u.nombre_completo,
        username: u.username,
        email: u.email,
        rol: u.rol,
        sede_id: u.sede_id,
        sede_nombre: u.sede_nombre,
        estado: u.estado,
        auth_provider: u.auth_provider,
        ultimo_login: u.ultimo_login,
        online: isOnline,
        has_active_session: Boolean(u.current_session_token || isOnline || activeUserTokens.has(uid))
      };
    });

    const onlineCount = enrichedUsers.filter((u) => u.online).length;

    return res.status(200).json({
      success: true,
      summary: {
        total: enrichedUsers.length,
        online: onlineCount,
        offline: enrichedUsers.length - onlineCount
      },
      users: enrichedUsers
    });
  } catch (error) {
    console.error('Error fetching all users:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener el listado de usuarios.' });
  }
};

/**
 * Panel Admin: Cerrar forzosamente la sesión de un usuario usando la blacklist existente y registrar en auditoría
 * POST /api/auth/users/:id/force-logout
 */
export const forceLogoutUser = async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'ID de usuario inválido.' });
    }

    const targetUser = await UserRepository.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    // 1. Agregar el JWT activo y/o el sessionToken actual a la tabla token_blacklist existente
    const activeJwt = activeUserTokens.get(targetUserId);
    if (activeJwt) {
      await UserRepository.blacklistToken(activeJwt);
      activeUserTokens.delete(targetUserId);
    }
    if (targetUser.current_session_token) {
      await UserRepository.blacklistToken(targetUser.current_session_token);
    }

    // 2. Limpiar el current_session_token del usuario en base de datos
    await UserRepository.updateSessionToken(targetUserId, null);

    // 3. Remover de presencia activa en Socket.IO y notificar cierre forzoso en tiempo real
    const onlineUsersMap = req.app.get('onlineUsers');
    if (onlineUsersMap && onlineUsersMap.has(targetUserId)) {
      onlineUsersMap.delete(targetUserId);
    }

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.emit('sesion_revocada_admin', {
        userId: targetUserId,
        username: targetUser.username,
        message: 'Tu sesión ha sido cerrada por un administrador.'
      });

      const onlineUserIds = [];
      if (onlineUsersMap) {
        for (const [uid, sockets] of onlineUsersMap.entries()) {
          if (sockets.size > 0) onlineUserIds.push(Number(uid));
        }
      }
      io.emit('presencia_usuarios_actualizada', { onlineUserIds });
    }

    // 4. Registrar acción en auditoría
    await AuditRepository.logAction(
      req.user.id,
      req.user.username,
      'CERRAR_SESION_USUARIO',
      `Cerró la sesión del usuario @${targetUser.username} (ID: ${targetUserId}) mediante blacklist`,
      req.ip
    );

    return res.status(200).json({
      success: true,
      message: `La sesión de @${targetUser.username} ha sido cerrada y revocada en la blacklist.`
    });
  } catch (error) {
    console.error('Error forcing logout on user:', error);
    return res.status(500).json({ success: false, message: 'Error interno al cerrar la sesión del usuario.' });
  }
};
