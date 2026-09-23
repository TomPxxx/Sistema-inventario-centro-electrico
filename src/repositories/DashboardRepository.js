import { pool } from '../config/db.js';

class DashboardRepository {
  /**
   * Obtiene el volumen de entradas y salidas agrupado por fecha en los últimos 7 días.
   */
  async getMovementsOverTime(days = 7) {
    const query = `
      SELECT 
        TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as fecha, 
        SUM(CASE WHEN tipo_movimiento IN ('ENTRADA', 'TRASLADO_ENTRADA', 'AJUSTE') AND cantidad > 0 THEN cantidad ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo_movimiento IN ('SALIDA', 'TRASLADO_SALIDA') OR (tipo_movimiento = 'AJUSTE' AND cantidad < 0) THEN ABS(cantidad) ELSE 0 END) as salidas
      FROM movimientos_inventario
      WHERE created_at >= CURRENT_DATE - ($1 * INTERVAL '1 day')
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `;
    const { rows } = await pool.query(query, [days]);
    return rows;
  }

  /**
   * Obtiene los 5 productos con mayor cantidad movida en los últimos 30 días.
   */
  async getTopProducts(limit = 5, days = 30) {
    const query = `
      SELECT 
        p.id, p.nombre, p.codigo_sku, 
        SUM(ABS(m.cantidad)) as total_movido
      FROM movimientos_inventario m
      JOIN productos p ON m.producto_id = p.id
      WHERE m.created_at >= CURRENT_DATE - ($1 * INTERVAL '1 day')
      GROUP BY p.id, p.nombre, p.codigo_sku
      ORDER BY total_movido DESC
      LIMIT $2
    `;
    const { rows } = await pool.query(query, [days, limit]);
    return rows;
  }

  /**
   * Obtiene la distribución del stock total por sede.
   */
  async getStockDistribution() {
    const query = `
      SELECT 
        s.id, s.nombre as sede_nombre, 
        SUM(ps.stock_actual) as stock_total
      FROM producto_sede ps
      JOIN sedes s ON ps.sede_id = s.id
      GROUP BY s.id, s.nombre
      ORDER BY stock_total DESC
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  /**
   * Obtiene todos los movimientos exactos con fecha, hora, cantidades y sedes.
   */
  async getExactMovements() {
    const query = `
      SELECT 
        m.id, m.tipo_movimiento, m.cantidad, m.stock_anterior, m.stock_posterior,
        m.fecha_movimiento, 
        p.nombre as producto_nombre, p.codigo_sku,
        s.nombre as sede_nombre,
        u.nombre_completo as usuario_nombre
      FROM movimientos_inventario m
      JOIN productos p ON m.producto_id = p.id
      JOIN sedes s ON m.sede_id = s.id
      JOIN usuarios u ON m.usuario_id = u.id
      ORDER BY m.fecha_movimiento DESC
      LIMIT 100
    `;
    const { rows } = await pool.query(query);
    return rows;
  }
}

export default new DashboardRepository();
