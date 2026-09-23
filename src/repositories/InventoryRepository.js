import { pool } from '../config/db.js';

class InventoryRepository {
  async getProducts() {
    const { rows } = await pool.query(
      `SELECT p.id, p.codigo_sku, p.nombre, p.descripcion, p.categoria_id, c.nombre as categoria_nombre, p.unidad_medida, p.activo, p.created_at 
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.activo = TRUE 
       ORDER BY p.id ASC`
    );
    return rows;
  }

  async getCategories() {
    const { rows } = await pool.query(
      `SELECT id, nombre, descripcion FROM categorias ORDER BY id ASC`
    );
    return rows;
  }

  async createCategory(nombre, descripcion) {
    const { rows } = await pool.query(
      `INSERT INTO categorias (nombre, descripcion) VALUES ($1, $2) RETURNING *`,
      [nombre, descripcion]
    );
    return rows[0];
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
