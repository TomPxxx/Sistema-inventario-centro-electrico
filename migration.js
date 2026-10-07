import { pool } from './src/config/db.js';

async function migrate() {
  try {
    console.log('Migrando tabla usuarios...');
    
    // 1. Quitar constraints actuales que limitan 'estado'
    // En Postgres no es tan sencillo alterar un CHECK constraint sin dropearlo y recrearlo
    // Primero vamos a dropear los constraints que nos molesten, pero si usamos VARCHAR con CHECK inline
    // PostgreSQL los nombra automáticamente (por ejemplo usuarios_estado_check o similar).
    // Si no sabemos el nombre, es mejor usar código dinámico.
    
    // Solución sencilla: Agregar las nuevas columnas directamente
    await pool.query(`ALTER TABLE usuarios ALTER COLUMN password_hash DROP NOT NULL;`);
    console.log('-> password_hash ahora es nullable.');

    // Para evitar conflictos con el CHECK de 'estado', podemos forzar la eliminación del constraint
    // buscando su nombre en information_schema.
    const res = await pool.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'usuarios' AND constraint_type = 'CHECK' AND constraint_name LIKE '%estado%';
    `);
    
    if (res.rows.length > 0) {
      for (const row of res.rows) {
        await pool.query(`ALTER TABLE usuarios DROP CONSTRAINT ${row.constraint_name};`);
      }
    } else {
        // En caso de que se llame de otra forma
        const res2 = await pool.query(`
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'usuarios'::regclass AND consrc ILIKE '%estado%';
        `);
        for (const row of res2.rows) {
            await pool.query(`ALTER TABLE usuarios DROP CONSTRAINT ${row.conname};`);
        }
    }

    // Volver a añadir el CHECK
    await pool.query(`ALTER TABLE usuarios ADD CONSTRAINT usuarios_estado_check CHECK (estado IN ('ACTIVO', 'INACTIVO', 'PENDIENTE', 'RECHAZADO'));`);
    console.log('-> Constraint de estado actualizado.');

    // 2. Añadir nuevas columnas
    // auth_provider
    try {
        await pool.query(`ALTER TABLE usuarios ADD COLUMN auth_provider VARCHAR(50) NOT NULL DEFAULT 'LOCAL' CHECK (auth_provider IN ('LOCAL', 'GOOGLE', 'AMBOS'));`);
        console.log('-> auth_provider añadida.');
    } catch(e) { console.log('auth_provider ya existe o error', e.message); }

    // fecha_aprobacion
    try {
        await pool.query(`ALTER TABLE usuarios ADD COLUMN fecha_aprobacion TIMESTAMP NULL;`);
        console.log('-> fecha_aprobacion añadida.');
    } catch(e) { console.log('fecha_aprobacion ya existe o error', e.message); }

    // admin_aprobador_id
    try {
        await pool.query(`ALTER TABLE usuarios ADD COLUMN admin_aprobador_id INTEGER NULL;`);
        await pool.query(`
            ALTER TABLE usuarios 
            ADD CONSTRAINT fk_usuarios_admin_aprobador 
            FOREIGN KEY (admin_aprobador_id) REFERENCES usuarios(id) 
            ON DELETE SET NULL ON UPDATE CASCADE;
        `);
        console.log('-> admin_aprobador_id añadida.');
    } catch(e) { console.log('admin_aprobador_id ya existe o error', e.message); }

    console.log('¡Migración exitosa!');
    process.exit(0);
  } catch (error) {
    console.error('Error durante la migración:', error);
    process.exit(1);
  }
}

migrate();
