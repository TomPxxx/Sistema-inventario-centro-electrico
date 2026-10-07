import { pool } from '../config/db.js';

class RecepcionRepository {
  /**
   * Encargado crea una nueva recepción de mercancía
   */
  static async createRecepcion(sedeReceptoraId, encargadoId, empleadoId, observaciones) {
    const query = `
      INSERT INTO recepciones_mercancia (sede_receptora_id, encargado_id, empleado_id, observaciones)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const values = [sedeReceptoraId, encargadoId, empleadoId, observaciones];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  /**
   * Obtener todas las recepciones por sede
   */
  static async getRecepcionesBySede(sedeId) {
    const query = `
      SELECT r.*, 
             e.nombre_completo as empleado_nombre,
             enc.nombre_completo as encargado_nombre
      FROM recepciones_mercancia r
      LEFT JOIN usuarios e ON r.empleado_id = e.id
      JOIN usuarios enc ON r.encargado_id = enc.id
      WHERE r.sede_receptora_id = $1
      ORDER BY r.created_at DESC;
    `;
    const { rows } = await pool.query(query, [sedeId]);
    return rows;
  }

  /**
   * Obtener todas las recepciones (Para Administrador)
   */
  static async getAllRecepciones() {
    const query = `
      SELECT r.*, 
             s.nombre as sede_nombre,
             e.nombre_completo as empleado_nombre,
             enc.nombre_completo as encargado_nombre
      FROM recepciones_mercancia r
      JOIN sedes s ON r.sede_receptora_id = s.id
      LEFT JOIN usuarios e ON r.empleado_id = e.id
      JOIN usuarios enc ON r.encargado_id = enc.id
      ORDER BY r.created_at DESC;
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  /**
   * Obtener recepciones asignadas a un empleado
   */
  static async getRecepcionesByEmpleado(empleadoId) {
    const query = `
      SELECT r.*, 
             s.nombre as sede_nombre,
             enc.nombre_completo as encargado_nombre
      FROM recepciones_mercancia r
      JOIN sedes s ON r.sede_receptora_id = s.id
      JOIN usuarios enc ON r.encargado_id = enc.id
      WHERE r.empleado_id = $1
      ORDER BY r.created_at DESC;
    `;
    const { rows } = await pool.query(query, [empleadoId]);
    return rows;
  }

  /**
   * Obtener detalles de una recepción
   */
  static async getRecepcionById(recepcionId) {
    const query = `
      SELECT * FROM recepciones_mercancia WHERE id = $1;
    `;
    const { rows } = await pool.query(query, [recepcionId]);
    return rows[0];
  }

  /**
   * Actualizar el estado de una recepción
   */
  static async updateEstadoRecepcion(recepcionId, estado) {
    const query = `
      UPDATE recepciones_mercancia
      SET estado = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [estado, recepcionId]);
    return rows[0];
  }

  /**
   * Empleado añade productos al lote (conteo)
   */
  static async addProductosToRecepcion(recepcionId, productos) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const addedProducts = [];
      for (const prod of productos) {
        const query = `
          INSERT INTO recepcion_productos (recepcion_id, codigo_sku, cantidad_recibida)
          VALUES ($1, $2, $3)
          RETURNING *;
        `;
        const { rows } = await client.query(query, [recepcionId, prod.codigo_sku, prod.cantidad_recibida]);
        addedProducts.push(rows[0]);
      }

      await client.query('COMMIT');
      return addedProducts;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtener los productos de una recepción
   */
  static async getProductosByRecepcion(recepcionId) {
    const query = `
      SELECT * FROM recepcion_productos WHERE recepcion_id = $1 ORDER BY created_at ASC;
    `;
    const { rows } = await pool.query(query, [recepcionId]);
    return rows;
  }

  /**
   * Obtener empleados activos
   */
  static async getEmpleados() {
    const query = `
      SELECT id, nombre_completo, username 
      FROM usuarios 
      WHERE rol = 'EMPLEADO' AND estado = 'ACTIVO'
      ORDER BY nombre_completo ASC;
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  /**
   * Distribuir productos contabilizados al inventario físico
   */
  static async distribuirProductosEnInventario(recepcionId, sedeId, productos, adminId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const prod of productos) {
        // Find producto_id from codigo_sku
        const resProd = await client.query('SELECT id FROM productos WHERE codigo_sku = $1', [prod.codigo_sku]);
        if (resProd.rows.length === 0) continue;
        const productoId = resProd.rows[0].id;
        const qty = parseFloat(prod.cantidad_recibida);

        // Check if exists in producto_sede
        const resStock = await client.query('SELECT stock_actual, precio_venta FROM producto_sede WHERE producto_id = $1 AND sede_id = $2', [productoId, sedeId]);
        
        let stock_anterior = 0;
        let stock_posterior = qty;
        let precio_venta = 0;

        if (resStock.rows.length > 0) {
          stock_anterior = parseFloat(resStock.rows[0].stock_actual);
          stock_posterior = stock_anterior + qty;
          precio_venta = resStock.rows[0].precio_venta;

          await client.query(
            'UPDATE producto_sede SET stock_actual = $1, updated_at = NOW() WHERE producto_id = $2 AND sede_id = $3',
            [stock_posterior, productoId, sedeId]
          );
        } else {
          await client.query(
            'INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta) VALUES ($1, $2, $3, 0, 0)',
            [productoId, sedeId, qty]
          );
        }

        // Insert movement
        await client.query(`
          INSERT INTO movimientos_inventario 
          (tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, stock_anterior, stock_posterior, precio_unitario, motivo_observacion, referencia_documento)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          'ENTRADA', productoId, sedeId, adminId, qty, stock_anterior, stock_posterior, precio_venta, 'Recepción de Mercancía distribuida', `REC-${recepcionId}`
        ]);
      }

      await client.query('UPDATE recepciones_mercancia SET estado = $1, updated_at = NOW() WHERE id = $2', ['DISTRIBUIDO', recepcionId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

}

export default RecepcionRepository;
