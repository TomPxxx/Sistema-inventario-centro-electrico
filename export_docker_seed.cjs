require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&sslmode=require' : '?sslmode=require')
});

async function exportSeed() {
  const client = await pool.connect();
  try {
    console.log('Generando volcado de base de datos para Docker...');

    // Leemos el schema base
    const schemaSql = fs.readFileSync(path.join(__dirname, 'database_schema_pg.sql'), 'utf8');

    // Cortamos antes de INSERT INTO productos
    const splitIndex = schemaSql.indexOf('INSERT INTO productos (id, codigo_sku');
    let baseSql = schemaSql;
    if (splitIndex !== -1) {
      baseSql = schemaSql.substring(0, splitIndex);
    }

    let outSql = `-- =============================================================================
-- INICIALIZACIÓN COMPLETA PARA DOCKER POSTGRESQL (SISTEMA DE INVENTARIO CE)
-- Creado automáticamente con datos reales y 3007 productos recategorizados
-- =============================================================================

${baseSql}

-- =============================================================================
-- PRODUCTOS Y STOCK REAL (3000+ PRODUCTOS RECATEGORIZADOS)
-- =============================================================================
`;

    // 1. Exportar productos
    console.log('Exportando productos...');
    const prods = await client.query('SELECT id, codigo_sku, nombre, descripcion, categoria_id, unidad_medida, activo FROM productos ORDER BY id');
    
    outSql += `\n-- Insertando ${prods.rows.length} productos...\n`;
    
    const batchSize = 100;
    for (let i = 0; i < prods.rows.length; i += batchSize) {
      const chunk = prods.rows.slice(i, i + batchSize);
      const values = chunk.map(p => {
        const desc = p.descripcion ? `'${p.descripcion.replace(/'/g, "''")}'` : 'NULL';
        const nom = `'${p.nombre.replace(/'/g, "''")}'`;
        const sku = `'${p.codigo_sku.replace(/'/g, "''")}'`;
        const unit = `'${(p.unidad_medida || 'UNIDAD').replace(/'/g, "''")}'`;
        const cat = p.categoria_id || 1;
        const act = p.activo ? 'TRUE' : 'FALSE';
        return `(${p.id}, ${sku}, ${nom}, ${desc}, ${cat}, ${unit}, ${act})`;
      }).join(',\n');
      
      outSql += `INSERT INTO productos (id, codigo_sku, nombre, descripcion, categoria_id, unidad_medida, activo) VALUES\n${values}\nON CONFLICT (id) DO NOTHING;\n\n`;
    }

    outSql += `SELECT setval('productos_id_seq', (SELECT MAX(id) FROM productos));\n\n`;

    // 2. Exportar producto_sede (stock y precios)
    console.log('Exportando stock de productos por sede...');
    const ps = await client.query('SELECT producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede FROM producto_sede ORDER BY producto_id, sede_id');
    
    outSql += `\n-- Insertando ${ps.rows.length} registros de inventario sede...\n`;
    for (let i = 0; i < ps.rows.length; i += batchSize) {
      const chunk = ps.rows.slice(i, i + batchSize);
      const values = chunk.map(r => {
        const stockAct = r.stock_actual || 0;
        const stockMin = r.stock_minimo || 0;
        const precio = r.precio_venta || 0;
        const disp = r.disponible_en_sede ? 'TRUE' : 'FALSE';
        return `(${r.producto_id}, ${r.sede_id}, ${stockAct}, ${stockMin}, ${precio}, ${disp})`;
      }).join(',\n');
      
      outSql += `INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede) VALUES\n${values}\nON CONFLICT (producto_id, sede_id) DO NOTHING;\n\n`;
    }

    // 3. Crear directorio para docker si no existe
    const targetDir = path.join(__dirname, 'docker-init');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetFile = path.join(targetDir, '01_init.sql');
    fs.writeFileSync(targetFile, outSql, 'utf8');

    console.log(`✅ Archivo exportado exitosamente en: ${targetFile} (${(outSql.length / (1024 * 1024)).toFixed(2)} MB)`);

  } catch (err) {
    console.error('Error generando seed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

exportSeed();
