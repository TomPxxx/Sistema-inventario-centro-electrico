import { pool } from '../config/db.js';

class InventoryRepository {
  async getProducts() {
    const { rows } = await pool.query(
      `SELECT id, codigo_sku, nombre, descripcion, unidad_medida, activo, created_at 
       FROM productos 
       WHERE activo = TRUE 
       ORDER BY id ASC`
    );
    return rows;
  }

  async getStocks() {
    const { rows } = await pool.query(
      `SELECT ps.producto_id, ps.sede_id, ps.stock_actual, ps.stock_minimo, ps.precio_venta, ps.disponible_en_sede, s.nombre AS sede_nombre
       FROM producto_sede ps
       JOIN sedes s ON ps.sede_id = s.id
       ORDER BY ps.producto_id ASC, ps.sede_id ASC`
    );
    return rows;
  }

  async checkSkuExists(sku) {
    const { rows } = await pool.query('SELECT id FROM productos WHERE codigo_sku = $1', [sku]);
    return rows;
  }

  async getActiveSedes() {
    const { rows } = await pool.query('SELECT id FROM sedes WHERE activo = TRUE');
    return rows;
  }

  async getRecentTransfers() {
    const { rows } = await pool.query(
      `SELECT t.id, t.producto_id, p.nombre AS producto_nombre, p.codigo_sku, 
              t.sede_origen_id, so.nombre AS origen_nombre,
              t.sede_destino_id, sd.nombre AS destino_nombre,
              t.cantidad, t.precio_destino_vigente, t.estado, t.observaciones, t.created_at
       FROM traslados t
       JOIN productos p ON t.producto_id = p.id
       JOIN sedes so ON t.sede_origen_id = so.id
       JOIN sedes sd ON t.sede_destino_id = sd.id
       ORDER BY t.id DESC LIMIT 15`
    );
    return rows;
  }

  async deactivateProduct(id) {
    const { rowCount } = await pool.query(
      'UPDATE productos SET activo = FALSE WHERE id = $1',
      [id]
    );
    return rowCount > 0;
  }
}

export default new InventoryRepository();
