import { pool } from '../config/db.js';

class SolicitudRepository {
  /**
   * Crea una nueva solicitud de material (petición a la red o envío proactivo)
   */
  async createSolicitud({ tipo, producto_id, sede_solicitante_id, sede_proveedora_id, usuario_solicitante_id, cantidad_solicitada, motivo_solicitud, items_json }) {
    const query = `
      INSERT INTO solicitudes_material (
        tipo, producto_id, sede_solicitante_id, sede_proveedora_id, 
        usuario_solicitante_id, cantidad_solicitada, motivo_solicitud, items_json, estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE')
      RETURNING *
    `;
    const values = [
      tipo || 'PETICION',
      producto_id || null,
      sede_solicitante_id,
      sede_proveedora_id || null,
      usuario_solicitante_id,
      cantidad_solicitada || 1,
      motivo_solicitud || '',
      items_json ? JSON.stringify(items_json) : null
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  /**
   * Obtiene solicitudes visibles según el rol y sede del usuario
   */
  async getSolicitudesForUser(userId, rol, sedeId) {
    let whereClause = '';
    const params = [];

    if (rol === 'ADMINISTRADOR') {
      whereClause = '1=1';
    } else if (rol === 'ENCARGADO') {
      params.push(sedeId);
      whereClause = `(s.sede_solicitante_id = $1 OR s.sede_proveedora_id = $1 OR (s.sede_proveedora_id IS NULL AND s.estado = 'PENDIENTE'))`;
    } else if (rol === 'EMPLEADO') {
      params.push(userId);
      whereClause = `(s.empleado_corredor_id = $1 OR s.estado IN ('ACEPTADA', 'EN_TRANSITO'))`;
    } else {
      whereClause = '1=0';
    }

    const query = `
      SELECT 
        s.id,
        s.tipo,
        s.producto_id,
        s.cantidad_solicitada,
        s.cantidad_aprobada,
        s.estado,
        s.motivo_solicitud,
        s.motivo_rechazo,
        s.items_json,
        s.sedes_rechazadas_json,
        s.created_at,
        s.updated_at,
        s.fecha_respuesta,
        s.sede_solicitante_id,
        s.sede_proveedora_id,
        s.usuario_solicitante_id,
        s.usuario_respuesta_id,
        s.empleado_corredor_id,
        ss.nombre as sede_solicitante_nombre,
        sp.nombre as sede_proveedora_nombre,
        us.nombre_completo as usuario_solicitante_nombre,
        ur.nombre_completo as usuario_respuesta_nombre,
        uc.nombre_completo as corredor_nombre,
        p.nombre as producto_nombre,
        p.codigo_sku as producto_sku,
        p.unidad_medida as producto_unidad
      FROM solicitudes_material s
      LEFT JOIN sedes ss ON s.sede_solicitante_id = ss.id
      LEFT JOIN sedes sp ON s.sede_proveedora_id = sp.id
      LEFT JOIN usuarios us ON s.usuario_solicitante_id = us.id
      LEFT JOIN usuarios ur ON s.usuario_respuesta_id = ur.id
      LEFT JOIN usuarios uc ON s.empleado_corredor_id = uc.id
      LEFT JOIN productos p ON s.producto_id = p.id
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT 100
    `;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  /**
   * Obtiene una solicitud por ID
   */
  async findById(id) {
    const query = `
      SELECT 
        s.*,
        ss.nombre as sede_solicitante_nombre,
        sp.nombre as sede_proveedora_nombre,
        us.nombre_completo as usuario_solicitante_nombre,
        ur.nombre_completo as usuario_respuesta_nombre,
        uc.nombre_completo as corredor_nombre,
        p.nombre as producto_nombre,
        p.codigo_sku as producto_sku,
        p.unidad_medida as producto_unidad
      FROM solicitudes_material s
      LEFT JOIN sedes ss ON s.sede_solicitante_id = ss.id
      LEFT JOIN sedes sp ON s.sede_proveedora_id = sp.id
      LEFT JOIN usuarios us ON s.usuario_solicitante_id = us.id
      LEFT JOIN usuarios ur ON s.usuario_respuesta_id = ur.id
      LEFT JOIN usuarios uc ON s.empleado_corredor_id = uc.id
      LEFT JOIN productos p ON s.producto_id = p.id
      WHERE s.id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }

  /**
   * Responde (acepta o rechaza) una solicitud de manera global
   */
  async responderSolicitud(id, { accion, sede_proveedora_id, usuario_respuesta_id, cantidad_aprobada, motivo_rechazo }) {
    if (accion === 'ACEPTAR') {
      const query = `
        UPDATE solicitudes_material
        SET 
          estado = 'ACEPTADA',
          sede_proveedora_id = COALESCE(sede_proveedora_id, $1),
          usuario_respuesta_id = $2,
          cantidad_aprobada = $3,
          fecha_respuesta = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `;
      const { rows } = await pool.query(query, [sede_proveedora_id, usuario_respuesta_id, cantidad_aprobada, id]);
      return rows[0];
    } else {
      const query = `
        UPDATE solicitudes_material
        SET 
          estado = 'RECHAZADA',
          usuario_respuesta_id = $1,
          motivo_rechazo = $2,
          fecha_respuesta = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
      `;
      const { rows } = await pool.query(query, [usuario_respuesta_id, motivo_rechazo || 'Rechazado por disponibilidad', id]);
      return rows[0];
    }
  }

  /**
   * Registra que una sede específica declinó/rechazó la solicitud por falta de stock.
   * La solicitud permanece en PENDIENTE para las demás sedes y el Administrador.
   */
  async registrarRechazoSede(id, { sede_id, sede_nombre, usuario_id, usuario_nombre, motivo }) {
    const registro = {
      sede_id: Number(sede_id),
      sede_nombre: sede_nombre || `Sede #${sede_id}`,
      usuario_id: Number(usuario_id),
      usuario_nombre: usuario_nombre || 'Encargado',
      motivo: motivo || 'Sin existencias en mostrador',
      fecha: new Date().toISOString()
    };

    const current = await this.findById(id);
    let sedesRechazadas = Array.isArray(current?.sedes_rechazadas_json) ? current.sedes_rechazadas_json : [];
    sedesRechazadas = sedesRechazadas.filter(r => Number(r.sede_id) !== Number(sede_id));
    sedesRechazadas.push(registro);

    const query = `
      UPDATE solicitudes_material
      SET 
        sedes_rechazadas_json = $1::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [JSON.stringify(sedesRechazadas), id]);
    return rows[0];
  }

  /**
   * Asigna un empleado corredor y pone la solicitud en tránsito
   */
  async asignarCorredor(id, empleado_corredor_id) {
    const query = `
      UPDATE solicitudes_material
      SET 
        empleado_corredor_id = $1,
        estado = 'EN_TRANSITO'
      WHERE id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [empleado_corredor_id, id]);
    return rows[0];
  }

  /**
   * Completa la recepción de la mercancía
   */
  async completarSolicitud(id) {
    const query = `
      UPDATE solicitudes_material
      SET estado = 'COMPLETADA'
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  /**
   * Obtiene la lista de empleados disponibles con rol EMPLEADO (corredores)
   */
  async getCorredores() {
    const query = `
      SELECT id, nombre_completo, username, email
      FROM usuarios
      WHERE rol = 'EMPLEADO' AND estado = 'ACTIVO'
      ORDER BY nombre_completo ASC
    `;
    const { rows } = await pool.query(query);
    return rows;
  }
}

export default new SolicitudRepository();
