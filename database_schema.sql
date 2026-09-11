-- =============================================================================
-- SISTEMA DE INVENTARIO MULTISEDE PARA MATERIAL ELÉCTRICO
-- Asignatura: Ingeniería de Software 2
-- Motor: MySQL 8.0+
-- Codificación: UTF-8 (utf8mb4)
-- =============================================================================

-- 1. CREACIÓN DE LA BASE DE DATOS
CREATE DATABASE IF NOT EXISTS inventario_electrico_ce
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE inventario_electrico_ce;

-- Desactivar temporalmente revisión de claves foráneas para limpieza limpia
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS movimientos_inventario;
DROP TABLE IF EXISTS traslados;
DROP TABLE IF EXISTS solicitudes_material;
DROP TABLE IF EXISTS producto_sede;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS sedes;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 2. TABLA: sedes
-- Representa las 4 sucursales/puntos de venta y almacenamiento de la empresa.
-- =============================================================================
CREATE TABLE sedes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    ciudad VARCHAR(100) NOT NULL,
    direccion VARCHAR(255) NULL,
    telefono VARCHAR(20) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3. TABLA: usuarios
-- Gestión de accesos, roles y asignación de sede para login.
-- Regla de negocio:
--   - ENCARGADO: requiere sede_id obligatoria (NOT NULL).
--   - ADMINISTRADOR y EMPLEADO: sede_id debe ser NULL (operan globalmente o eligen en cada operación).
-- =============================================================================
CREATE TABLE usuarios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre_completo VARCHAR(150) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol ENUM('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO') NOT NULL,
    sede_id INT UNSIGNED NULL,
    estado ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    ultimo_login DATETIME NULL,
    token_recuperacion VARCHAR(64) NULL,
    token_recuperacion_expira DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_usuarios_sede
        FOREIGN KEY (sede_id) REFERENCES sedes(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT chk_usuario_sede_por_rol CHECK (
        (rol = 'ENCARGADO' AND sede_id IS NOT NULL) OR
        (rol IN ('ADMINISTRADOR', 'EMPLEADO') AND sede_id IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 4. TABLA: productos
-- Catálogo maestro global de materiales eléctricos.
-- Datos técnicos y atributos inmutables en todas las sedes.
-- =============================================================================
CREATE TABLE productos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_sku VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT NULL,
    unidad_medida VARCHAR(20) NOT NULL DEFAULT 'UNIDAD', -- 'UNIDAD', 'METRO', 'ROLLO', 'CAJA'
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_productos_sku (codigo_sku),
    INDEX idx_productos_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. TABLA: producto_sede
-- Tabla intermedia que materializa la regla clave:
-- Stock, precio de venta y disponibilidad independientes por cada sede.
-- DECIMAL(10,2) permite manejar cantidades continuas (ej. 1.50m de cable, 2.40m de barra, etc.)
-- =============================================================================
CREATE TABLE producto_sede (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id INT UNSIGNED NOT NULL,
    sede_id INT UNSIGNED NOT NULL,
    stock_actual DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock_minimo DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    precio_venta DECIMAL(12,2) NOT NULL,
    disponible_en_sede BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 6. TABLA: solicitudes_material
-- Registra cuando un empleado requiere abastecer un producto agotado en su sede.
-- =============================================================================
CREATE TABLE solicitudes_material (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id INT UNSIGNED NOT NULL,
    sede_solicitante_id INT UNSIGNED NOT NULL,
    sede_proveedora_id INT UNSIGNED NULL, -- Sede sugerida o asignada para despachar
    usuario_solicitante_id INT UNSIGNED NOT NULL,
    cantidad_solicitada DECIMAL(10,2) NOT NULL,
    estado ENUM('PENDIENTE', 'ATENDIDA', 'RECHAZADA', 'CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
    motivo_solicitud VARCHAR(255) NULL,
    motivo_rechazo VARCHAR(255) NULL,
    usuario_respuesta_id INT UNSIGNED NULL,
    fecha_respuesta DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

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

    CONSTRAINT chk_solicitud_cantidad CHECK (cantidad_solicitada > 0.00),
    INDEX idx_solicitudes_estado (estado),
    INDEX idx_solicitudes_sede_solicitante (sede_solicitante_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 7. TABLA: traslados
-- Registra el movimiento físico de mercadería entre una sede origen y destino.
-- Permite fijar el nuevo precio de venta que regirá en la sede destino.
-- Estados acordados para el MVP: PENDIENTE y COMPLETADO (con opción de CANCELADO).
-- =============================================================================
CREATE TABLE traslados (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    solicitud_id INT UNSIGNED NULL UNIQUE, -- 1:1 opcional si se originó de una solicitud
    producto_id INT UNSIGNED NOT NULL,
    sede_origen_id INT UNSIGNED NOT NULL,
    sede_destino_id INT UNSIGNED NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    precio_destino_vigente DECIMAL(12,2) NOT NULL, -- Precio que regirá en la sede destino
    usuario_envia_id INT UNSIGNED NOT NULL,
    usuario_recibe_id INT UNSIGNED NULL,
    estado ENUM('PENDIENTE', 'COMPLETADO', 'CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
    observaciones VARCHAR(255) NULL,
    fecha_envio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_recepcion DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

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
    CONSTRAINT chk_traslado_precio_destino CHECK (precio_destino_vigente >= 0.00),
    
    INDEX idx_traslados_estado (estado),
    INDEX idx_traslados_origen_destino (sede_origen_id, sede_destino_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 8. TABLA: movimientos_inventario (Kardex)
-- Libro mayor inmutable para trazabilidad de cada cambio físico en el stock.
-- Tipos: ENTRADA (proveedor/inicial), SALIDA (venta), AJUSTE_POSITIVO/NEGATIVO,
--        TRASLADO_SALIDA (origen), TRASLADO_ENTRADA (destino).
-- =============================================================================
CREATE TABLE movimientos_inventario (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tipo_movimiento ENUM(
        'ENTRADA',
        'SALIDA',
        'AJUSTE_POSITIVO',
        'AJUSTE_NEGATIVO',
        'TRASLADO_SALIDA',
        'TRASLADO_ENTRADA'
    ) NOT NULL,
    producto_id INT UNSIGNED NOT NULL,
    sede_id INT UNSIGNED NOT NULL,
    usuario_id INT UNSIGNED NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    stock_anterior DECIMAL(10,2) NOT NULL,
    stock_posterior DECIMAL(10,2) NOT NULL,
    precio_unitario DECIMAL(12,2) NULL, -- Precio snapshot registrado al momento de la operación
    traslado_id INT UNSIGNED NULL,      -- Vinculación si el movimiento provino de un traslado
    referencia_documento VARCHAR(100) NULL, -- Nro de factura, boleta, remisión o nota de ajuste
    motivo_observacion TEXT NULL,
    fecha_movimiento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    CONSTRAINT chk_movimiento_stock_post CHECK (stock_posterior >= 0.00),

    INDEX idx_movimientos_sede_fecha (sede_id, fecha_movimiento),
    INDEX idx_movimientos_producto (producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 9. DATOS SEMILLA (SEED DATA) PARA VALIDACIÓN Y PRUEBAS
-- =============================================================================

-- 9.1. Inserción de las 4 Sedes Oficiales de Grupo Eléctrico
INSERT INTO sedes (id, nombre, ciudad, direccion, telefono) VALUES
(1, 'Centro Eléctrico EP', 'Bogotá', 'Crr 20 # 12-30', '601-5550100'),
(2, 'Centro Eléctrico EP1', 'Bogotá', 'Crr 20 # 12-04', '601-5550200'),
(3, 'Grupo Eléctrico EP3', 'Bogotá', 'Crr 20 # 12-10', '601-5550300'),
(4, 'EP6 Ecoiluminación', 'Bogotá', 'Crr 19 # 12-51', '601-5550400');

-- 9.2. Inserción de Usuarios de Prueba
-- Contraseña de prueba para todos: 'Password123!'
-- Hash generado con bcryptjs (10 rounds): $2a$10$Jg4xBd9cuK99mTicKFWxE.9MKihopBbXtVPrva4PCWKYdXERl4CBO
INSERT INTO usuarios (id, nombre_completo, username, email, password_hash, rol, sede_id, estado) VALUES
(1, 'Cesar Administrador Global', 'Cesar', 'cesar@grupoelectrico.com', '$2a$10$Jg4xBd9cuK99mTicKFWxE.9MKihopBbXtVPrva4PCWKYdXERl4CBO', 'ADMINISTRADOR', NULL, 'ACTIVO'),
(2, 'María Encargada Matriz', 'encargado_matriz', 'mencargada@grupoelectrico.com', '$2a$10$Jg4xBd9cuK99mTicKFWxE.9MKihopBbXtVPrva4PCWKYdXERl4CBO', 'ENCARGADO', 1, 'ACTIVO'),
(3, 'Juan Encargado EP3', 'encargado_ep3', 'jencargado@grupoelectrico.com', '$2a$10$Jg4xBd9cuK99mTicKFWxE.9MKihopBbXtVPrva4PCWKYdXERl4CBO', 'ENCARGADO', 3, 'ACTIVO'),
(4, 'Pedro Operador Logístico', 'empleado1', 'poperador@grupoelectrico.com', '$2a$10$Jg4xBd9cuK99mTicKFWxE.9MKihopBbXtVPrva4PCWKYdXERl4CBO', 'EMPLEADO', NULL, 'ACTIVO');

-- 9.3. Inserción de Catálogo Maestro de Productos Eléctricos
INSERT INTO productos (id, codigo_sku, nombre, descripcion, unidad_medida, activo) VALUES
(1, 'CAB-THHN-12AWG', 'Cable Cobre THHN Calibre 12 AWG Negro', 'Cable de cobre conductor para instalaciones residenciales y comerciales (por metro o rollo)', 'METRO', TRUE),
(2, 'CAB-THHN-10AWG', 'Cable Cobre THHN Calibre 10 AWG Rojo', 'Cable conductor de alta capacidad para alimentadores', 'METRO', TRUE),
(3, 'TUB-CONDUIT-34', 'Tubería Conduit EMT 3/4 pulg x 3m', 'Tubo metálico para canalización eléctrica de 3 metros', 'UNIDAD', TRUE),
(4, 'BREAKER-1P-20A', 'Interruptor Termomagnético 1 Polo 20A', 'Breaker enchufable tipo americano para tablero residencial', 'UNIDAD', TRUE),
(5, 'PANEL-SOLAR-450W', 'Panel Solar Monocristalino 450W Tier 1', 'Módulo fotovoltaico de alta eficiencia para generación solar', 'UNIDAD', TRUE),
(6, 'LAM-SOLAR-ALLINONE', 'Luminaria Solar LED 100W Suburbana Todo-en-Uno', 'Lámpara LED con panel y batería de litio integrada', 'UNIDAD', TRUE);

-- 9.4. Inserción de Stock y Precio por Sede (producto_sede)
INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede) VALUES
-- Sede 1: Central (Tiene stock general)
(1, 1, 850.50, 100.00, 3200.00, TRUE),   -- Cable 12 AWG a $3,200/m
(2, 1, 620.00, 80.00, 4800.00, TRUE),    -- Cable 10 AWG a $4,800/m
(3, 1, 150.00, 20.00, 22500.00, TRUE),   -- Tubería Conduit
(4, 1, 95.00, 15.00, 18000.00, TRUE),    -- Breaker 20A
(5, 1, 12.00, 2.00, 680000.00, TRUE),    -- Panel Solar
(6, 1, 20.00, 5.00, 310000.00, TRUE),    -- Luminaria Solar

-- Sede 2: Norte (Comercial - Precios urbanos y Cable agotado para probar solicitud)
(1, 2, 0.00, 50.00, 3400.00, TRUE),      -- Cable 12 AWG AGOTADO (0.00)
(3, 2, 80.00, 15.00, 23900.00, TRUE),    -- Tubería Conduit
(4, 2, 45.00, 10.00, 19500.00, TRUE),    -- Breaker 20A
(5, 2, 0.00, 0.00, 0.00, FALSE),         -- NO comercializa línea solar pesada
(6, 2, 0.00, 0.00, 0.00, FALSE),

-- Sede 3: Occidente (Industrial)
(1, 3, 1200.00, 150.00, 3150.00, TRUE),  -- Cable 12 AWG precio industrial
(2, 3, 900.00, 100.00, 4700.00, TRUE),
(3, 3, 300.00, 40.00, 21800.00, TRUE),
(4, 3, 120.00, 20.00, 17500.00, TRUE),
(5, 3, 0.00, 0.00, 0.00, FALSE),

-- Sede 4: Costa (Especializada en Proyectos Solares)
(1, 4, 300.00, 50.00, 3300.00, TRUE),
(4, 4, 30.00, 10.00, 18900.00, TRUE),
(5, 4, 45.00, 8.00, 650000.00, TRUE),    -- Fuerte stock en Paneles Solares
(6, 4, 60.00, 10.00, 295000.00, TRUE);   -- Fuerte stock en Luminarias

-- 9.5. Ejemplo de Solicitud de Material
INSERT INTO solicitudes_material (
    id, producto_id, sede_solicitante_id, sede_proveedora_id, usuario_solicitante_id, 
    cantidad_solicitada, estado, motivo_solicitud
) VALUES (
    1, 1, 2, 1, 4, 
    150.00, 'PENDIENTE', 'Cliente en tienda solicita 150 metros para instalación y stock en Norte está en 0'
);

-- 9.6. Ejemplo de Traslado Creado
INSERT INTO traslados (
    id, solicitud_id, producto_id, sede_origen_id, sede_destino_id, 
    cantidad, precio_destino_vigente, usuario_envia_id, estado, observaciones
) VALUES (
    1, 1, 1, 1, 2, 
    150.00, 3400.00, 1, 'PENDIENTE', 'Despacho de 150m de cable THHN 12AWG desde Central hacia Norte'
);

-- 9.7. Ejemplo de Movimientos Iniciales de Entrada (Kardex)
INSERT INTO movimientos_inventario (
    tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, 
    stock_anterior, stock_posterior, precio_unitario, referencia_documento, motivo_observacion
) VALUES
('ENTRADA', 1, 1, 1, 850.50, 0.00, 850.50, 3200.00, 'INV-INICIAL-001', 'Carga inicial de inventario Sede Central'),
('ENTRADA', 5, 4, 3, 45.00, 0.00, 45.00, 650000.00, 'FAC-PROV-9982', 'Recepción de contenedor de Paneles Solares');

