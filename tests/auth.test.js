import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import UserRepository from '../src/repositories/UserRepository.js';
import AuditRepository from '../src/repositories/AuditRepository.js';
import { config } from '../src/config/env.js';

function buildMathCaptchaToken() {
  const answer = '10';
  const ts = Date.now();
  const payload = `${answer}-${ts}`;
  const sig = crypto.createHmac('sha256', config.jwt.secret).update(payload).digest('hex');
  return `math:${answer}:${payload}.${sig}`;
}

describe('Auth Endpoints & Mandatory Admin Approval', () => {
  const testUsername = 'nuevo_usuario_pendiente';
  const testEmail = 'nuevo_pendiente@grupoelectrico.com';
  const testPassword = 'PasswordSegura123!';
  let storedPendingUser = null;

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('debería bloquear el registro si el honeypot (_honey) está lleno', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          nombre_completo: 'Bot Malicioso',
          username: 'bot_123',
          password: 'PasswordSegura123!',
          _honey: 'soy_un_bot_revisando_campos'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Solicitud inválida.');
    });

    it('debería rechazar el registro si falla la validación de Zod (contraseña débil)', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          nombre_completo: 'Usuario Real',
          username: 'usuario_real',
          password: '123'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Error de validación en los datos enviados');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ campo: 'body.password' })
        ])
      );
    });

    it('debería crear el usuario nuevo en estado PENDIENTE, sin rol ni sede y SIN cookie JWT ni sesión', async () => {
      jest.spyOn(UserRepository, 'checkExists').mockResolvedValue([]);
      const createSpy = jest.spyOn(UserRepository, 'create').mockImplementation(async (userData) => {
        storedPendingUser = {
          id: 999,
          ...userData
        };
        return 999;
      });
      jest.spyOn(UserRepository, 'findById').mockImplementation(async () => ({
        id: 999,
        nombre_completo: storedPendingUser.nombre_completo,
        username: storedPendingUser.username,
        email: storedPendingUser.email,
        rol: storedPendingUser.rol,
        sede_id: storedPendingUser.sede_id,
        estado: storedPendingUser.estado,
        auth_provider: storedPendingUser.auth_provider,
        current_session_token: null
      }));
      const updateSessionSpy = jest.spyOn(UserRepository, 'updateSessionToken').mockResolvedValue();
      jest.spyOn(AuditRepository, 'logAction').mockResolvedValue();

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          nombre_completo: 'Usuario Nuevo Prueba',
          username: testUsername,
          email: testEmail,
          password: testPassword,
          rol: 'ADMINISTRADOR', // Intento de auto-asignar rol que debe ser ignorado
          sede_id: 1
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('PENDIENTE');
      expect(response.body.requires_approval).toBe(true);
      expect(response.body.token).toBeUndefined();
      expect(response.body.user).toBeDefined();
      expect(response.body.user.estado).toBe('PENDIENTE');
      expect(response.body.user.rol).toBeNull();
      expect(response.body.user.sede_id).toBeNull();

      // Falla si se crea con rol activo o sede o si se genera token de sesión
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          username: testUsername,
          rol: 'PENDIENTE',
          sede_id: null,
          estado: 'PENDIENTE'
        })
      );
      expect(updateSessionSpy).not.toHaveBeenCalled();

      // Falla si el registro entrega cookie JWT
      const setCookieHeader = response.headers['set-cookie'] || [];
      const hasTokenCookie = setCookieHeader.some(c => c.startsWith('token='));
      expect(hasTokenCookie).toBe(false);
    });
  });

  describe('POST /api/auth/login', () => {
    it('debería bloquear el login si el honeypot (_honey) está lleno', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'password_admin',
          _honey: 'bot_login'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Por favor, ingresa tu nombre de usuario y contraseña.');
    });

    it('debería rechazar el login de un usuario PENDIENTE (403) y NO emitir cookie JWT', async () => {
      const password_hash = await bcrypt.hash(testPassword, 10);
      jest.spyOn(UserRepository, 'findByUsernameOrEmail').mockResolvedValue({
        id: 999,
        nombre_completo: 'Usuario Nuevo Prueba',
        username: testUsername,
        email: testEmail,
        password_hash,
        rol: 'PENDIENTE',
        sede_id: null,
        estado: 'PENDIENTE'
      });
      const updateSessionSpy = jest.spyOn(UserRepository, 'updateSessionToken').mockResolvedValue();

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUsername,
          password: testPassword,
          recaptchaToken: buildMathCaptchaToken()
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.status).toBe('PENDIENTE');
      expect(response.body.error_type).toBe('ACCOUNT_PENDING');
      expect(response.body.token).toBeUndefined();
      expect(updateSessionSpy).not.toHaveBeenCalled();

      const setCookieHeader = response.headers['set-cookie'] || [];
      const hasTokenCookie = setCookieHeader.some(c => c.startsWith('token='));
      expect(hasTokenCookie).toBe(false);
    });

    it('debería mantener los mensajes de error específicos de login (USER_NOT_FOUND e INVALID_PASSWORD)', async () => {
      jest.spyOn(UserRepository, 'findByUsernameOrEmail').mockResolvedValueOnce(null);

      const resNotFound = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'usuario_inexistente_xyz_999',
          password: testPassword,
          recaptchaToken: buildMathCaptchaToken()
        });

      expect(resNotFound.status).toBe(401);
      expect(resNotFound.body.success).toBe(false);
      expect(resNotFound.body.error_type).toBe('USER_NOT_FOUND');
      expect(resNotFound.body.message).toBe('Usuario no encontrado.');

      const password_hash = await bcrypt.hash(testPassword, 10);
      jest.spyOn(UserRepository, 'findByUsernameOrEmail').mockResolvedValueOnce({
        id: 1,
        nombre_completo: 'Admin Activo',
        username: 'tomas_admin',
        password_hash,
        rol: 'ADMINISTRADOR',
        sede_id: null,
        estado: 'ACTIVO'
      });

      const resWrongPass = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'tomas_admin',
          password: 'PasswordIncorrecta999!',
          recaptchaToken: buildMathCaptchaToken()
        });

      expect(resWrongPass.status).toBe(401);
      expect(resWrongPass.body.success).toBe(false);
      expect(resWrongPass.body.error_type).toBe('INVALID_PASSWORD');
      expect(resWrongPass.body.message).toBe('Contraseña incorrecta.');
    });
  });

  describe('Security Hardening (init-db & forgot-password)', () => {
    it('debería bloquear POST /api/auth/init-db sin autenticación de Administrador (401)', async () => {
      const res = await request(app).post('/api/auth/init-db');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('NO debería exponer recoveryCodePreview en la respuesta pública de POST /api/auth/forgot-password', async () => {
      jest.spyOn(UserRepository, 'findByUsernameOrEmail').mockResolvedValueOnce({
        id: 1,
        username: 'tomas_admin',
        email: 'tomas@grupoelectrico.com'
      });
      jest.spyOn(UserRepository, 'setRecoveryToken').mockResolvedValueOnce();
      jest.spyOn(AuditRepository, 'logAction').mockResolvedValueOnce();

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'tomas_admin' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.recoveryCodePreview).toBeUndefined();
    });
  });
});
