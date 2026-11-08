import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import app from '../src/app.js';
import { pool as dbPool } from '../src/config/db.js';
import { config } from '../src/config/env.js';

/**
 * Helper para emitir un JWT válido y sincronizar current_session_token en BD
 * sin consumir el rate-limiter de /api/auth/login.
 */
async function issueSessionTokenForUser(username) {
  const { rows } = await dbPool.query(
    'SELECT id, username, rol, sede_id, estado FROM usuarios WHERE username = $1 LIMIT 1',
    [username]
  );
  const user = rows[0];
  if (!user) throw new Error(`Usuario ${username} no existe en BD`);

  const sessionToken = `eval-session-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await dbPool.query('UPDATE usuarios SET current_session_token = $1 WHERE id = $2', [sessionToken, user.id]);

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      rol: user.rol,
      sede_id: user.sede_id,
      sessionToken
    },
    config.jwt.secret,
    { expiresIn: '1h' }
  );

  return { user, token, sessionToken };
}

describe('Evaluación Integral Automatizada del Sistema (Frontend + Seguridad + Roles E2E)', () => {
  const createdUserIds = [];
  const createdProductIds = [];
  const createdCategoryIds = [];
  const createdSolicitudIds = [];
  const createdRecepcionIds = [];
  const savedSessionTokens = new Map();

  beforeAll(async () => {
    // Guardar session_tokens actuales de los usuarios corporativos para restaurarlos al terminar
    const { rows } = await dbPool.query(
      "SELECT id, username, current_session_token FROM usuarios WHERE username IN ('tomas_admin', 'encargado_ep', 'encargado_ep1', 'encargado_ep3', 'corredor_1', 'corredor_2', 'empleado_1')"
    );
    rows.forEach((r) => savedSessionTokens.set(r.id, r.current_session_token));
  });

  afterAll(async () => {
    // Limpiar todos los registros temporales de prueba sin dejar basura en la base de datos
    try {
      for (const recId of createdRecepcionIds) {
        await dbPool.query('DELETE FROM movimientos_inventario WHERE referencia_documento = $1', [`REC-${recId}`]);
        await dbPool.query('DELETE FROM recepcion_productos WHERE recepcion_id = $1', [recId]);
        await dbPool.query('DELETE FROM recepciones_mercancia WHERE id = $1', [recId]);
      }
      for (const solId of createdSolicitudIds) {
        await dbPool.query('DELETE FROM movimientos_inventario WHERE referencia_documento = $1', [`SOL-${solId}`]);
        await dbPool.query('DELETE FROM traslados WHERE solicitud_id = $1', [solId]);
        await dbPool.query('DELETE FROM solicitudes_material WHERE id = $1', [solId]);
      }
      for (const prodId of createdProductIds) {
        await dbPool.query('DELETE FROM movimientos_inventario WHERE producto_id = $1', [prodId]);
        await dbPool.query('DELETE FROM traslados WHERE producto_id = $1', [prodId]);
        await dbPool.query('DELETE FROM producto_sede WHERE producto_id = $1', [prodId]);
        await dbPool.query('DELETE FROM productos WHERE id = $1', [prodId]);
      }
      for (const catId of createdCategoryIds) {
        await dbPool.query('DELETE FROM categorias WHERE id = $1', [catId]);
      }
      for (const uId of createdUserIds) {
        await dbPool.query('DELETE FROM usuarios WHERE id = $1', [uId]);
      }
      await dbPool.query("DELETE FROM audit_logs WHERE detalles LIKE '%[EVAL-TEST]%' OR username LIKE 'eval_user_%'");

      // Restaurar current_session_token de los usuarios reales para no cerrar la sesión abierta del usuario
      for (const [id, tok] of savedSessionTokens.entries()) {
        await dbPool.query('UPDATE usuarios SET current_session_token = $1 WHERE id = $2', [tok, id]);
      }
    } catch (e) {
      console.error('Error limpiando datos de evaluación:', e);
    } finally {
      await dbPool.end();
    }
  });

  // ===========================================================================
  // 1. INTEGRIDAD DE INTERFAZ, DOM, ACTIVOS Y BLOQUEO DE AUTO-LOGIN EN PESTAÑA
  // ===========================================================================
  describe('1. Auditoría de Interfaz, Activos Locales y No-Auto-Login', () => {
    const publicDir = path.join(process.cwd(), 'public');
    const htmlContent = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const appJsContent = fs.readFileSync(path.join(publicDir, 'js', 'app.js'), 'utf8');
    const swContent = fs.readFileSync(path.join(publicDir, 'service-worker.js'), 'utf8');

    it('NO debe tener ningún ID duplicado en public/index.html', () => {
      const idRegex = /\bid="([^"]+)"/g;
      const seen = new Map();
      const duplicates = [];
      let match;
      while ((match = idRegex.exec(htmlContent)) !== null) {
        const id = match[1];
        if (seen.has(id)) {
          duplicates.push(id);
        }
        seen.set(id, true);
      }
      expect(duplicates).toEqual([]);
    });

    it('debe tener todos los archivos del Service Worker físicamente en public/', () => {
      const listMatch = swContent.match(/ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\]/);
      expect(listMatch).not.toBeNull();
      const urls = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(urls.length).toBeGreaterThanOrEqual(8);

      for (const u of urls) {
        if (u === '/') continue;
        const filePath = path.join(publicDir, u.replace(/^\//, ''));
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    it('debe mantener bloqueado el auto-login en checkSavedSession() para no abrir sesiones en otras pestañas', () => {
      const fnMatch = appJsContent.match(/async function checkSavedSession\(\)\s*\{([\s\S]*?)\}/);
      expect(fnMatch).not.toBeNull();
      const fnBody = fnMatch[1];
      // No debe llamar a fetch('/api/auth/me') ni launchSoftwareView
      expect(fnBody).not.toContain('launchSoftwareView');
      expect(fnBody).toContain('return;');
    });

    it('debe tener el selector de cámaras (#barcodeCameraSelect) y la librería local html5-qrcode.min.js', () => {
      expect(htmlContent).toContain('id="barcodeCameraSelect"');
      expect(htmlContent).toContain('./js/html5-qrcode.min.js');
      expect(fs.existsSync(path.join(publicDir, 'js', 'html5-qrcode.min.js'))).toBe(true);
      expect(appJsContent).toContain('filterEncargadoSearch(targetInput.value)');
    });
  });

  // ===========================================================================
  // 2. PENTESTING Y PRUEBAS DE SEGURIDAD (RBAC, MAGIC BYTES, BLACKLIST, DOBLE SESIÓN)
  // ===========================================================================
  describe('2. Pentesting de Seguridad, RBAC, Blacklist y Archivos Maliciosos', () => {
    it('debe bloquear escalada de privilegios: EMPLEADO y ENCARGADO no pueden usar rutas de ADMINISTRADOR', async () => {
      const emp = await issueSessionTokenForUser('corredor_1');
      const enc = await issueSessionTokenForUser('encargado_ep1');

      const adminEndpoints = [
        { method: 'get', url: '/api/auth/users' },
        { method: 'get', url: '/api/auth/pending-users' },
        { method: 'get', url: '/api/auth/audit-logs' },
        { method: 'post', url: '/api/auth/init-db' },
        { method: 'get', url: '/api/backup/download' },
        { method: 'post', url: '/api/inventory/products' }
      ];

      for (const ep of adminEndpoints) {
        const resEmp = await request(app)[ep.method](ep.url).set('Authorization', `Bearer ${emp.token}`);
        expect(resEmp.status).toBe(403);

        const resEnc = await request(app)[ep.method](ep.url).set('Authorization', `Bearer ${enc.token}`);
        expect(resEnc.status).toBe(403);
      }
    });

    it('debe bloquear intento de un ENCARGADO de sacar mercancía de una sede que NO es la suya (Cross-Branch Tampering)', async () => {
      const encEp1 = await issueSessionTokenForUser('encargado_ep1'); // Sede 2 (EP1)

      // Intentar transferir sacando stock desde Sede 1 (Centro Eléctrico EP) hacia Sede 2
      const res = await request(app)
        .post('/api/inventory/transfers')
        .set('Authorization', `Bearer ${encEp1.token}`)
        .send({
          producto_id: 1,
          sede_origen_id: 1, // No es su sede
          sede_destino_id: 2,
          cantidad: 1,
          observaciones: '[EVAL-TEST] Intento de robo de stock desde otra sede'
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Solo puedes enviar mercancía desde tu sede asignada/i);
    });

    it('debe rechazar un archivo ejecutable/script disfrazado de imagen .png (Magic Bytes Spoofing)', async () => {
      const admin = await issueSessionTokenForUser('tomas_admin');
      const fakePngBuffer = Buffer.from('#!/bin/bash\nrm -rf /\nconsole.log("malware");', 'utf8');

      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('image', fakePngBuffer, { filename: 'exploit.png', contentType: 'image/png' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/contenido binario real|firma binaria/i);
    });

    it('debe invalidar inmediatamente la sesión anterior cuando el mismo usuario inicia una nueva sesión (Doble Sesión)', async () => {
      const sesion1 = await issueSessionTokenForUser('corredor_1');
      const sesion2 = await issueSessionTokenForUser('corredor_1');

      // La sesión 1 debe fallar con 401 porque current_session_token cambió a sesion2
      const res1 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${sesion1.token}`);
      expect(res1.status).toBe(401);

      // La sesión 2 debe funcionar con 200
      const res2 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${sesion2.token}`);
      expect(res2.status).toBe(200);
    });
  });

  // ===========================================================================
  // 3. FLUJO END-TO-END DE LOS 3 ROLES (USUARIOS, CATÁLOGO, RED DE SOLICITUDES, RECEPCIONES)
  // ===========================================================================
  describe('3. Pruebas Funcionales End-to-End entre ADMINISTRADOR, ENCARGADO y EMPLEADO', () => {
    it('Ciclo completo de Usuario: Registro (PENDIENTE) -> Aprobación Admin -> Cierre Forzoso (Blacklist) -> Eliminación', async () => {
      const admin = await issueSessionTokenForUser('tomas_admin');
      const uniqueUsername = `eval_user_${Date.now()}`;

      // A. Registro público -> debe quedar PENDIENTE sin rol ni sede
      const resReg = await request(app)
        .post('/api/auth/register')
        .send({
          nombre_completo: 'Usuario Evaluación E2E',
          username: uniqueUsername,
          email: `${uniqueUsername}@grupoelectrico.com`,
          password: 'ClaveEvaluacion123!'
        });

      expect(resReg.status).toBe(201);
      expect(resReg.body.status).toBe('PENDIENTE');
      expect(resReg.body.user.rol).toBeNull();
      const newUserId = resReg.body.user.id;
      createdUserIds.push(newUserId);

      // B. Admin aprueba asignando rol EMPLEADO y sede 1
      const resApprove = await request(app)
        .post('/api/auth/approve')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ userId: newUserId, rol: 'EMPLEADO', sedeId: 1 });

      expect(resApprove.status).toBe(200);
      expect(resApprove.body.success).toBe(true);

      // C. Usuario aprobado obtiene sesión activa
      const userSession = await issueSessionTokenForUser(uniqueUsername);
      const resMeOk = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userSession.token}`);
      expect(resMeOk.status).toBe(200);

      // D. Admin le cierra la sesión forzosamente desde el Panel de Usuarios (Blacklist)
      const resForceLogout = await request(app)
        .post(`/api/auth/users/${newUserId}/force-logout`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(resForceLogout.status).toBe(200);
      expect(resForceLogout.body.success).toBe(true);

      // E. El token del usuario ya no sirve (401)
      const resMeRevoked = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userSession.token}`);
      expect(resMeRevoked.status).toBe(401);

      // F. Admin elimina al usuario de prueba del sistema
      const resDelete = await request(app)
        .delete(`/api/auth/users/${newUserId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(resDelete.status).toBe(200);
      expect(resDelete.body.success).toBe(true);
    });

    it('Ciclo completo de Catálogo, Solicitudes de Red y Entrega con Corredor Logístico', async () => {
      const admin = await issueSessionTokenForUser('tomas_admin');
      const encEp1 = await issueSessionTokenForUser('encargado_ep1'); // Sede 2 (Solicitante)
      const encEp = await issueSessionTokenForUser('encargado_ep');   // Sede 1 (Proveedora)
      const encEp3 = await issueSessionTokenForUser('encargado_ep3'); // Sede 3 (Tercero no autorizado a recibir)
      const corredor1 = await issueSessionTokenForUser('corredor_1'); // Empleado corredor

      // 1. Admin crea categoría de prueba y producto de prueba con stock 50 en Sede 1 y 10 en Sede 2
      const resCat = await request(app)
        .post('/api/inventory/categories')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          nombre: `CAT-EVAL-${Date.now()}`,
          descripcion: '[EVAL-TEST] Categoría temporal',
          imagen_url: '/uploads/cat-test.png'
        });
      expect(resCat.status).toBe(201);
      const catId = resCat.body.category.id;
      createdCategoryIds.push(catId);

      const testSku = `SKU-EVAL-${Date.now()}`;
      const resProd = await request(app)
        .post('/api/inventory/products')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          codigo_sku: testSku,
          nombre: '[EVAL-TEST] Reflector Industrial 200W',
          categoria_id: catId,
          unidad_medida: 'UNIDAD',
          sedesData: [
            { sede_id: 1, stock_actual: 50, stock_minimo: 5, precio_venta: 120000 },
            { sede_id: 2, stock_actual: 10, stock_minimo: 5, precio_venta: 120000 },
            { sede_id: 3, stock_actual: 0, stock_minimo: 5, precio_venta: 120000 },
            { sede_id: 4, stock_actual: 0, stock_minimo: 5, precio_venta: 120000 }
          ]
        });
      expect(resProd.status).toBe(201);
      const prodId = resProd.body.productId;
      createdProductIds.push(prodId);

      // 2. Encargado de Sede 2 (EP1) pide 5 unidades a la Red de Sedes
      const resSol = await request(app)
        .post('/api/solicitudes')
        .set('Authorization', `Bearer ${encEp1.token}`)
        .send({
          tipo: 'PETICION',
          producto_id: prodId,
          cantidad: 5,
          items: [{ producto_id: prodId, nombre: '[EVAL-TEST] Reflector Industrial 200W', cantidad: 5, unidad: 'UNIDAD' }],
          motivo: '[EVAL-TEST] Pedido urgente en mostrador EP1'
        });
      expect(resSol.status).toBe(201);
      const solId = resSol.body.solicitud.id;
      createdSolicitudIds.push(solId);

      // 3. Encargado de Sede 1 (Centro EP) acepta la solicitud
      const resResp = await request(app)
        .post(`/api/solicitudes/${solId}/responder`)
        .set('Authorization', `Bearer ${encEp.token}`)
        .send({
          accion: 'ACEPTAR',
          cantidad_aprobada: 5
        });
      expect(resResp.status).toBe(200);
      expect(resResp.body.solicitud.estado).toBe('ACEPTADA');

      // 4. Encargado de Sede 1 asigna al Corredor 1 -> Descuenta 5 unidades de Sede 1 (50 -> 45) y pasa a EN_TRANSITO
      const resCorr = await request(app)
        .post(`/api/solicitudes/${solId}/asignar-corredor`)
        .set('Authorization', `Bearer ${encEp.token}`)
        .send({ empleado_corredor_id: corredor1.user.id });
      expect(resCorr.status).toBe(200);
      expect(resCorr.body.solicitud.estado).toBe('EN_TRANSITO');

      const stockSede1Mid = await dbPool.query(
        'SELECT stock_actual FROM producto_sede WHERE producto_id = $1 AND sede_id = 1',
        [prodId]
      );
      expect(parseFloat(stockSede1Mid.rows[0].stock_actual)).toBe(45);

      // 5. Encargado de Sede 3 (que NO es la sede receptora) intenta confirmar recepción -> Debe ser bloqueado (403)
      const resUnauthComplete = await request(app)
        .post(`/api/solicitudes/${solId}/completar`)
        .set('Authorization', `Bearer ${encEp3.token}`);
      expect(resUnauthComplete.status).toBe(403);

      // 6. El Corredor 1 confirma la entrega en Sede 2 -> Suma 5 unidades en Sede 2 (10 -> 15) y pasa a COMPLETADA
      const resComplete = await request(app)
        .post(`/api/solicitudes/${solId}/completar`)
        .set('Authorization', `Bearer ${corredor1.token}`);
      expect(resComplete.status).toBe(200);
      expect(resComplete.body.solicitud.estado).toBe('COMPLETADA');

      const stockSede2Final = await dbPool.query(
        'SELECT stock_actual FROM producto_sede WHERE producto_id = $1 AND sede_id = 2',
        [prodId]
      );
      expect(parseFloat(stockSede2Final.rows[0].stock_actual)).toBe(15);
    });

    it('Ciclo completo de Recepción de Mercancía: Encargado crea -> Empleado asignado cuenta -> Admin distribuye', async () => {
      const admin = await issueSessionTokenForUser('tomas_admin');
      const encEp1 = await issueSessionTokenForUser('encargado_ep1'); // Sede 2
      const emp1 = await issueSessionTokenForUser('corredor_1');      // Empleado asignado
      const emp2 = await issueSessionTokenForUser('corredor_2');      // Otro empleado no asignado

      // Crear producto base en catálogo para verificar el incremento de stock al distribuir
      const testSku = `SKU-REC-${Date.now()}`;
      const resProd = await request(app)
        .post('/api/inventory/products')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          codigo_sku: testSku,
          nombre: '[EVAL-TEST] Breaker Riel 2x32A',
          unidad_medida: 'UNIDAD',
          sedesData: [
            { sede_id: 1, stock_actual: 0, stock_minimo: 5, precio_venta: 25000 },
            { sede_id: 2, stock_actual: 20, stock_minimo: 5, precio_venta: 25000 },
            { sede_id: 3, stock_actual: 0, stock_minimo: 5, precio_venta: 25000 },
            { sede_id: 4, stock_actual: 0, stock_minimo: 5, precio_venta: 25000 }
          ]
        });
      expect(resProd.status).toBe(201);
      const prodId = resProd.body.productId;
      createdProductIds.push(prodId);

      // 1. Encargado de Sede 2 registra llegada de camión asignando a empleado_1
      const resRec = await request(app)
        .post('/api/recepciones')
        .set('Authorization', `Bearer ${encEp1.token}`)
        .send({
          empleado_id: emp1.user.id,
          observaciones: '[EVAL-TEST] Camión proveedor Luminex'
        });
      expect(resRec.status).toBe(201);
      const recId = resRec.body.recepcion.id;
      createdRecepcionIds.push(recId);

      // 2. Otro empleado (corredor_2) intenta hacer el conteo -> Bloqueado con 403
      const resWrongEmp = await request(app)
        .post(`/api/recepciones/${recId}/conteo`)
        .set('Authorization', `Bearer ${emp2.token}`)
        .send({
          productos: [{ producto_id: prodId, nombre_producto: '[EVAL-TEST] Breaker Riel 2x32A', marca: 'Schneider', codigo_sku: testSku, cantidad_recibida: 12 }]
        });
      expect(resWrongEmp.status).toBe(403);

      // 3. El empleado asignado (empleado_1) envía el conteo de 12 unidades -> Pasa a CONTABILIZADO
      const resConteo = await request(app)
        .post(`/api/recepciones/${recId}/conteo`)
        .set('Authorization', `Bearer ${emp1.token}`)
        .send({
          productos: [{ producto_id: prodId, nombre_producto: '[EVAL-TEST] Breaker Riel 2x32A', marca: 'Schneider', codigo_sku: testSku, cantidad_recibida: 12 }]
        });
      expect(resConteo.status).toBe(200);
      expect(resConteo.body.recepcion.estado).toBe('CONTABILIZADO');

      // 4. El Administrador consulta el detalle y distribuye la recepción -> Stock en Sede 2 sube de 20 a 32
      const resDetalle = await request(app)
        .get(`/api/recepciones/${recId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(resDetalle.status).toBe(200);
      expect(resDetalle.body.productos.length).toBe(1);

      const resDist = await request(app)
        .post(`/api/recepciones/${recId}/distribuir`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(resDist.status).toBe(200);
      expect(resDist.body.recepcion.estado).toBe('DISTRIBUIDO');

      const stockAfterDist = await dbPool.query(
        'SELECT stock_actual FROM producto_sede WHERE producto_id = $1 AND sede_id = 2',
        [prodId]
      );
      expect(parseFloat(stockAfterDist.rows[0].stock_actual)).toBe(32);
    });
  });
});
