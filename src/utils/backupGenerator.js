import { pool as defaultPool } from '../config/db.js';

export const SCHEMA_DDL = `
-- 1. EXTENSIONES Y FUNCIONES
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

-- 2. TABLA: sedes
CREATE TABLE IF NOT EXISTS sedes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    ciudad VARCHAR(100) NOT NULL,
    direccion VARCHAR(255) NULL,
    telefono VARCHAR(20) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_sedes_updated_at') THEN
    CREATE TRIGGER update_sedes_updated_at BEFORE UPDATE ON sedes FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- 3. TABLA: usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(150) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    rol VARCHAR(50) NOT NULL CHECK (rol IN ('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO', 'PENDIENTE')),
    sede_id INTEGER NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO', 'PENDIENTE', 'RECHAZADO')),
    auth_provider VARCHAR(50) NOT NULL DEFAULT 'LOCAL' CHECK (auth_provider IN ('LOCAL', 'GOOGLE', 'AMBOS')),
    fecha_aprobacion TIMESTAMP NULL,
    admin_aprobador_id INTEGER NULL,
    ultimo_login TIMESTAMP NULL,
    token_recuperacion VARCHAR(64) NULL,
    token_recuperacion_expira TIMESTAMP NULL,
    current_session_token VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuarios_sede FOREIGN KEY (sede_id) REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_usuarios_admin_aprobador FOREIGN KEY (admin_aprobador_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_usuarios_updated_at') THEN
    CREATE TRIGGER update_usuarios_updated_at BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- 4. TABLA: categorias
CREATE TABLE IF NOT EXISTS categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT NULL,
    imagen_url VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_categorias_updated_at') THEN
    CREATE TRIGGER update_categorias_updated_at BEFORE UPDATE ON categorias FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- 5. TABLA: productos
CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    codigo_sku VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT NULL,
    categoria_id INTEGER NULL REFERENCES categorias(id) ON DELETE SET NULL ON UPDATE CASCADE,
    unidad_medida VARCHAR(20) NOT NULL DEFAULT 'UNIDAD',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    imagen_url VARCHAR(255) NULL,
    marca VARCHAR(100) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_productos_sku ON productos (codigo_sku);
CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos (nombre);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_productos_updated_at') THEN
    CREATE TRIGGER update_productos_updated_at BEFORE UPDATE ON productos FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- 6. TABLA: producto_sede
CREATE TABLE IF NOT EXISTS producto_sede (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    sede_id INTEGER NOT NULL REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    stock_actual DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (stock_actual >= 0.00),
    stock_minimo DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (stock_minimo >= 0.00),
    precio_venta DECIMAL(12,2) NOT NULL CHECK (precio_venta >= 0.00),
    disponible_en_sede BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_producto_sede UNIQUE (producto_id, sede_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_producto_sede_updated_at') THEN
    CREATE TRIGGER update_producto_sede_updated_at BEFORE UPDATE ON producto_sede FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- 7. TABLA: solicitudes_material
CREATE TABLE IF NOT EXISTS solicitudes_material (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NULL REFERENCES productos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    sede_solicitante_id INTEGER NOT NULL REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    sede_proveedora_id INTEGER NULL REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    usuario_solicitante_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    cantidad_solicitada DECIMAL(10,2) NOT NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE',
    motivo_solicitud VARCHAR(255) NULL,
    motivo_rechazo VARCHAR(255) NULL,
    usuario_respuesta_id INTEGER NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    fecha_respuesta TIMESTAMP NULL,
    tipo VARCHAR(50) NULL DEFAULT 'INDIVIDUAL',
    cantidad_aprobada DECIMAL(10,2) NULL,
    empleado_corredor_id INTEGER NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    items_json JSONB NULL,
    sedes_rechazadas_json JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes_material (estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_sede_solicitante ON solicitudes_material (sede_solicitante_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_solicitudes_updated_at') THEN
    CREATE TRIGGER update_solicitudes_updated_at BEFORE UPDATE ON solicitudes_material FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- 8. TABLA: traslados
CREATE TABLE IF NOT EXISTS traslados (
    id SERIAL PRIMARY KEY,
    solicitud_id INTEGER NULL REFERENCES solicitudes_material(id) ON DELETE SET NULL ON UPDATE RESTRICT,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    sede_origen_id INTEGER NOT NULL REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    sede_destino_id INTEGER NOT NULL REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    cantidad DECIMAL(10,2) NOT NULL CHECK (cantidad > 0.00),
    precio_destino_vigente DECIMAL(12,2) NOT NULL CHECK (precio_destino_vigente >= 0.00),
    usuario_envia_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    usuario_recibe_id INTEGER NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'COMPLETADO', 'CANCELADO')),
    observaciones VARCHAR(255) NULL,
    fecha_envio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_recepcion TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_traslado_sedes_distintas CHECK (sede_origen_id <> sede_destino_id)
);

CREATE INDEX IF NOT EXISTS idx_traslados_estado ON traslados (estado);
CREATE INDEX IF NOT EXISTS idx_traslados_origen_destino ON traslados (sede_origen_id, sede_destino_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_traslados_updated_at') THEN
    CREATE TRIGGER update_traslados_updated_at BEFORE UPDATE ON traslados FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- 9. TABLA: movimientos_inventario
CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id SERIAL PRIMARY KEY,
    tipo_movimiento VARCHAR(50) NOT NULL,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    sede_id INTEGER NOT NULL REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    cantidad DECIMAL(10,2) NOT NULL CHECK (cantidad > 0.00),
    stock_anterior DECIMAL(10,2) NOT NULL CHECK (stock_anterior >= 0.00),
    stock_posterior DECIMAL(10,2) NOT NULL CHECK (stock_posterior >= 0.00),
    precio_unitario DECIMAL(12,2) NULL,
    traslado_id INTEGER NULL REFERENCES traslados(id) ON DELETE SET NULL ON UPDATE RESTRICT,
    referencia_documento VARCHAR(100) NULL,
    motivo_observacion TEXT NULL,
    fecha_movimiento TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_movimientos_sede_fecha ON movimientos_inventario (sede_id, fecha_movimiento);
CREATE INDEX IF NOT EXISTS idx_movimientos_producto ON movimientos_inventario (producto_id);

-- 10. TABLA: token_blacklist
CREATE TABLE IF NOT EXISTS token_blacklist (
    id SERIAL PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_token ON token_blacklist (token);

-- 11. TABLA: usuario_politicas
CREATE TABLE IF NOT EXISTS usuario_politicas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
    version VARCHAR(20) NOT NULL,
    aceptada_el TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_usuario_version UNIQUE (usuario_id, version)
);

-- 12. TABLA: recepciones_mercancia
CREATE TABLE IF NOT EXISTS recepciones_mercancia (
    id SERIAL PRIMARY KEY,
    sede_receptora_id INTEGER NOT NULL REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    encargado_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    empleado_id INTEGER NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    administrador_id INTEGER NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE_CONTEO',
    observaciones TEXT NULL,
    fecha_recepcion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_recepciones_mercancia_updated_at') THEN
    CREATE TRIGGER update_recepciones_mercancia_updated_at BEFORE UPDATE ON recepciones_mercancia FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recepciones_estado ON recepciones_mercancia (estado);
CREATE INDEX IF NOT EXISTS idx_recepciones_sede ON recepciones_mercancia (sede_receptora_id);

-- 13. TABLA: recepcion_productos
CREATE TABLE IF NOT EXISTS recepcion_productos (
    id SERIAL PRIMARY KEY,
    recepcion_id INTEGER NOT NULL REFERENCES recepciones_mercancia(id) ON DELETE CASCADE ON UPDATE CASCADE,
    codigo_sku VARCHAR(50) NOT NULL,
    nombre_producto VARCHAR(255) NULL,
    marca VARCHAR(100) NULL,
    producto_id INTEGER NULL REFERENCES productos(id) ON DELETE SET NULL ON UPDATE CASCADE,
    cantidad_recibida DECIMAL(10,2) NOT NULL CHECK (cantidad_recibida > 0.00),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_recepcion_productos_updated_at') THEN
    CREATE TRIGGER update_recepcion_productos_updated_at BEFORE UPDATE ON recepcion_productos FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- 14. TABLA: audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NULL REFERENCES usuarios(id) ON DELETE SET NULL,
    username VARCHAR(100) NOT NULL DEFAULT 'SISTEMA',
    accion VARCHAR(100) NOT NULL,
    detalles TEXT NULL,
    ip_address VARCHAR(50) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario ON audit_logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_accion ON audit_logs(accion);

-- 15. ASEGURAR COLUMNAS Y CONSTRAINTS EN TABLAS PREEXISTENTES (MIGRACIONES IDEMPOTENTES)
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255) DEFAULT NULL;

ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255) DEFAULT NULL;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS marca VARCHAR(100) DEFAULT NULL;

ALTER TABLE solicitudes_material ADD COLUMN IF NOT EXISTS tipo VARCHAR(50) DEFAULT 'INDIVIDUAL';
ALTER TABLE solicitudes_material ADD COLUMN IF NOT EXISTS cantidad_aprobada DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE solicitudes_material ADD COLUMN IF NOT EXISTS empleado_corredor_id INTEGER DEFAULT NULL;
ALTER TABLE solicitudes_material ADD COLUMN IF NOT EXISTS items_json JSONB DEFAULT NULL;
ALTER TABLE solicitudes_material ADD COLUMN IF NOT EXISTS sedes_rechazadas_json JSONB DEFAULT NULL;
ALTER TABLE solicitudes_material ALTER COLUMN producto_id DROP NOT NULL;
ALTER TABLE solicitudes_material DROP CONSTRAINT IF EXISTS solicitudes_material_estado_check;
ALTER TABLE traslados DROP CONSTRAINT IF EXISTS traslados_estado_check;

ALTER TABLE recepcion_productos ADD COLUMN IF NOT EXISTS nombre_producto VARCHAR(255) DEFAULT NULL;
ALTER TABLE recepcion_productos ADD COLUMN IF NOT EXISTS marca VARCHAR(100) DEFAULT NULL;
ALTER TABLE recepcion_productos ADD COLUMN IF NOT EXISTS producto_id INTEGER DEFAULT NULL;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) NOT NULL DEFAULT 'LOCAL';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMP NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS admin_aprobador_id INTEGER NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS current_session_token VARCHAR(255) NULL;
ALTER TABLE usuarios ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_estado_check;
`;

export async function generateSqlDump(pool = defaultPool) {
  const tables = [
    'sedes', 
    'usuarios', 
    'categorias', 
    'productos', 
    'producto_sede', 
    'solicitudes_material', 
    'traslados', 
    'movimientos_inventario', 
    'token_blacklist', 
    'usuario_politicas', 
    'recepciones_mercancia', 
    'recepcion_productos',
    'audit_logs'
  ];

  let sql = '-- =============================================================================\n';
  sql += '-- COPIA DE SEGURIDAD SISTEMA DE INVENTARIO CENTRO ELÉCTRICO\n';
  sql += `-- Fecha de generación: ${new Date().toISOString()}\n`;
  sql += '-- Incluye esquema completo (DDL) y datos (DML) auto-recuperables\n';
  sql += '-- Compatible con Docker, Neon Cloud, pgAdmin y psql\n';
  sql += '-- =============================================================================\n\n';
  
  // Agregar DDL completo para auto-creación de tablas si alguna fue eliminada
  sql += '-- >>> SECCIÓN 1: ESTRUCTURA DE TABLAS (DDL) <<<\n';
  sql += SCHEMA_DDL;
  sql += '\n-- >>> SECCIÓN 2: LIMPIEZA PREVIA Y RESTAURACIÓN DE DATOS (DML) <<<\n';
  sql += 'BEGIN;\n\n';

  // Truncar todas las tablas existentes en orden seguro usando bloque DO para tolerar tablas faltantes
  sql += 'DO $$ \nBEGIN\n';
  sql += '  TRUNCATE TABLE \n';
  sql += '    audit_logs,\n';
  sql += '    recepcion_productos,\n';
  sql += '    recepciones_mercancia,\n';
  sql += '    usuario_politicas,\n';
  sql += '    token_blacklist,\n';
  sql += '    movimientos_inventario,\n';
  sql += '    traslados,\n';
  sql += '    solicitudes_material,\n';
  sql += '    producto_sede,\n';
  sql += '    productos,\n';
  sql += '    categorias,\n';
  sql += '    usuarios,\n';
  sql += '    sedes\n';
  sql += '  RESTART IDENTITY CASCADE;\n';
  sql += 'EXCEPTION WHEN OTHERS THEN\n';
  sql += '  NULL;\n';
  sql += 'END $$;\n\n';

  for (const table of tables) {
    let result;
    try {
      result = await pool.query(`SELECT * FROM ${table} ORDER BY id ASC`);
    } catch(e) {
      try {
        result = await pool.query(`SELECT * FROM ${table}`);
      } catch(e2) {
        continue;
      }
    }

    if (!result || result.rows.length === 0) continue;

    const columns = Object.keys(result.rows[0]);
    sql += `-- Datos de la tabla: ${table} (${result.rows.length} filas)\n`;

    const chunkSize = 100;
    for (let i = 0; i < result.rows.length; i += chunkSize) {
      const chunk = result.rows.slice(i, i + chunkSize);
      const rowsSql = chunk.map(row => {
        const rowVals = columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val;
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          if (val instanceof Date) return `'${val.toISOString()}'`;
          if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
          return `'${String(val).replace(/'/g, "''")}'`;
        });
        return `(${rowVals.join(', ')})`;
      }).join(',\n');

      sql += `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${rowsSql};\n`;
    }

    // Actualizar la secuencia del ID si la tabla tiene ID serial
    if (columns.includes('id')) {
      sql += `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1));\n`;
    }
    sql += '\n';
  }

  sql += 'COMMIT;\n';
  return sql;
}
