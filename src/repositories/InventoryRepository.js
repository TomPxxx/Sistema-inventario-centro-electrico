import { pool } from '../config/db.js';

class InventoryRepository {
  async getProducts() {
    const { rows } = await pool.query(
      `SELECT p.id, p.codigo_sku, p.nombre, p.descripcion, p.categoria_id, c.nombre as categoria_nombre, p.unidad_medida, p.imagen_url, p.activo, p.created_at 
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.activo = TRUE 
       ORDER BY p.id ASC`
    );
    return rows;
  }

  async getCategories() {
    const { rows } = await pool.query(
      `SELECT id, nombre, descripcion, imagen_url FROM categorias ORDER BY id ASC`
    );
    return rows;
  }

  async createCategory(nombre, descripcion, imagen_url) {
    const { rows } = await pool.query(
      `INSERT INTO categorias (nombre, descripcion, imagen_url) VALUES ($1, $2, $3) RETURNING *`,
      [nombre, descripcion || null, imagen_url || null]
    );
    return rows[0];
  }

  async findCategoryById(id) {
    const { rows } = await pool.query(
      `SELECT id, nombre, descripcion, imagen_url FROM categorias WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async updateCategory(id, { nombre, descripcion, imagen_url }) {
    const { rows } = await pool.query(
      `UPDATE categorias
       SET nombre = COALESCE($1, nombre),
           descripcion = COALESCE($2, descripcion),
           imagen_url = $3
       WHERE id = $4
       RETURNING *`,
      [nombre ? nombre.trim() : null, descripcion !== undefined ? descripcion : null, imagen_url || null, id]
    );
    return rows[0] || null;
  }

  async deleteCategoryAndReassignProducts(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingRes = await client.query(
        'SELECT id, nombre FROM categorias WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (existingRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }
      const deletedCategory = existingRes.rows[0];

      // Find or create the catch-all 'Sin Categoría' row (must not be the category being deleted)
      let sinCatRes = await client.query(
        `SELECT id, nombre FROM categorias
         WHERE (id = 12 OR LOWER(TRIM(nombre)) IN ('sin categoría', 'sin categoria'))
           AND id <> $1
         ORDER BY CASE WHEN id = 12 THEN 0 ELSE 1 END, id ASC
         LIMIT 1`,
        [id]
      );

      if (Number(id) === 12 || ['sin categoría', 'sin categoria'].includes(deletedCategory.nombre.trim().toLowerCase())) {
        await client.query('ROLLBACK');
        return { isProtected: true, categoryName: deletedCategory.nombre };
      }

      let sinCatId;
      let sinCatName = 'Sin Categoría';
      if (sinCatRes.rowCount > 0) {
        sinCatId = sinCatRes.rows[0].id;
        sinCatName = sinCatRes.rows[0].nombre;
      } else {
        const createdSinCat = await client.query(
          `INSERT INTO categorias (nombre, descripcion)
           VALUES ('Sin Categoría', 'Productos pendientes de clasificación o varios por ubicar')
           RETURNING id, nombre`
        );
        sinCatId = createdSinCat.rows[0].id;
        sinCatName = createdSinCat.rows[0].nombre;
      }

      const moveRes = await client.query(
        'UPDATE productos SET categoria_id = $1 WHERE categoria_id = $2',
        [sinCatId, id]
      );

      await client.query('DELETE FROM categorias WHERE id = $1', [id]);
      await client.query('COMMIT');

      return {
        deleted: deletedCategory,
        movedProductsCount: moveRes.rowCount || 0,
        targetCategoryId: sinCatId,
        targetCategoryName: sinCatName
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
