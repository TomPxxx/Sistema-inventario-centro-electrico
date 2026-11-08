import { pool } from '../config/db.js';

class DashboardRepository {
  /**
   * Obtiene el volumen de entradas y salidas agrupado por fecha en los últimos 7 días.
   */
  async getMovementsOverTime(days = 7) {
    const query = `
      WITH dates AS (
        SELECT TO_CHAR(d::date, 'YYYY-MM-DD') AS fecha, d::date AS f_date
        FROM generate_series(CURRENT_DATE - (($1 - 1) * INTERVAL '1 day'), CURRENT_DATE, INTERVAL '1 day') d
      )
      SELECT 
        d.fecha, 
        COALESCE(SUM(CASE WHEN m.tipo_movimiento IN ('ENTRADA', 'TRASLADO_ENTRADA', 'AJUSTE') AND m.cantidad > 0 THEN m.cantidad ELSE 0 END), 0) as entradas,
        COALESCE(SUM(CASE WHEN m.tipo_movimiento IN ('SALIDA', 'TRASLADO_SALIDA') OR (m.tipo_movimiento = 'AJUSTE' AND m.cantidad < 0) THEN ABS(m.cantidad) ELSE 0 END), 0) as salidas
      FROM dates d
      LEFT JOIN movimientos_inventario m ON DATE(m.created_at) = d.f_date
      GROUP BY d.fecha, d.f_date
      ORDER BY d.f_date ASC
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
  async getExactMovements(limit = 15, offset = 0) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 15, 200));
    const safeOffset = Math.max(0, Number(offset) || 0);
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
      ORDER BY m.fecha_movimiento DESC, m.id DESC
      LIMIT $1 OFFSET $2
    `;
    const { rows } = await pool.query(query, [safeLimit, safeOffset]);
    return rows;
  }

  /**
   * Obtiene el conteo total de movimientos registrados y métricas de almacenamiento.
   */
  async getMovementsTotalCount() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM movimientos_inventario');
    return rows[0]?.total || 0;
  }

  /**
   * Crea índices compuestos de alto rendimiento para consultas paginadas (20+ años de operación)
   * y tabla de archivo histórico (Cold Storage).
   */
  async ensurePerformanceIndexes() {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_mov_inv_fecha_id_desc 
      ON movimientos_inventario (fecha_movimiento DESC, id DESC);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_mov_inv_created_at 
      ON movimientos_inventario (created_at DESC);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS movimientos_inventario_archivo (
        LIKE movimientos_inventario INCLUDING ALL
      );
    `).catch(() => {});
  }

  /**
   * Archiva y purga movimientos antiguos (mayores a retentionMonths meses) hacia movimientos_inventario_archivo
   * y ejecuta ANALYZE para mantener el motor rápido por décadas.
   */
  async archiveOldMovements(retentionMonths = 24) {
    const safeMonths = Math.max(6, Math.min(Number(retentionMonths) || 24, 120));
    await this.ensurePerformanceIndexes();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const moveRes = await client.query(
        `WITH moved AS (
           DELETE FROM movimientos_inventario
           WHERE fecha_movimiento < NOW() - ($1 || ' months')::interval
           RETURNING *
         )
         INSERT INTO movimientos_inventario_archivo
         SELECT * FROM moved`,
        [safeMonths]
      );
      await client.query('COMMIT');
      await pool.query('ANALYZE movimientos_inventario').catch(() => {});
      return {
        archivedCount: moveRes.rowCount || 0,
        retentionMonths: safeMonths
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export default new DashboardRepository();
