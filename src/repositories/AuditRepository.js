import { pool as db } from '../config/db.js';

class AuditRepository {
  async logAction(usuarioId, username, accion, detalles, ipAddress) {
    try {
      const sql = `
        INSERT INTO audit_logs (usuario_id, username, accion, detalles, ip_address)
        VALUES ($1, $2, $3, $4, $5)
      `;
      const params = [usuarioId || null, username || 'SISTEMA', accion, detalles, ipAddress || null];
      await db.query(sql, params);
    } catch (err) {
      console.error('[Audit Log Error]', err);
    }
  }

  async getLogs(limit = 100) {
    const sql = `
      SELECT id, usuario_id, username, accion, detalles, ip_address, created_at
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const result = await db.query(sql, [limit]);
    return result.rows;
  }
}

export default new AuditRepository();
