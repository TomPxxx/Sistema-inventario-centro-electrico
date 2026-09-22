import { pool } from '../config/db.js';

class SedeRepository {
  async findAllActive() {
    const query = `
      SELECT id, nombre, ciudad, direccion, telefono 
      FROM sedes 
      WHERE activo = TRUE 
      ORDER BY id ASC
    `;
    const result = await pool.query(query);
    return result.rows;
  }
}

export default new SedeRepository();
