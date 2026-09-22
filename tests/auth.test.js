import request from 'supertest';
import app from '../src/app.js';

describe('Auth Endpoints', () => {

  describe('POST /api/auth/register', () => {
    
    it('debería bloquear el registro si el honeypot (_honey) está lleno', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          nombre_completo: 'Bot Malicioso',
          username: 'bot_123',
          password: 'passwordSeguro123',
          rol: 'EMPLEADO',
          _honey: 'soy_un_bot_revisando_campos'
        });

      // El Honeypot debería interceptarlo y devolver 400
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Solicitud inválida.');
    });

    it('debería rechazar el registro si falla la validación de Zod (contraseña corta)', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          nombre_completo: 'Usuario Real',
          username: 'usuario_real',
          password: '123', // Contraseña inválida (mínimo 6)
          rol: 'EMPLEADO'
        });

      // Zod debería devolver 400 con los errores
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Error de validación en los datos enviados');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ campo: 'body.password' })
        ])
      );
    });

    it('debería rechazar el registro si el rol ENCARGADO no envía sede_id', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          nombre_completo: 'Encargado Sin Sede',
          username: 'encargado_1',
          password: 'passwordValida123',
          rol: 'ENCARGADO'
          // Falta sede_id
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            campo: 'body.sede_id',
            mensaje: 'Los usuarios con cargo ENCARGADO deben tener una sede asignada obligatoriamente.'
          })
        ])
      );
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

      // El Honeypot en login devuelve 401 para despistar
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Por favor, ingresa tu nombre de usuario y contraseña.');
    });
  });

});
