import { pool } from '../config/db.js';

class UserRepository {
  async findByUsernameOrEmail(identifier) {
    const query = `
      SELECT u.id, u.nombre_completo, u.username, u.email, u.password_hash, u.rol, 
             u.sede_id, u.estado, u.ultimo_login, s.nombre AS sede_nombre, s.direccion AS sede_direccion
      FROM usuarios u
      LEFT JOIN sedes s ON u.sede_id = s.id
      WHERE u.username = $1 OR u.email = $2
    `;
    const result = await pool.query(query, [identifier, identifier]);
    return result.rows[0];
  }

  async findById(id) {
    const query = `
      SELECT u.id, u.nombre_completo, u.username, u.email, u.rol, u.sede_id, u.estado, 
             s.nombre AS sede_nombre, s.direccion AS sede_direccion
      FROM usuarios u
      LEFT JOIN sedes s ON u.sede_id = s.id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  async checkExists(username, email) {
    const query = `
      SELECT id, username, email 
      FROM usuarios 
      WHERE username = $1 OR (email IS NOT NULL AND email = $2)
    `;
    const result = await pool.query(query, [username, email]);
    return result.rows;
  }

  async create(user) {
    const query = `
      INSERT INTO usuarios (nombre_completo, username, email, password_hash, rol, sede_id, estado)
      VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO')
      RETURNING id
    `;
    const values = [
      user.nombre_completo, 
      user.username, 
      user.email, 
      user.password_hash, 
      user.rol, 
      user.sede_id
    ];
    const result = await pool.query(query, values);
    return result.rows[0].id;
  }

  async updateLastLogin(id) {
    const query = `UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1`;
    await pool.query(query, [id]);
  }

  async setRecoveryToken(id, token, expiresAt) {
    const query = `
      UPDATE usuarios 
      SET token_recuperacion = $1, token_recuperacion_expira = $2 
      WHERE id = $3
    `;
    await pool.query(query, [token, expiresAt, id]);
  }

  async findByRecoveryToken(identifier, token) {
    const query = `
      SELECT id, username, email, token_recuperacion, token_recuperacion_expira 
      FROM usuarios 
      WHERE (username = $1 OR email = $2) AND token_recuperacion = $3
    `;
    const result = await pool.query(query, [identifier, identifier, token]);
    return result.rows[0];
  }

  async resetPasswordAndClearToken(id, newPasswordHash) {
    const query = `
      UPDATE usuarios 
      SET password_hash = $1, token_recuperacion = NULL, token_recuperacion_expira = NULL 
      WHERE id = $2
    `;
    await pool.query(query, [newPasswordHash, id]);
  }

  // --- POLÍTICA DE DATOS ---
  
  async hasAcceptedPolicy(usuarioId, version) {
    const query = `
      SELECT id FROM usuario_politicas 
      WHERE usuario_id = $1 AND version = $2
    `;
    const result = await pool.query(query, [usuarioId, version]);
    return result.rows.length > 0;
  }

  async acceptPolicy(usuarioId, version) {
    const query = `
      INSERT INTO usuario_politicas (usuario_id, version)
      VALUES ($1, $2)
      ON CONFLICT (usuario_id, version) DO NOTHING
    `;
    await pool.query(query, [usuarioId, version]);
  }
}

export default new UserRepository();
