require('dotenv').config();
const xlsx = require('xlsx');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL + '?sslmode=require' });

async function run() {
  const client = await pool.connect();
  try {
    console.log("Leyendo archivo Excel...");
    const workbook = xlsx.readFile('LISTA DE PRECIOS GRUPO ELECTRICO.xlsx');
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    console.log(`Total de filas leídas: ${data.length}`);

    await client.query('BEGIN');

    let insertedCount = 0;
    let skippedCount = 0;

    console.log("Obteniendo sedes...");
    const sedesRes = await client.query('SELECT id FROM sedes WHERE activo = true');
    const sedesIds = sedesRes.rows.map(r => r.id);
    console.log("Sedes encontradas: ", sedesIds);

    console.log("Buscando max SKU...");
    const skuRes = await client.query("SELECT codigo_sku FROM productos WHERE codigo_sku LIKE 'GE-%'");
    let maxSku = 0;
    for (const r of skuRes.rows) {
      const parts = r.codigo_sku.split('-');
      if (parts.length === 2 && !isNaN(parseInt(parts[1]))) {
        maxSku = Math.max(maxSku, parseInt(parts[1]));
      }
    }
    let nextSkuNumber = maxSku + 1;
    console.log("Proximo SKU será: GE-" + nextSkuNumber.toString().padStart(5, '0'));

    let prodValues = [];
    let prodParams = [];

    for (let i = 4; i < data.length; i++) { // Skip headers
      const row = data[i];
      if (!row) continue;

      const flag = (row[1] || '').toString().trim().toLowerCase();
      
      if (flag === 'no' || flag === 'no se' || flag === 'nose') {
        skippedCount++;
        continue;
      }

      const name = (row[2] || '').toString().trim();
      if (!name) {
        skippedCount++;
        continue;
      }

      let unit = (row[3] || '').toString().trim().toUpperCase();
      if (!unit) unit = 'UNIDAD';

      let maxPrice = 0;
      for (let j = 4; j < row.length; j++) {
        const val = row[j];
        if (typeof val === 'number') {
          maxPrice = Math.max(maxPrice, val);
        } else if (typeof val === 'string') {
          let cleanVal = val.replace(/[^0-9,.-]/g, '');
          cleanVal = cleanVal.replace(/\./g, '').replace(',', '.');
          const num = parseFloat(cleanVal);
          if (!isNaN(num)) {
            maxPrice = Math.max(maxPrice, num);
          }
        }
      }

      if (maxPrice <= 0) {
        skippedCount++;
        continue;
      }

      const sku = `GE-${nextSkuNumber.toString().padStart(5, '0')}`;
      nextSkuNumber++;

      let catId = 1;
      const nameUpper = name.toUpperCase();
      if (nameUpper.includes('TUBO') || nameUpper.includes('TUBERIA') || nameUpper.includes('PVC') || nameUpper.includes('EMT')) catId = 2;
      else if (nameUpper.includes('ALAMBRE')) catId = 3;
      else if (nameUpper.includes('BREAKER') || nameUpper.includes('TOTALIZADOR') || nameUpper.includes('TACO')) catId = 4;
      else if (nameUpper.includes('SOLAR')) catId = 5;

      const offset = prodValues.length * 4;
      prodValues.push(`($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, true)`);
      prodParams.push(sku, name, unit, catId);

      // We need to keep track of prices for the sede insert
      // But it's easier to just insert products in a chunk, get IDs, and then insert sedes.
    }

    console.log(`Productos válidos a insertar: ${prodValues.length}`);

    // Insert products in chunks of 500
    const chunkSize = 500;
    for (let c = 0; c < prodValues.length; c += chunkSize) {
      const vChunk = prodValues.slice(c, c + chunkSize);
      const pChunk = prodParams.slice(c * 4, (c + chunkSize) * 4);

      // Re-adjust parameters indexing
      const adjustedValues = vChunk.map((val, idx) => {
        const off = idx * 4;
        return `($${off+1}, $${off+2}, $${off+3}, $${off+4}, true)`;
      });

      const query = `INSERT INTO productos (codigo_sku, nombre, unidad_medida, categoria_id, activo) VALUES ${adjustedValues.join(', ')} RETURNING id, nombre`;
      
      const res = await client.query(query, pChunk);

      // Now insert into producto_sede
      let sedeValues = [];
      let sedeParams = [];

      for (let pIdx = 0; pIdx < res.rows.length; pIdx++) {
        const prod = res.rows[pIdx];
        const originalIndex = c + pIdx;
        
        // we need to find the price again
        const row = data.find(r => r && r[2] && r[2].toString().trim() === prod.nombre);
        let maxPrice = 0;
        if (row) {
          for (let j = 4; j < row.length; j++) {
            const val = row[j];
            if (typeof val === 'number') maxPrice = Math.max(maxPrice, val);
            else if (typeof val === 'string') {
              let cleanVal = val.replace(/[^0-9,.-]/g, '');
              cleanVal = cleanVal.replace(/\./g, '').replace(',', '.');
              const num = parseFloat(cleanVal);
              if (!isNaN(num)) maxPrice = Math.max(maxPrice, num);
            }
          }
        }

        for (const sedeId of sedesIds) {
          const off = sedeValues.length * 5;
          sedeValues.push(`($${off+1}, $${off+2}, 0, 5, $${off+3})`);
          sedeParams.push(prod.id, sedeId, maxPrice);
        }
      }

      if (sedeValues.length > 0) {
        // chunk the sede inserts too since it can exceed max parameters (65535)
        const sedeChunkSize = 1000;
        for (let sc = 0; sc < sedeValues.length; sc += sedeChunkSize) {
           const scV = sedeValues.slice(sc, sc + sedeChunkSize);
           const scP = sedeParams.slice(sc * 3, (sc + sedeChunkSize) * 3);
           const scAdjV = scV.map((_, idx) => `($${idx*3+1}, $${idx*3+2}, 0, 5, $${idx*3+3})`);
           await client.query(`INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta) VALUES ${scAdjV.join(', ')}`, scP);
        }
      }

      insertedCount += res.rows.length;
      console.log(`Lote insertado: ${insertedCount}`);
    }

    await client.query('COMMIT');
    console.log(`¡Migración exitosa! Productos insertados: ${insertedCount}. Ignorados/Sin precio: ${skippedCount}.`);

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error durante la migración:', e);
  } finally {
    client.release();
    pool.end();
  }
}

run();
