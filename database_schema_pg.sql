-- =============================================================================
-- SISTEMA DE INVENTARIO MULTISEDE PARA MATERIAL ELÉCTRICO
-- Motor: PostgreSQL
-- =============================================================================

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- 1. EXTENSIONES Y FUNCIONES BASE
-- Función genérica para simular ON UPDATE CURRENT_TIMESTAMP de MySQL
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

-- =============================================================================
-- 2. TABLA: sedes
-- =============================================================================
CREATE TABLE sedes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    ciudad VARCHAR(100) NOT NULL,
    direccion VARCHAR(255) NULL,
    telefono VARCHAR(20) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_sedes_updated_at BEFORE UPDATE ON sedes FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- =============================================================================
-- 3. TABLA: usuarios
-- =============================================================================
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(150) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(50) NOT NULL CHECK (rol IN ('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO', 'PENDIENTE')),
    sede_id INTEGER NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO')),
    ultimo_login TIMESTAMP NULL,
    token_recuperacion VARCHAR(64) NULL,
    token_recuperacion_expira TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_usuarios_sede
        FOREIGN KEY (sede_id) REFERENCES sedes(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT chk_usuario_sede_por_rol CHECK (
        (rol = 'ENCARGADO' AND sede_id IS NOT NULL) OR
        (rol IN ('ADMINISTRADOR', 'EMPLEADO', 'PENDIENTE') AND sede_id IS NULL)
    )
);

CREATE TRIGGER update_usuarios_updated_at BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- =============================================================================
-- 4. TABLA: categorias
-- =============================================================================
CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_categorias_updated_at BEFORE UPDATE ON categorias FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- =============================================================================
-- 4.5. TABLA: productos
-- =============================================================================
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    codigo_sku VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT NULL,
    categoria_id INTEGER NULL,
    unidad_medida VARCHAR(20) NOT NULL DEFAULT 'UNIDAD',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_productos_categoria
        FOREIGN KEY (categoria_id) REFERENCES categorias(id)
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TRIGGER update_productos_updated_at BEFORE UPDATE ON productos FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE INDEX idx_productos_sku ON productos (codigo_sku);
CREATE INDEX idx_productos_nombre ON productos (nombre);

-- =============================================================================
-- 5. TABLA: producto_sede
-- =============================================================================
CREATE TABLE producto_sede (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL,
    sede_id INTEGER NOT NULL,
    stock_actual DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock_minimo DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    precio_venta DECIMAL(12,2) NOT NULL,
    disponible_en_sede BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uk_producto_sede 
        UNIQUE (producto_id, sede_id),

    CONSTRAINT fk_producto_sede_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_producto_sede_sede
        FOREIGN KEY (sede_id) REFERENCES sedes(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT chk_producto_sede_stock_actual CHECK (stock_actual >= 0.00),
    CONSTRAINT chk_producto_sede_stock_minimo CHECK (stock_minimo >= 0.00),
    CONSTRAINT chk_producto_sede_precio_venta CHECK (precio_venta >= 0.00)
);

CREATE TRIGGER update_producto_sede_updated_at BEFORE UPDATE ON producto_sede FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- =============================================================================
-- 6. TABLA: solicitudes_material
-- =============================================================================
CREATE TABLE solicitudes_material (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL,
    sede_solicitante_id INTEGER NOT NULL,
    sede_proveedora_id INTEGER NULL,
    usuario_solicitante_id INTEGER NOT NULL,
    cantidad_solicitada DECIMAL(10,2) NOT NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'ATENDIDA', 'RECHAZADA', 'CANCELADA')),
    motivo_solicitud VARCHAR(255) NULL,
    motivo_rechazo VARCHAR(255) NULL,
    usuario_respuesta_id INTEGER NULL,
    fecha_respuesta TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_solicitudes_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_solicitudes_sede_solicitante
        FOREIGN KEY (sede_solicitante_id) REFERENCES sedes(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_solicitudes_sede_proveedora
        FOREIGN KEY (sede_proveedora_id) REFERENCES sedes(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_solicitudes_usuario_solicita
        FOREIGN KEY (usuario_solicitante_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_solicitudes_usuario_responde
        FOREIGN KEY (usuario_respuesta_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT chk_solicitud_cantidad CHECK (cantidad_solicitada > 0.00)
);

CREATE TRIGGER update_solicitudes_updated_at BEFORE UPDATE ON solicitudes_material FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE INDEX idx_solicitudes_estado ON solicitudes_material (estado);
CREATE INDEX idx_solicitudes_sede_solicitante ON solicitudes_material (sede_solicitante_id);

-- =============================================================================
-- 7. TABLA: traslados
-- =============================================================================
CREATE TABLE traslados (
    id SERIAL PRIMARY KEY,
    solicitud_id INTEGER NULL UNIQUE,
    producto_id INTEGER NOT NULL,
    sede_origen_id INTEGER NOT NULL,
    sede_destino_id INTEGER NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    precio_destino_vigente DECIMAL(12,2) NOT NULL,
    usuario_envia_id INTEGER NOT NULL,
    usuario_recibe_id INTEGER NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'COMPLETADO', 'CANCELADO')),
    observaciones VARCHAR(255) NULL,
    fecha_envio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_recepcion TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_traslados_solicitud
        FOREIGN KEY (solicitud_id) REFERENCES solicitudes_material(id)
        ON DELETE SET NULL ON UPDATE RESTRICT,

    CONSTRAINT fk_traslados_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_traslados_sede_origen
        FOREIGN KEY (sede_origen_id) REFERENCES sedes(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_traslados_sede_destino
        FOREIGN KEY (sede_destino_id) REFERENCES sedes(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_traslados_usuario_envia
        FOREIGN KEY (usuario_envia_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_traslados_usuario_recibe
        FOREIGN KEY (usuario_recibe_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT chk_traslado_sedes_distintas CHECK (sede_origen_id <> sede_destino_id),
    CONSTRAINT chk_traslado_cantidad CHECK (cantidad > 0.00),
    CONSTRAINT chk_traslado_precio_destino CHECK (precio_destino_vigente >= 0.00)
);

CREATE TRIGGER update_traslados_updated_at BEFORE UPDATE ON traslados FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE INDEX idx_traslados_estado ON traslados (estado);
CREATE INDEX idx_traslados_origen_destino ON traslados (sede_origen_id, sede_destino_id);

-- =============================================================================
-- 8. TABLA: movimientos_inventario (Kardex)
-- =============================================================================
CREATE TABLE movimientos_inventario (
    id SERIAL PRIMARY KEY,
    tipo_movimiento VARCHAR(50) NOT NULL CHECK (tipo_movimiento IN (
        'ENTRADA',
        'SALIDA',
        'AJUSTE_POSITIVO',
        'AJUSTE_NEGATIVO',
        'TRASLADO_SALIDA',
        'TRASLADO_ENTRADA'
    )),
    producto_id INTEGER NOT NULL,
    sede_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    stock_anterior DECIMAL(10,2) NOT NULL,
    stock_posterior DECIMAL(10,2) NOT NULL,
    precio_unitario DECIMAL(12,2) NULL,
    traslado_id INTEGER NULL,
    referencia_documento VARCHAR(100) NULL,
    motivo_observacion TEXT NULL,
    fecha_movimiento TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_movimientos_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_movimientos_sede
        FOREIGN KEY (sede_id) REFERENCES sedes(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_movimientos_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_movimientos_traslado
        FOREIGN KEY (traslado_id) REFERENCES traslados(id)
        ON DELETE SET NULL ON UPDATE RESTRICT,

    CONSTRAINT chk_movimiento_cantidad CHECK (cantidad > 0.00),
    CONSTRAINT chk_movimiento_stock_ant CHECK (stock_anterior >= 0.00),
    CONSTRAINT chk_movimiento_stock_post CHECK (stock_posterior >= 0.00)
);

CREATE INDEX idx_movimientos_sede_fecha ON movimientos_inventario (sede_id, fecha_movimiento);
CREATE INDEX idx_movimientos_producto ON movimientos_inventario (producto_id);

-- =============================================================================
-- 9. DATOS SEMILLA (SEED DATA)
-- =============================================================================

INSERT INTO sedes (id, nombre, ciudad, direccion, telefono) VALUES
(1, 'Centro Eléctrico EP', 'Bogotá', 'Crr 20 # 12-30', '601-5550100'),
(2, 'Centro Eléctrico EP1', 'Bogotá', 'Crr 20 # 12-04', '601-5550200'),
(3, 'Grupo Eléctrico EP3', 'Bogotá', 'Crr 20 # 12-10', '601-5550300'),
(4, 'EP6 Ecoiluminación', 'Bogotá', 'Crr 19 # 12-51', '601-5550400');

SELECT setval('sedes_id_seq', (SELECT MAX(id) FROM sedes));

INSERT INTO usuarios (id, nombre_completo, username, email, password_hash, rol, sede_id, estado) VALUES
(1, 'Cesar Administrador Global', 'Cesar', 'cesar@grupoelectrico.com', '$2a$10$CaQVRoDMLbq3L.W9Df0rWuDeQQMtpOQIw68cWnD2/HJVSTbmWnnU.', 'ADMINISTRADOR', NULL, 'ACTIVO'),
(2, 'Encargado Centro Eléctrico EP', 'encargado_ep', 'ep@grupoelectrico.com', '$2a$10$CaQVRoDMLbq3L.W9Df0rWuDeQQMtpOQIw68cWnD2/HJVSTbmWnnU.', 'ENCARGADO', 1, 'ACTIVO'),
(3, 'Encargado Centro Eléctrico EP1', 'encargado_ep1', 'ep1@grupoelectrico.com', '$2a$10$CaQVRoDMLbq3L.W9Df0rWuDeQQMtpOQIw68cWnD2/HJVSTbmWnnU.', 'ENCARGADO', 2, 'ACTIVO'),
(4, 'Encargado Grupo Eléctrico EP3', 'encargado_ep3', 'ep3@grupoelectrico.com', '$2a$10$CaQVRoDMLbq3L.W9Df0rWuDeQQMtpOQIw68cWnD2/HJVSTbmWnnU.', 'ENCARGADO', 3, 'ACTIVO'),
(5, 'Encargado EP6 Ecoiluminación', 'encargado_ep6', 'ep6@grupoelectrico.com', '$2a$10$CaQVRoDMLbq3L.W9Df0rWuDeQQMtpOQIw68cWnD2/HJVSTbmWnnU.', 'ENCARGADO', 4, 'ACTIVO'),
(6, 'Corredor Logístico 1', 'corredor_1', 'corredor1@grupoelectrico.com', '$2a$10$CaQVRoDMLbq3L.W9Df0rWuDeQQMtpOQIw68cWnD2/HJVSTbmWnnU.', 'EMPLEADO', NULL, 'ACTIVO'),
(7, 'Corredor Logístico 2', 'corredor_2', 'corredor2@grupoelectrico.com', '$2a$10$CaQVRoDMLbq3L.W9Df0rWuDeQQMtpOQIw68cWnD2/HJVSTbmWnnU.', 'EMPLEADO', NULL, 'ACTIVO');

SELECT setval('usuarios_id_seq', (SELECT MAX(id) FROM usuarios));

INSERT INTO categorias (id, nombre, descripcion) VALUES
(1, 'Cables', 'Cables de cobre, aluminio, de varios calibres y tipos'),
(2, 'Tubería', 'Tuberías PVC, EMT, SCH40, IMC'),
(3, 'Alambre', 'Rollos y tramos de alambre de diferentes calibres'),
(4, 'Protecciones Eléctricas', 'Breakers, disyuntores, diferenciales'),
(5, 'Sistemas Solares', 'Paneles, inversores, controladores');

SELECT setval('categorias_id_seq', (SELECT MAX(id) FROM categorias));

INSERT INTO productos (id, codigo_sku, nombre, descripcion, categoria_id, unidad_medida, activo) VALUES
(1, 'CAB-THHN-12AWG', 'Cable Cobre THHN Calibre 12 AWG Negro', 'Cable de cobre conductor para instalaciones residenciales y comerciales', 1, 'METRO', TRUE),
(2, 'CAB-THHN-10AWG', 'Cable Cobre THHN Calibre 10 AWG Rojo', 'Cable conductor de alta capacidad para alimentadores', 1, 'METRO', TRUE),
(3, 'TUB-CONDUIT-34', 'Tubería Conduit EMT 3/4 pulg x 3m', 'Tubo metálico para canalización eléctrica', 2, 'UNIDAD', TRUE),
(4, 'BREAKER-1P-20A', 'Interruptor Termomagnético 1 Polo 20A', 'Breaker enchufable tipo americano', 4, 'UNIDAD', TRUE),
(5, 'PANEL-SOLAR-450W', 'Panel Solar Monocristalino 450W Tier 1', 'Módulo fotovoltaico', 5, 'UNIDAD', TRUE),
(6, 'LAM-SOLAR-ALLINONE', 'Luminaria Solar LED 100W', 'Lámpara LED con panel y batería integrada', 5, 'UNIDAD', TRUE);

SELECT setval('productos_id_seq', (SELECT MAX(id) FROM productos));

INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede) VALUES
(1, 1, 850.50, 100.00, 3200.00, TRUE),
(2, 1, 620.00, 80.00, 4800.00, TRUE),
(3, 1, 150.00, 20.00, 22500.00, TRUE),
(4, 1, 95.00, 15.00, 18000.00, TRUE),
(5, 1, 12.00, 2.00, 680000.00, TRUE),
(6, 1, 20.00, 5.00, 310000.00, TRUE),
(1, 2, 0.00, 50.00, 3400.00, TRUE),
(3, 2, 80.00, 15.00, 23900.00, TRUE),
(4, 2, 45.00, 10.00, 19500.00, TRUE),
(5, 2, 0.00, 0.00, 0.00, FALSE),
(6, 2, 0.00, 0.00, 0.00, FALSE),
(1, 3, 1200.00, 150.00, 3150.00, TRUE),
(2, 3, 900.00, 100.00, 4700.00, TRUE),
(3, 3, 300.00, 40.00, 21800.00, TRUE),
(4, 3, 120.00, 20.00, 17500.00, TRUE),
(5, 3, 0.00, 0.00, 0.00, FALSE),
(1, 4, 300.00, 50.00, 3300.00, TRUE),
(4, 4, 30.00, 10.00, 18900.00, TRUE),
(5, 4, 45.00, 8.00, 650000.00, TRUE),
(6, 4, 60.00, 10.00, 295000.00, TRUE);

INSERT INTO solicitudes_material (
    id, producto_id, sede_solicitante_id, sede_proveedora_id, usuario_solicitante_id, 
    cantidad_solicitada, estado, motivo_solicitud
) VALUES (
    1, 1, 2, 1, 3, 
    150.00, 'PENDIENTE', 'Cliente en tienda solicita 150 metros'
);
SELECT setval('solicitudes_material_id_seq', (SELECT MAX(id) FROM solicitudes_material));

INSERT INTO traslados (
    id, solicitud_id, producto_id, sede_origen_id, sede_destino_id, 
    cantidad, precio_destino_vigente, usuario_envia_id, estado, observaciones
) VALUES (
    1, 1, 1, 1, 2, 
    150.00, 3400.00, 1, 'PENDIENTE', 'Despacho de 150m de cable THHN'
);
SELECT setval('traslados_id_seq', (SELECT MAX(id) FROM traslados));

INSERT INTO movimientos_inventario (
    tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, 
    stock_anterior, stock_posterior, precio_unitario, referencia_documento, motivo_observacion
) VALUES
('ENTRADA', 1, 1, 1, 850.50, 0.00, 850.50, 3200.00, 'INV-INICIAL-001', 'Carga inicial'),
('ENTRADA', 5, 4, 5, 45.00, 0.00, 45.00, 650000.00, 'FAC-PROV-9982', 'Recepción de panel');

-- =============================================================================
-- 10. TABLA: usuario_politicas
-- =============================================================================
CREATE TABLE usuario_politicas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    version VARCHAR(20) NOT NULL,
    aceptada_el TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_usuario_politicas_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
        
    CONSTRAINT uk_usuario_version UNIQUE (usuario_id, version)
);

