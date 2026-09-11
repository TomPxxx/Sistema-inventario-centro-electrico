import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { config } from '../config/env.js';
import { initializeDatabase } from '../database/initDb.js';

/**
 * Iniciar sesión (Login)
 * POST /api/auth/login
 * Body: { username, password }
 */
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor, ingresa tu nombre de usuario y contraseña.'
      });
    }

    const trimmedUser = username.trim();

    // Buscamos el usuario por su username o por su email
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre_completo, u.username, u.email, u.password_hash, u.rol, 
              u.sede_id, u.estado, u.ultimo_login, s.nombre AS sede_nombre, s.direccion AS sede_direccion
       FROM usuarios u
       LEFT JOIN sedes s ON u.sede_id = s.id
       WHERE u.username = ? OR u.email = ?`,
      [trimmedUser, trimmedUser]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas. Verifica tu usuario o contraseña.'
      });
    }

    const user = rows[0];

    // Validación de estado activo
    if (user.estado !== 'ACTIVO') {
      return res.status(403).json({
        success: false,
        message: 'Tu cuenta de usuario está desactivada. Por favor, comunícate con el administrador.'
      });
    }

    // Comparación segura del hash de la contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas. Verifica tu usuario o contraseña.'
      });
    }

    // Actualizamos la fecha del último inicio de sesión en MySQL
    await pool.query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?', [user.id]);

    // Generamos el Token JWT firmado
    const payload = {
      id: user.id,
      username: user.username,
      rol: user.rol,
      sede_id: user.sede_id,
      sede_nombre: user.sede_nombre,
      sede_direccion: user.sede_direccion,
      nombre_completo: user.nombre_completo,
      email: user.email
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn
    });

    return res.status(200).json({
      success: true,
      message: 'Inicio de sesión exitoso.',
      token,
      user: {
        id: user.id,
        nombre_completo: user.nombre_completo,
        username: user.username,
        email: user.email,
        rol: user.rol,
        sede_id: user.sede_id,
        sede_nombre: user.sede_nombre,
        sede_direccion: user.sede_direccion,
        ultimo_login: user.ultimo_login
      }
    });
  } catch (error) {
    console.error('[Auth Error] Error en el proceso de login:', error);
    return res.status(500).json({
      success: false,
      message: 'Ocurrió un error interno en el servidor al intentar iniciar sesión.'
    });
  }
};

/**
 * Registro de nuevo usuario según cargo
 * POST /api/auth/register
 * Body: { nombre_completo, username, email, password, rol, sede_id }
 */
export const register = async (req, res) => {
  try {
    const { nombre_completo, username, email, password, rol, sede_id } = req.body;

    if (!nombre_completo || !username || !password || !rol) {
      return res.status(400).json({
        success: false,
        message: 'Campos requeridos: Nombre completo, Usuario, Contraseña y Cargo (Rol).'
      });
    }

    const validRoles = ['ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'];
    const selectedRol = rol.toUpperCase();
    if (!validRoles.includes(selectedRol)) {
      return res.status(400).json({
        success: false,
        message: `Rol no válido. Debe ser uno de: ${validRoles.join(', ')}.`
      });
    }

    // Regla de negocio de la base de datos:
    // ENCARGADO debe tener sede_id obligatoria
    // ADMINISTRADOR y EMPLEADO deben tener sede_id = NULL
    let finalSedeId = null;
    if (selectedRol === 'ENCARGADO') {
      if (!sede_id) {
        return res.status(400).json({
          success: false,
          message: 'Los usuarios con cargo ENCARGADO deben tener una sede asignada obligatoriamente.'
        });
      }
      finalSedeId = Number(sede_id);
    }

    const cleanUsername = username.trim();
    const cleanEmail = email ? email.trim().toLowerCase() : null;

    // Verificar unicidad de username y email
    const [existing] = await pool.query(
      'SELECT id, username, email FROM usuarios WHERE username = ? OR (email IS NOT NULL AND email = ?)',
      [cleanUsername, cleanEmail]
    );

    if (existing.length > 0) {
      const match = existing[0];
      if (match.username.toLowerCase() === cleanUsername.toLowerCase()) {
        return res.status(409).json({
          success: false,
          message: `El nombre de usuario '${cleanUsername}' ya está registrado. Elige otro.`
        });
      }
      if (cleanEmail && match.email && match.email.toLowerCase() === cleanEmail.toLowerCase()) {
        return res.status(409).json({
          success: false,
          message: `El correo electrónico '${cleanEmail}' ya está registrado en el sistema.`
        });
      }
    }

    // Encriptar contraseña con bcryptjs
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insertar en MySQL
    const [insertResult] = await pool.query(
      `INSERT INTO usuarios (nombre_completo, username, email, password_hash, rol, sede_id, estado)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVO')`,
      [nombre_completo.trim(), cleanUsername, cleanEmail, password_hash, selectedRol, finalSedeId]
    );

    // Consultar datos completos con la sede (si aplica)
    const [newUserRows] = await pool.query(
      `SELECT u.id, u.nombre_completo, u.username, u.email, u.rol, u.sede_id, u.estado, 
              s.nombre AS sede_nombre, s.direccion AS sede_direccion
       FROM usuarios u
       LEFT JOIN sedes s ON u.sede_id = s.id
       WHERE u.id = ?`,
      [insertResult.insertId]
    );

    const newUser = newUserRows[0];

    // Generar token JWT automático para login inmediato
    const payload = {
      id: newUser.id,
      username: newUser.username,
      rol: newUser.rol,
      sede_id: newUser.sede_id,
      sede_nombre: newUser.sede_nombre,
      sede_direccion: newUser.sede_direccion,
      nombre_completo: newUser.nombre_completo,
      email: newUser.email
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn
    });

    return res.status(201).json({
      success: true,
      message: `Usuario '${newUser.username}' registrado exitosamente con cargo ${newUser.rol}.`,
      token,
      user: newUser
    });
  } catch (error) {
    console.error('[Register Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al registrar el nuevo usuario: ' + error.message
    });
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
    const [rows] = await pool.query(
      'SELECT id, username, email, nombre_completo FROM usuarios WHERE username = ? OR email = ?',
      [clean, clean]
    );

    if (rows.length === 0) {
      // Por seguridad, informamos pero indicamos instrucciones
      return res.status(404).json({
        success: false,
        message: 'No se encontró ninguna cuenta asociada a este usuario o correo en la base de datos.'
      });
    }

    const user = rows[0];
    // Generar código numérico de 6 dígitos para recuperación rápida
    const recoveryPin = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    await pool.query(
      'UPDATE usuarios SET token_recuperacion = ?, token_recuperacion_expira = ? WHERE id = ?',
      [recoveryPin, expiresAt, user.id]
    );

    // Si tuviera servicio SMTP configurado, se despacha el correo aquí.
    // Retornamos simulación limpia para la interfaz del usuario:
    return res.status(200).json({
      success: true,
      message: `Se ha generado el código de recuperación para ${user.email || user.username}. En caso de que se te olvide, se envía al correo registrado.`,
      emailTarget: user.email || `${user.username}@grupoelectrico.com`,
      recoveryCodePreview: recoveryPin // Se expone en el modal para pruebas directas en local
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
    const [rows] = await pool.query(
      `SELECT id, username, email, token_recuperacion, token_recuperacion_expira 
       FROM usuarios 
       WHERE (username = ? OR email = ?) AND token_recuperacion = ?`,
      [clean, clean, pin.trim()]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Código de recuperación inválido o usuario incorrecto.'
      });
    }

    const user = rows[0];

    // Verificar si expiró
    if (new Date(user.token_recuperacion_expira) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'El código de recuperación ha expirado. Solicita uno nuevo.'
      });
    }

    // Hashear la nueva contraseña
    const saltRounds = 10;
    const newHash = await bcrypt.hash(newPassword, saltRounds);

    // Actualizar y limpiar token
    await pool.query(
      'UPDATE usuarios SET password_hash = ?, token_recuperacion = NULL, token_recuperacion_expira = NULL WHERE id = ?',
      [newHash, user.id]
    );

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
    const [sedes] = await pool.query(
      'SELECT id, nombre, ciudad, direccion, telefono FROM sedes WHERE activo = TRUE ORDER BY id ASC'
    );
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
