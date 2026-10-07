import { pool } from '../config/db.js';

export async function generateSqlDump() {
  const tables = [
    'sedes', 'usuarios', 'categorias', 'productos', 'producto_sede', 
    'solicitudes_material', 'traslados', 'movimientos_inventario', 
    'token_blacklist', 'usuario_politicas', 'recepciones_mercancia', 'recepcion_productos'
  ];

  let sql = '-- Backup de la Base de Datos Sistema Inventario CE\n';
  sql += '-- Generado automaticamente\n\n';
  
  sql += 'BEGIN;\n\n';
  
  // Desactivar constraints de FK si es necesario, pero TRUNCATE CASCADE lo hace mas facil
  for (const table of [...tables].reverse()) {
    sql += `TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE;\n`;
  }
  sql += '\n';

  for (const table of tables) {
    let result;
    try {
      result = await pool.query(`SELECT * FROM ${table}`);
    } catch(e) {
      console.error(`Error copiando la tabla ${table}`, e);
      continue;
    }

    if (result.rows.length === 0) continue;

    const columns = Object.keys(result.rows[0]);
    
    for (const row of result.rows) {
      const values = columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return val;
        if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
        if (val instanceof Date) return `'${val.toISOString()}'`;
        // Escapar comillas simples
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      sql += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
    }
    sql += '\n';
  }

  sql += 'COMMIT;\n';
  return sql;
}
