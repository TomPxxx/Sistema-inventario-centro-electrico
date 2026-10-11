require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&sslmode=require' : '?sslmode=require')
});

const CATEGORIAS_DEFINIDAS = [
  { id: 1, nombre: 'Cables y Conductores', desc: 'Cables eléctricos, alambres, duplex, encauchetados y cordones' },
  { id: 2, nombre: 'Tubería y Canalización', desc: 'Tubería EMT, IMC, PVC, canaletas, curvas, uniones y terminales de tubería' },
  { id: 3, nombre: 'Iluminación', desc: 'Bombillos, lámparas, paneles LED, reflectores, tubos LED y balastros' },
  { id: 4, nombre: 'Protecciones Eléctricas', desc: 'Breakers, tacos, totalizadores, fusibles, guardamotores y relés térmicos' },
  { id: 5, nombre: 'Sistemas Solares', desc: 'Paneles solares, inversores, controladores y accesorios solares' },
  { id: 6, nombre: 'Dispositivos y Mecanismos', desc: 'Interruptores, tomacorrientes, clavijas, pulsadores, timbres y placas' },
  { id: 7, nombre: 'Cajas y Tableros', desc: 'Cajas 5800, 4x4, 2x4, octogonales, tableros de distribución y gabinetes' },
  { id: 8, nombre: 'Automatización y Control', desc: 'Contactores, temporizadores, sensores, transformadores y arrancadores' },
  { id: 9, nombre: 'Herrajes y Redes Eléctricas', desc: 'Aisladores, grapas, varillas puesta a tierra, templetes y herrajería aérea' },
  { id: 10, nombre: 'Herramientas y Medición', desc: 'Alicates, destornilladores, pinzas, multímetros, probadores y sondas' },
  { id: 11, nombre: 'Fijación y Consumibles', desc: 'Cintas aislantes, amarras plásticas, tornillos, chazos, soldadura y marquillas' },
  { id: 12, nombre: 'Varios y Telecomunicaciones', desc: 'Cables de red, patch cords, conectores RJ45, adaptadores y varios' }
];

function quitarAcentos(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function clasificarProducto(nombreRaw) {
  const n = ' ' + quitarAcentos(nombreRaw).trim() + ' ';

  // 5. Sistemas Solares
  if (n.includes(' SOLAR') || n.includes('FOTOVOLTAIC') || n.includes('INVERSOR SOLAR') || n.includes('PLANTA SOLAR')) {
    return 5;
  }

  // 7. Cajas y Tableros
  if (
    n.includes('CAJA') || n.includes('TABLERO') || n.includes('COFRE') || n.includes('GABINETE') ||
    n.includes('TAPA CIEGA') || n.includes('OCTOGONAL') || n.includes(' 5800') || n.includes('CENTRO DE CARGA')
  ) {
    return 7;
  }

  // 3. Iluminación
  if (
    n.includes('BOM ') || n.includes('BOM-') || n.includes('BOMBILLO') || n.includes('LAMPARA') ||
    n.includes('PANEL ') || n.includes('PANEL-') || n.includes('PANEL LED') || n.includes('REFLECTOR') ||
    n.includes('BALA ') || n.includes('BALA-') || n.includes('LUMINARIA') || n.includes('BALASTRO') ||
    n.includes('OJO DE BUEY') || n.includes('SPOT') || n.includes('FOCO') || n.includes('CAMPANA') ||
    n.includes('TORTUGA') || n.includes('CINTA LED') || n.includes('PLAFON') || n.includes('PORTALAMPARA') ||
    n.includes('SOCATE') || n.includes('STRIP LED') || n.includes('REFLEC') || n.includes('DIRIGIBLE') ||
    n.includes('APLIQUE') || n.includes('REGLETA LED') || n.includes('TUBO LED') || n.includes('LUCES ')
  ) {
    return 3;
  }

  // 4. Protecciones Eléctricas
  if (
    n.includes('BREAKER') || n.includes('TOTALIZADOR') || n.includes('TACO ') || n.includes('TACO-') ||
    n.includes('GUARDAMOTOR') || n.includes('FUSIBLE') || n.includes('DPS') || n.includes('CUCHILLA') ||
    n.includes('MINIBREAKER') || n.includes('TERMOMAGNETICO') || n.includes('DIFERENCIAL') || n.includes('RELET') ||
    n.includes('RELE TERMICO') || n.includes('PROTECTOR DE VOLTAJE') || n.includes('SECCIONADOR') ||
    n.includes('PORTAFUSIBLE') || n.includes('SEGURIDAD 3X') || n.includes('SEGURIDAD 2X')
  ) {
    return 4;
  }

  // 8. Automatización y Control
  if (
    n.includes('CONTACTOR') || n.includes('SENSOR') || n.includes('TRANSFORMADOR') || n.includes('CONTADOR') ||
    n.includes('REGULADOR') || n.includes('UPS') || n.includes('BORNERA') || n.includes('FOTOCELDA') ||
    n.includes('TEMPORIZADOR') || n.includes('TIMER') || n.includes('ARRANCADOR') || n.includes('ARANCADOR') ||
    n.includes('DISCONTATOR') || n.includes('TERMOSTATO') || n.includes('HOROMETRO') || n.includes('PILOTO')
  ) {
    return 8;
  }

  // 10. Herramientas y Medición
  if (
    n.includes('ALICATE') || n.includes('PINZA') || n.includes('DESTORNILLADOR') || n.includes('MULTIMETRO') ||
    n.includes('SONDA') || n.includes('PROBADOR') || n.includes('BISTURI') || n.includes('SEGUETA') ||
    n.includes('MARTILLO') || n.includes('LLAVE ') || n.includes('TALADRO') || n.includes('CRIMPADORA') ||
    n.includes('PONCHADORA') || n.includes('PELACABLE') || n.includes('AMPERIMETRO') || n.includes('VOLTIMETRO') ||
    n.includes('CALIBRADOR') || n.includes('FLEXOMETRO') || n.includes('HERRAMIENTA') || n.includes('CAIMAN')
  ) {
    return 10;
  }

  // 6. Dispositivos y Mecanismos
  if (
    n.includes('TOMA') || n.includes('CLAVIJA') || n.includes('INTERRUPTOR') || n.includes('INT ') ||
    n.includes('PULSADOR') || n.includes('TIMBRE') || n.includes('MULTITOMA') || n.includes('PLACA ') ||
    n.includes('DIMMER') || n.includes('CONMUTADOR') || n.includes('ENCHUFE') || n.includes('INTERR') ||
    n.includes('SUPRESOR') || n.includes('MODULO TOMA') || n.includes('MODULO INT')
  ) {
    return 6;
  }

  // 9. Herrajes y Redes Eléctricas
  if (
    n.includes('HERRAJERIA') || n.includes('HERRAJERRIA') || n.includes('AISLADOR') || n.includes('VARRILLA') ||
    n.includes('VARILLA') || n.includes('GRAPA') || n.includes('PERCHA') || n.includes('RETENIDA') ||
    n.includes('CRUCETA') || n.includes('TENSOR') || n.includes('BAJANTE') || n.includes('PARARRAYO') ||
    n.includes('TERMINAL CONO') || n.includes('MENSULA')
  ) {
    return 9;
  }

  // 11. Fijación y Consumibles
  if (
    n.includes('CINTA') || n.includes('AMARE') || n.includes('AMARRE') || n.includes('BRIDA') ||
    n.includes('CHAZO') || n.includes('TORNILLO') || n.includes('SOLDADURA') || n.includes('ANILLO MARQUILLA') ||
    n.includes('MARQUILLA') || n.includes('SILICONA') || n.includes('GRASA') || n.includes('ESPIRAL') ||
    n.includes('REATA') || n.includes('TUERCA') || n.includes('ARANDELA') || n.includes('REMACHE') ||
    n.includes('TERMOENCOGIBLE')
  ) {
    return 11;
  }

  // 2. Tubería y Canalización
  if (
    n.includes('TUBO') || n.includes('TUBERIA') || n.includes('EMT') || n.includes('IMC') ||
    n.includes('PVC') || n.includes('CANALETA') || n.includes('CONDULETA') || n.includes('ACOPLE') ||
    n.includes('CAPACETE') || n.includes('CURVA') || n.includes('UNION') || n.includes('CONECTOR CONDUIT') ||
    n.includes('TERMINAL CONDUIT') || n.includes('ABRAZADERA') || n.includes('DEXSON') || n.includes('CORRUGAD')
  ) {
    return 2;
  }

  // 1. Cables y Conductores
  if (
    n.includes('CABLE') || n.includes('ALAMBRE') || n.includes('ENCAUCHETADO') || n.includes('DUPLEX') ||
    n.includes('ANTIFRAUDE') || n.includes('CORDON') || n.includes('CONCENTRICO') || n.includes('POTENCIAL') ||
    n.includes('THHN') || n.includes('SUPERFLEX') || n.includes('SOLDAR') || n.includes('CALIBRE') ||
    n.includes('AWG') || n.includes('CONDUCTOR')
  ) {
    return 1;
  }

  // 12. Varios y Telecomunicaciones
  return 12;
}

async function aplicar() {
  const client = await pool.connect();
  try {
    console.log('Iniciando transacción para actualizar categorías...');
    await client.query('BEGIN');

    // 1. Asegurar categorías en tabla categorias
    for (const cat of CATEGORIAS_DEFINIDAS) {
      const exists = await client.query('SELECT id FROM categorias WHERE id = $1', [cat.id]);
      if (exists.rows.length > 0) {
        await client.query(
          'UPDATE categorias SET nombre = $1, descripcion = $2 WHERE id = $3',
          [cat.nombre, cat.desc, cat.id]
        );
      } else {
        await client.query(
          'INSERT INTO categorias (id, nombre, descripcion) VALUES ($1, $2, $3)',
          [cat.id, cat.nombre, cat.desc]
        );
      }
    }

    // Reset sequence if needed
    await client.query("SELECT setval(pg_get_serial_sequence('categorias', 'id'), (SELECT MAX(id) FROM categorias))");

    // 2. Leer todos los productos
    const prodsRes = await client.query('SELECT id, nombre FROM productos');
    console.log(`Recategorizando ${prodsRes.rows.length} productos en lote...`);

    const batchSize = 500;
    for (let i = 0; i < prodsRes.rows.length; i += batchSize) {
      const chunk = prodsRes.rows.slice(i, i + batchSize);
      const valuesStr = chunk.map(p => `(${p.id}, ${clasificarProducto(p.nombre)})`).join(', ');
      await client.query(`
        UPDATE productos AS p 
        SET categoria_id = v.cat_id 
        FROM (VALUES ${valuesStr}) AS v(prod_id, cat_id) 
        WHERE p.id = v.prod_id
      `);
      console.log(`Procesados ${Math.min(i + batchSize, prodsRes.rows.length)} / ${prodsRes.rows.length}...`);
    }

    await client.query('COMMIT');
    console.log(`✅ ¡Éxito! Todos los productos fueron recategorizados.`);

    // 3. Mostrar conteo final verificado
    const finalCount = await client.query(`
      SELECT c.id, c.nombre, COUNT(p.id) as total_productos
      FROM categorias c
      LEFT JOIN productos p ON p.categoria_id = c.id
      GROUP BY c.id, c.nombre
      ORDER BY c.id
    `);
    console.log('\n--- CONTEO FINAL ORGANIZADO EN BASE DE DATOS ---');
    console.table(finalCount.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al aplicar recategorización:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

aplicar();
