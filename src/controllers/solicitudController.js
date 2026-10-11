import { pool } from '../config/db.js';
import SolicitudRepository from '../repositories/SolicitudRepository.js';
import AuditRepository from '../repositories/AuditRepository.js';
import SedeRepository from '../repositories/SedeRepository.js';

/**
 * Emitir una nueva solicitud de material (Petición o Envío proactivo)
 * POST /api/solicitudes
 */
export const createSolicitud = async (req, res) => {
  try {
    const { tipo, producto_id, items, cantidad, motivo, sede_proveedora_id } = req.body;
    
    // Sede solicitante: si es encargado, obligatoriamente su sede; si es admin, la que indique o la suya
    let sede_solicitante_id = req.user.sede_id;
    if (req.user.rol === 'ADMINISTRADOR' && req.body.sede_solicitante_id) {
      sede_solicitante_id = Number(req.body.sede_solicitante_id);
    }

    if (!sede_solicitante_id) {
      return res.status(400).json({ success: false, message: 'No se pudo determinar la sede solicitante.' });
    }

    const cantidad_solicitada = parseFloat(cantidad) || 1;
    if (cantidad_solicitada <= 0) {
      return res.status(400).json({ success: false, message: 'La cantidad debe ser mayor a 0.' });
    }

    const solicitud = await SolicitudRepository.createSolicitud({
      tipo: tipo || 'PETICION',
      producto_id: producto_id ? Number(producto_id) : null,
      sede_solicitante_id,
      sede_proveedora_id: sede_proveedora_id ? Number(sede_proveedora_id) : null,
      usuario_solicitante_id: req.user.id,
      cantidad_solicitada,
      motivo_solicitud: motivo || '',
      items_json: items || null
    });

    // Auditoría
    const desc = tipo === 'ENVIO_PROACTIVO' 
      ? `Envío proactivo de mercancía a Sede ${sede_proveedora_id}`
      : `Petición de ${cantidad_solicitada} un. a la red de sedes`;
    await AuditRepository.logAction(
      req.user.id,
      req.user.username,
      tipo === 'ENVIO_PROACTIVO' ? 'ENVIO_PROACTIVO' : 'SOLICITUD_MATERIAL',
      `Solicitud #${solicitud.id}: ${desc}. Motivo: ${motivo || 'N/A'}`,
      req.ip
    );

    // Notificación en tiempo real por WebSockets
    const io = req.app.get('io');
    if (io) {
      io.emit('solicitud_material_nueva', {
        id: solicitud.id,
        tipo: solicitud.tipo,
        sede_solicitante_id,
        sede_proveedora_id: solicitud.sede_proveedora_id,
        usuario_nombre: req.user.nombre_completo,
        cantidad: cantidad_solicitada,
        motivo: motivo || ''
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Solicitud emitida exitosamente a la red de sedes.',
      solicitud
    });
  } catch (error) {
    console.error('[Solicitud Error] createSolicitud:', error);
    return res.status(500).json({ success: false, message: 'Error creando la solicitud: ' + error.message });
  }
};

/**
 * Listar solicitudes visibles para el usuario autenticado
 * GET /api/solicitudes
 */
export const getSolicitudes = async (req, res) => {
  try {
    const solicitudes = await SolicitudRepository.getSolicitudesForUser(
      req.user.id,
      req.user.rol,
      req.user.sede_id
    );

    return res.status(200).json({
      success: true,
      solicitudes
    });
  } catch (error) {
    console.error('[Solicitud Error] getSolicitudes:', error);
    return res.status(500).json({ success: false, message: 'Error obteniendo solicitudes: ' + error.message });
  }
};

/**
 * Responder a una solicitud (Aceptar o Rechazar)
 * POST /api/solicitudes/:id/responder
 */
export const responderSolicitud = async (req, res) => {
  try {
    const { id } = req.params;
    const { accion, cantidad_aprobada, motivo_rechazo } = req.body;

    if (!['ACEPTAR', 'RECHAZAR'].includes(accion)) {
      return res.status(400).json({ success: false, message: 'Acción no válida.' });
    }

    const sol = await SolicitudRepository.findById(id);
    if (!sol) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada.' });
    }

    if (sol.estado !== 'PENDIENTE') {
      return res.status(400).json({ success: false, message: `La solicitud ya se encuentra ${sol.estado}.` });
    }

    // Si es un encargado respondiendo, la sede proveedora es la suya
    let sede_proveedora_id = req.user.sede_id;
    if (req.user.rol === 'ADMINISTRADOR' && req.body.sede_proveedora_id) {
      sede_proveedora_id = Number(req.body.sede_proveedora_id);
    }

    if (accion === 'ACEPTAR' && Number(sede_proveedora_id) === Number(sol.sede_solicitante_id)) {
      return res.status(400).json({ success: false, message: 'No puedes aceptar una solicitud de tu propia sede.' });
    }

    if (accion === 'ACEPTAR') {
      const cantAprobada = parseFloat(cantidad_aprobada) > 0 
        ? parseFloat(cantidad_aprobada) 
        : parseFloat(sol.cantidad_solicitada);

      const updated = await SolicitudRepository.responderSolicitud(id, {
        accion: 'ACEPTAR',
        sede_proveedora_id,
        usuario_respuesta_id: req.user.id,
        cantidad_aprobada: cantAprobada,
        motivo_rechazo: null
      });

      // Auditoría
      await AuditRepository.logAction(
        req.user.id,
        req.user.username,
        'SOLICITUD_ACEPTADA',
        `Sede ${sede_proveedora_id} aceptó enviar ${cantAprobada} un. para Solicitud #${id}`,
        req.ip
      );

      // WebSockets
      const io = req.app.get('io');
      if (io) {
        io.emit('solicitud_actualizada', {
          id: updated.id,
          estado: updated.estado,
          accion: 'ACEPTAR',
          sede_proveedora_id,
          cantidad_aprobada: cantAprobada,
          usuario_respuesta: req.user.nombre_completo
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Solicitud aceptada. En espera de asignar corredor.',
        solicitud: updated
      });
    }

    // ACCION === 'RECHAZAR'
    // Si es ADMINISTRADOR o si la solicitud fue dirigida específicamente a una sede fija: rechazo global
    // Si es un ENCARGADO respondiendo a una petición abierta a la red (sede_proveedora_id IS NULL):
    // solo se marca como declinada para su sede, manteniendo la solicitud PENDIENTE para las demás sedes y el Administrador.
    let updated;
    const isDirectSedeTarget = sol.sede_proveedora_id && Number(sol.sede_proveedora_id) === Number(req.user.sede_id);
    const isGlobal = req.user.rol === 'ADMINISTRADOR' || isDirectSedeTarget;

    if (isGlobal) {
      updated = await SolicitudRepository.responderSolicitud(id, {
        accion: 'RECHAZAR',
        usuario_respuesta_id: req.user.id,
        motivo_rechazo: motivo_rechazo || (req.user.rol === 'ADMINISTRADOR' ? 'Rechazado por Administrador' : 'Rechazado por sede proveedora')
      });

      await AuditRepository.logAction(
        req.user.id,
        req.user.username,
        'SOLICITUD_RECHAZADA',
        `Rechazó globalmente Solicitud #${id}. Motivo: ${motivo_rechazo || 'Sin stock disponible'}`,
        req.ip
      );
    } else {
      // Declinación local para la sede del encargado
      let sedeNombre = req.user.sede_nombre;
      if (!sedeNombre && req.user.sede_id) {
        const s = await SedeRepository.findById(req.user.sede_id);
        if (s) sedeNombre = s.nombre;
      }

      updated = await SolicitudRepository.registrarRechazoSede(id, {
        sede_id: req.user.sede_id,
        sede_nombre: sedeNombre || `Sede #${req.user.sede_id}`,
        usuario_id: req.user.id,
        usuario_nombre: req.user.nombre_completo || req.user.username,
        motivo: motivo_rechazo || 'Sin existencias en mostrador'
      });

      await AuditRepository.logAction(
        req.user.id,
        req.user.username,
        'SOLICITUD_DECLINADA_SEDE',
        `${sedeNombre || 'Sede #' + req.user.sede_id} declinó Solicitud #${id} por falta de stock. Motivo: ${motivo_rechazo || 'Sin existencias'}`,
        req.ip
      );
    }

    // WebSockets
    const io = req.app.get('io');
    if (io) {
      io.emit('solicitud_actualizada', {
        id: updated.id,
        estado: updated.estado,
        accion: isGlobal ? 'RECHAZAR' : 'DECLINAR_SEDE',
        sede_declinada_id: isGlobal ? null : req.user.sede_id,
        sedes_rechazadas_json: updated.sedes_rechazadas_json,
        usuario_respuesta: req.user.nombre_completo
      });
    }

    return res.status(200).json({
      success: true,
      message: isGlobal
        ? 'Solicitud rechazada.'
        : 'Has indicado que tu sede no cuenta con existencias. La solicitud sigue abierta para las demás sedes y el Administrador.',
      solicitud: updated
    });
  } catch (error) {
    console.error('[Solicitud Error] responderSolicitud:', error);
    return res.status(500).json({ success: false, message: 'Error respondiendo solicitud: ' + error.message });
  }
};

/**
 * Asignar un empleado corredor logístico y poner la mercancía en tránsito
 * POST /api/solicitudes/:id/asignar-corredor
 */
export const asignarCorredor = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { empleado_corredor_id } = req.body;

    if (!empleado_corredor_id) {
      return res.status(400).json({ success: false, message: 'Debes seleccionar un empleado corredor.' });
    }

    const sol = await SolicitudRepository.findById(id);
    if (!sol) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada.' });
    }

    if (sol.estado !== 'ACEPTADA') {
      return res.status(400).json({ success: false, message: 'La solicitud debe estar aceptada para asignar un corredor.' });
    }

    await client.query('BEGIN');

    // Descontar stock de la sede proveedora (soporte para items_json o producto_id único)
    let itemsToDeduct = [];
    if (Array.isArray(sol.items_json) && sol.items_json.length > 0) {
      itemsToDeduct = sol.items_json;
    } else if (sol.producto_id) {
      itemsToDeduct = [{
        producto_id: sol.producto_id,
        cantidad: sol.cantidad_aprobada || sol.cantidad_solicitada || 1
      }];
    }

    for (const item of itemsToDeduct) {
      const pId = Number(item.producto_id);
      const cantADespachar = parseFloat(item.cantidad_despachada || item.cantidad || item.cantidad_aprobada || 1);
      const provId = Number(item.sede_proveedora_id || sol.sede_proveedora_id);

      if (pId && provId) {
        const stockRes = await client.query(
          `SELECT ps.stock_actual, ps.precio_venta, p.nombre 
           FROM producto_sede ps
           JOIN productos p ON p.id = ps.producto_id
           WHERE ps.producto_id = $1 AND ps.sede_id = $2 FOR UPDATE`,
          [pId, provId]
        );

        if (stockRes.rows.length === 0 || parseFloat(stockRes.rows[0].stock_actual) < cantADespachar) {
          await client.query('ROLLBACK');
          const disp = stockRes.rows[0]?.stock_actual || 0;
          const prodNom = stockRes.rows[0]?.nombre || `ID #${pId}`;
          return res.status(400).json({ 
            success: false, 
            message: `Stock insuficiente de "${prodNom}" en la sede proveedora (Disponible: ${disp}, Requerido: ${cantADespachar}).` 
          });
        }

        const anterior = parseFloat(stockRes.rows[0].stock_actual);
        const posterior = anterior - cantADespachar;

        await client.query(
          `UPDATE producto_sede SET stock_actual = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE producto_id = $2 AND sede_id = $3`,
          [posterior, pId, provId]
        );

        // Registrar movimiento de salida
        await client.query(
          `INSERT INTO movimientos_inventario (
            tipo_movimiento, producto_id, sede_id, usuario_id, cantidad,
            stock_anterior, stock_posterior, precio_unitario, referencia_documento,
            motivo_observacion, fecha_movimiento, created_at
          ) VALUES (
            'TRASLADO_SALIDA', $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )`,
          [
            pId, provId, req.user.id, cantADespachar,
            anterior, posterior, stockRes.rows[0].precio_venta || 0,
            `SOL-${sol.id}`, `Despachado en tránsito por corredor #${empleado_corredor_id}`
          ]
        );
      }
    }

    // Actualizar solicitud
    const updatedRes = await client.query(
      `UPDATE solicitudes_material 
       SET empleado_corredor_id = $1, estado = 'EN_TRANSITO', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [empleado_corredor_id, id]
    );

    await client.query('COMMIT');

    const updated = updatedRes.rows[0];

    // Auditoría
    await AuditRepository.logAction(
      req.user.id,
      req.user.username,
      'CORREDOR_ASIGNADO',
      `Asignó corredor #${empleado_corredor_id} a Solicitud #${id}. Mercancía en tránsito de Sede ${sol.sede_proveedora_id} a Sede ${sol.sede_solicitante_id}.`,
      req.ip
    );

    // WebSockets
    const io = req.app.get('io');
    if (io) {
      io.emit('solicitud_actualizada', {
        id: updated.id,
        estado: 'EN_TRANSITO',
        empleado_corredor_id
      });
      io.emit('stock_actualizado', {
        sede_origen_id: sol.sede_proveedora_id,
        solicitud_id: sol.id
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Corredor logístico asignado. Mercancía en camino a la sede solicitante.',
      solicitud: updated
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Solicitud Error] asignarCorredor:', error);
    return res.status(500).json({ success: false, message: 'Error asignando corredor: ' + error.message });
  } finally {
    client.release();
  }
};

/**
 * Despacho directo Multi-Sede gestionado por el Administrador Global
 * POST /api/solicitudes/:id/admin-despachar
 */
export const adminDespachar = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { empleado_corredor_id, items } = req.body;

    if (!empleado_corredor_id) {
      return res.status(400).json({ success: false, message: 'Debes seleccionar un empleado corredor.' });
    }

    const sol = await SolicitudRepository.findById(id);
    if (!sol) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada.' });
    }

    if (sol.estado !== 'PENDIENTE' && sol.estado !== 'ACEPTADA') {
      return res.status(400).json({ success: false, message: `La solicitud ya se encuentra ${sol.estado}.` });
    }

    await client.query('BEGIN');

    // Determinar items a procesar
    let itemsToProcess = [];
    if (Array.isArray(items) && items.length > 0) {
      itemsToProcess = items;
    } else if (Array.isArray(sol.items_json) && sol.items_json.length > 0) {
      itemsToProcess = sol.items_json.map(it => ({
        producto_id: it.producto_id,
        sede_proveedora_id: req.body.sede_proveedora_id || it.sede_proveedora_id,
        cantidad: it.cantidad || it.cantidad_solicitada || 1
      }));
    } else {
      itemsToProcess = [{
        producto_id: sol.producto_id,
        sede_proveedora_id: req.body.sede_proveedora_id,
        cantidad: req.body.cantidad_aprobada || sol.cantidad_solicitada || 1
      }];
    }

    const enrichedItems = [];
    const sedesDespachoStr = [];

    for (const item of itemsToProcess) {
      const pId = Number(item.producto_id);
      const sedeProvId = Number(item.sede_proveedora_id);
      const cantDespachar = parseFloat(item.cantidad || item.cantidad_despachada || item.cantidad_aprobada || 1);

      if (!pId) continue;

      if (!sedeProvId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Debes indicar la sede proveedora para el producto ID ${pId}.`
        });
      }

      if (sedeProvId === Number(sol.sede_solicitante_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `La sede proveedora no puede ser la misma sede solicitante (Sede #${sedeProvId}).`
        });
      }

      if (cantDespachar <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `La cantidad a despachar debe ser mayor a 0 para el producto ID ${pId}.`
        });
      }

      // Validar y descontar stock con bloqueo FOR UPDATE
      const stockRes = await client.query(
        `SELECT ps.stock_actual, ps.precio_venta, p.nombre, p.codigo_sku, s.nombre AS sede_nombre
         FROM producto_sede ps
         JOIN productos p ON p.id = ps.producto_id
         JOIN sedes s ON s.id = ps.sede_id
         WHERE ps.producto_id = $1 AND ps.sede_id = $2 FOR UPDATE`,
        [pId, sedeProvId]
      );

      if (stockRes.rows.length === 0 || parseFloat(stockRes.rows[0].stock_actual) < cantDespachar) {
        await client.query('ROLLBACK');
        const disp = stockRes.rows[0]?.stock_actual || 0;
        const nombreProd = stockRes.rows[0]?.nombre || `ID #${pId}`;
        const nombreSede = stockRes.rows[0]?.sede_nombre || `Sede #${sedeProvId}`;
        return res.status(400).json({
          success: false,
          message: `Stock insuficiente de "${nombreProd}" en ${nombreSede}. Disponible: ${disp}, Requerido: ${cantDespachar}.`
        });
      }

      const row = stockRes.rows[0];
      const anterior = parseFloat(row.stock_actual);
      const posterior = anterior - cantDespachar;

      await client.query(
        `UPDATE producto_sede SET stock_actual = $1, updated_at = CURRENT_TIMESTAMP
         WHERE producto_id = $2 AND sede_id = $3`,
        [posterior, pId, sedeProvId]
      );

      // Registrar movimiento TRASLADO_SALIDA
      await client.query(
        `INSERT INTO movimientos_inventario (
          tipo_movimiento, producto_id, sede_id, usuario_id, cantidad,
          stock_anterior, stock_posterior, precio_unitario, referencia_documento,
          motivo_observacion, fecha_movimiento, created_at
        ) VALUES (
          'TRASLADO_SALIDA', $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        [
          pId, sedeProvId, req.user.id, cantDespachar,
          anterior, posterior, row.precio_venta || 0,
          `SOL-${sol.id}`, `Despacho Multi-Sede autorizado por Admin. Corredor #${empleado_corredor_id}`
        ]
      );

      enrichedItems.push({
        producto_id: pId,
        nombre: row.nombre,
        codigo_sku: row.codigo_sku,
        cantidad_despachada: cantDespachar,
        sede_proveedora_id: sedeProvId,
        sede_proveedora_nombre: row.sede_nombre
      });

      sedesDespachoStr.push(`${row.sede_nombre} (${cantDespachar} un. de ${row.codigo_sku})`);
    }

    // Actualizar solicitud_material
    const primarySedeProvId = enrichedItems[0]?.sede_proveedora_id || null;
    const totalDespachado = enrichedItems.reduce((acc, it) => acc + it.cantidad_despachada, 0);

    const updatedRes = await client.query(
      `UPDATE solicitudes_material
       SET estado = 'EN_TRANSITO',
           empleado_corredor_id = $1,
           sede_proveedora_id = $2,
           usuario_respuesta_id = $3,
           cantidad_aprobada = $4,
           items_json = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 RETURNING *`,
      [
        empleado_corredor_id,
        primarySedeProvId,
        req.user.id,
        totalDespachado,
        JSON.stringify(enrichedItems),
        id
      ]
    );

    await client.query('COMMIT');

    const updated = updatedRes.rows[0];

    // Auditoría
    await AuditRepository.logAction(
      req.user.id,
      req.user.username,
      'ADMIN_DESPACHO_MULTISEDE',
      `Admin autorizó y despachó Solicitud #${id} para Sede #${sol.sede_solicitante_id} asignando Corredor #${empleado_corredor_id}. Despachos: ${sedesDespachoStr.join(', ')}`,
      req.ip
    );

    // WebSockets
    const io = req.app.get('io');
    if (io) {
      io.emit('solicitud_actualizada', {
        id: updated.id,
        estado: 'EN_TRANSITO',
        empleado_corredor_id,
        accion: 'DESPACHADA_POR_ADMIN'
      });
      io.emit('stock_actualizado', {
        solicitud_id: updated.id,
        motivo: 'DESPACHO_ADMIN'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Despacho multi-sede procesado y mercancía en tránsito hacia la sede destino.',
      solicitud: updated
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Solicitud Error] adminDespachar:', error);
    return res.status(500).json({ success: false, message: 'Error procesando despacho: ' + error.message });
  } finally {
    client.release();
  }
};

/**
 * Confirmar recepción física de la mercancía por parte de la sede solicitante
 * POST /api/solicitudes/:id/completar
 */
export const completarRecepcion = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    const sol = await SolicitudRepository.findById(id);
    if (!sol) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada.' });
    }

    if (sol.estado !== 'EN_TRANSITO') {
      return res.status(400).json({ success: false, message: 'Solo se puede confirmar mercancía que esté en estado EN_TRANSITO.' });
    }

    await client.query('BEGIN');

    // Procesar todos los items recibidos (soporta items_json y producto_id único)
    let itemsToReceive = [];
    if (Array.isArray(sol.items_json) && sol.items_json.length > 0) {
      itemsToReceive = sol.items_json;
    } else if (sol.producto_id) {
      itemsToReceive = [{
        producto_id: sol.producto_id,
        cantidad_despachada: parseFloat(sol.cantidad_aprobada || sol.cantidad_solicitada || 1),
        sede_proveedora_id: sol.sede_proveedora_id
      }];
    }

    let totalRecibido = 0;

    for (const item of itemsToReceive) {
      const pId = Number(item.producto_id);
      const cantRecibida = parseFloat(item.cantidad_despachada || item.cantidad_aprobada || item.cantidad || 1);
      const sedeProvId = item.sede_proveedora_id || sol.sede_proveedora_id;

      if (!pId || cantRecibida <= 0) continue;
      totalRecibido += cantRecibida;

      // Incrementar stock en la sede solicitante (destino)
      const destStockRes = await client.query(
        `SELECT stock_actual, precio_venta FROM producto_sede 
         WHERE producto_id = $1 AND sede_id = $2 FOR UPDATE`,
        [pId, sol.sede_solicitante_id]
      );

      let anterior = 0;
      let precio = 0;

      if (destStockRes.rows.length === 0) {
        // Obtener precio de referencia
        const origPrice = await client.query(
          `SELECT precio_venta FROM producto_sede WHERE producto_id = $1 AND sede_id = $2`,
          [pId, sedeProvId]
        );
        precio = origPrice.rows[0]?.precio_venta || 0;

        await client.query(
          `INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede)
           VALUES ($1, $2, $3, 5.00, $4, TRUE)`,
          [pId, sol.sede_solicitante_id, cantRecibida, precio]
        );
      } else {
        anterior = parseFloat(destStockRes.rows[0].stock_actual);
        precio = destStockRes.rows[0].precio_venta || 0;
        await client.query(
          `UPDATE producto_sede SET stock_actual = stock_actual + $1, updated_at = CURRENT_TIMESTAMP
           WHERE producto_id = $2 AND sede_id = $3`,
          [cantRecibida, pId, sol.sede_solicitante_id]
        );
      }

      const posterior = anterior + cantRecibida;

      // Registrar movimiento de entrada
      await client.query(
        `INSERT INTO movimientos_inventario (
          tipo_movimiento, producto_id, sede_id, usuario_id, cantidad,
          stock_anterior, stock_posterior, precio_unitario, referencia_documento,
          motivo_observacion, fecha_movimiento, created_at
        ) VALUES (
          'TRASLADO_ENTRADA', $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        [
          pId, sol.sede_solicitante_id, req.user.id, cantRecibida,
          anterior, posterior, precio,
          `SOL-${sol.id}`, `Mercancía recibida e ingresada físicamente a Sede #${sol.sede_solicitante_id}`
        ]
      );

      // Registrar en traslados para histórico 1:1
      await client.query(
        `INSERT INTO traslados (
          solicitud_id, producto_id, sede_origen_id, sede_destino_id,
          cantidad, precio_destino_vigente, usuario_envia_id, usuario_recibe_id,
          estado, observaciones, fecha_envio, fecha_recepcion
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'COMPLETADO', $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) ON CONFLICT (solicitud_id) DO UPDATE 
          SET estado = 'COMPLETADO', usuario_recibe_id = $8, fecha_recepcion = CURRENT_TIMESTAMP`,
        [
          sol.id, pId, sedeProvId || 1, sol.sede_solicitante_id,
          cantRecibida, precio, sol.usuario_respuesta_id || req.user.id, req.user.id,
          `Traslado completado vía Solicitud #${sol.id}`
        ]
      );
    }

    // Actualizar estado de solicitud a COMPLETADA
    const updatedRes = await client.query(
      `UPDATE solicitudes_material 
       SET estado = 'COMPLETADA', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id]
    );

    await client.query('COMMIT');

    const updated = updatedRes.rows[0];

    // Auditoría
    await AuditRepository.logAction(
      req.user.id,
      req.user.username,
      'RECEPCION_TRASLADO',
      `Mercancía (${totalRecibido} un.) de Solicitud #${id} recibida e ingresada al stock físico de Sede #${sol.sede_solicitante_id}.`,
      req.ip
    );

    // WebSockets
    const io = req.app.get('io');
    if (io) {
      io.emit('solicitud_actualizada', { id: updated.id, estado: 'COMPLETADA' });
      io.emit('stock_actualizado', {
        sede_destino_id: sol.sede_solicitante_id,
        solicitud_id: updated.id
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Recepción confirmada con éxito. Stock ingresado al inventario de tu sede.',
      solicitud: updated
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Solicitud Error] completarRecepcion:', error);
    return res.status(500).json({ success: false, message: 'Error confirmando recepción: ' + error.message });
  } finally {
    client.release();
  }
};

/**
 * Obtener lista de empleados corredores disponibles
 * GET /api/solicitudes/corredores
 */
export const getCorredores = async (req, res) => {
  try {
    const corredores = await SolicitudRepository.getCorredores();
    return res.status(200).json({
      success: true,
      corredores
    });
  } catch (error) {
    console.error('[Solicitud Error] getCorredores:', error);
    return res.status(500).json({ success: false, message: 'Error obteniendo corredores: ' + error.message });
  }
};
