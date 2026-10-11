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

      function quitarAcentos(str) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
      }
      function clasificar(nombreRaw) {
        const n = ' ' + quitarAcentos(nombreRaw).trim() + ' ';
        if (n.includes(' SOLAR') || n.includes('FOTOVOLTAIC') || n.includes('INVERSOR SOLAR') || n.includes('PLANTA SOLAR')) return 5;
        if (n.includes('CAJA') || n.includes('TABLERO') || n.includes('COFRE') || n.includes('GABINETE') || n.includes('TAPA CIEGA') || n.includes('OCTOGONAL') || n.includes(' 5800') || n.includes('CENTRO DE CARGA')) return 7;
        if (n.includes('BOM ') || n.includes('BOM-') || n.includes('BOMBILLO') || n.includes('LAMPARA') || n.includes('PANEL ') || n.includes('PANEL-') || n.includes('PANEL LED') || n.includes('REFLECTOR') || n.includes('BALA ') || n.includes('BALA-') || n.includes('LUMINARIA') || n.includes('BALASTRO') || n.includes('OJO DE BUEY') || n.includes('SPOT') || n.includes('FOCO') || n.includes('CAMPANA') || n.includes('TORTUGA') || n.includes('CINTA LED') || n.includes('PLAFON') || n.includes('PORTALAMPARA') || n.includes('SOCATE') || n.includes('STRIP LED') || n.includes('REFLEC') || n.includes('DIRIGIBLE') || n.includes('APLIQUE') || n.includes('REGLETA LED') || n.includes('TUBO LED') || n.includes('LUCES ')) return 3;
        if (n.includes('BREAKER') || n.includes('TOTALIZADOR') || n.includes('TACO ') || n.includes('TACO-') || n.includes('GUARDAMOTOR') || n.includes('FUSIBLE') || n.includes('DPS') || n.includes('CUCHILLA') || n.includes('MINIBREAKER') || n.includes('TERMOMAGNETICO') || n.includes('DIFERENCIAL') || n.includes('RELET') || n.includes('RELE TERMICO') || n.includes('PROTECTOR DE VOLTAJE') || n.includes('SECCIONADOR') || n.includes('PORTAFUSIBLE') || n.includes('SEGURIDAD 3X') || n.includes('SEGURIDAD 2X')) return 4;
        if (n.includes('CONTACTOR') || n.includes('SENSOR') || n.includes('TRANSFORMADOR') || n.includes('CONTADOR') || n.includes('REGULADOR') || n.includes('UPS') || n.includes('BORNERA') || n.includes('FOTOCELDA') || n.includes('TEMPORIZADOR') || n.includes('TIMER') || n.includes('ARRANCADOR') || n.includes('ARANCADOR') || n.includes('DISCONTATOR') || n.includes('TERMOSTATO') || n.includes('HOROMETRO') || n.includes('PILOTO')) return 8;
        if (n.includes('ALICATE') || n.includes('PINZA') || n.includes('DESTORNILLADOR') || n.includes('MULTIMETRO') || n.includes('SONDA') || n.includes('PROBADOR') || n.includes('BISTURI') || n.includes('SEGUETA') || n.includes('MARTILLO') || n.includes('LLAVE ') || n.includes('TALADRO') || n.includes('CRIMPADORA') || n.includes('PONCHADORA') || n.includes('PELACABLE') || n.includes('AMPERIMETRO') || n.includes('VOLTIMETRO') || n.includes('CALIBRADOR') || n.includes('FLEXOMETRO') || n.includes('HERRAMIENTA') || n.includes('CAIMAN')) return 10;
        if (n.includes('TOMA') || n.includes('CLAVIJA') || n.includes('INTERRUPTOR') || n.includes('INT ') || n.includes('PULSADOR') || n.includes('TIMBRE') || n.includes('MULTITOMA') || n.includes('PLACA ') || n.includes('DIMMER') || n.includes('CONMUTADOR') || n.includes('ENCHUFE') || n.includes('INTERR') || n.includes('SUPRESOR') || n.includes('MODULO TOMA') || n.includes('MODULO INT')) return 6;
        if (n.includes('HERRAJERIA') || n.includes('HERRAJERRIA') || n.includes('AISLADOR') || n.includes('VARRILLA') || n.includes('VARILLA') || n.includes('GRAPA') || n.includes('PERCHA') || n.includes('RETENIDA') || n.includes('CRUCETA') || n.includes('TENSOR') || n.includes('BAJANTE') || n.includes('PARARRAYO') || n.includes('TERMINAL CONO') || n.includes('MENSULA')) return 9;
        if (n.includes('CINTA') || n.includes('AMARE') || n.includes('AMARRE') || n.includes('BRIDA') || n.includes('CHAZO') || n.includes('TORNILLO') || n.includes('SOLDADURA') || n.includes('ANILLO MARQUILLA') || n.includes('MARQUILLA') || n.includes('SILICONA') || n.includes('GRASA') || n.includes('ESPIRAL') || n.includes('REATA') || n.includes('TUERCA') || n.includes('ARANDELA') || n.includes('REMACHE') || n.includes('TERMOENCOGIBLE')) return 11;
        if (n.includes('TUBO') || n.includes('TUBERIA') || n.includes('EMT') || n.includes('IMC') || n.includes('PVC') || n.includes('CANALETA') || n.includes('CONDULETA') || n.includes('ACOPLE') || n.includes('CAPACETE') || n.includes('CURVA') || n.includes('UNION') || n.includes('CONECTOR CONDUIT') || n.includes('TERMINAL CONDUIT') || n.includes('ABRAZADERA') || n.includes('DEXSON') || n.includes('CORRUGAD')) return 2;
        if (n.includes('CABLE') || n.includes('ALAMBRE') || n.includes('ENCAUCHETADO') || n.includes('DUPLEX') || n.includes('ANTIFRAUDE') || n.includes('CORDON') || n.includes('CONCENTRICO') || n.includes('POTENCIAL') || n.includes('THHN') || n.includes('SUPERFLEX') || n.includes('SOLDAR') || n.includes('CALIBRE') || n.includes('AWG') || n.includes('CONDUCTOR')) return 1;
        return 12;
      }

      let catId = clasificar(name);

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
