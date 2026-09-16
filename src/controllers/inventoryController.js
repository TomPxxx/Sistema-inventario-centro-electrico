import { pool } from '../config/db.js';

/**
 * Obtener todos los productos con su stock y precios desglosados por sede
 * GET /api/inventory/products
 */
export const getProductsWithStock = async (req, res) => {
  try {
    // Obtenemos los productos base
    const [products] = await pool.query(
      `SELECT id, codigo_sku, nombre, descripcion, unidad_medida, activo, created_at 
       FROM productos 
       WHERE activo = TRUE 
       ORDER BY id ASC`
    );

    // Obtenemos todos los stocks y precios por sede
    const [stocks] = await pool.query(
      `SELECT ps.producto_id, ps.sede_id, ps.stock_actual, ps.stock_minimo, ps.precio_venta, ps.disponible_en_sede, s.nombre AS sede_nombre
       FROM producto_sede ps
       JOIN sedes s ON ps.sede_id = s.id
       ORDER BY ps.producto_id ASC, ps.sede_id ASC`
    );

    // Agrupamos el stock por producto
    const result = products.map(prod => {
      const prodStocks = stocks.filter(s => s.producto_id === prod.id);
      
      const sedeStockMap = {};
      let totalStock = 0;
      let defaultPrice = 0;

      prodStocks.forEach(s => {
        const qty = parseFloat(s.stock_actual) || 0;
        totalStock += qty;
        sedeStockMap[s.sede_id] = {
          sede_id: s.sede_id,
          sede_nombre: s.sede_nombre,
          stock_actual: qty,
          stock_minimo: parseFloat(s.stock_minimo) || 0,
          precio_venta: parseFloat(s.precio_venta) || 0,
          disponible: s.disponible_en_sede
        };
        if (!defaultPrice && s.precio_venta > 0) {
          defaultPrice = parseFloat(s.precio_venta);
        }
      });

      return {
        ...prod,
        precio_referencia: defaultPrice,
        total_stock: totalStock,
        sedes: sedeStockMap
      };
    });

    return res.status(200).json({
      success: true,
      products: result
    });
  } catch (error) {
    console.error('[Inventory Error] getProductsWithStock:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al consultar productos e inventario: ' + error.message
    });
  }
};

/**
 * Crear un nuevo producto en el catálogo y asignarle stock/precio a cada sede
 * POST /api/inventory/products
 * Body: { codigo_sku, nombre, descripcion, unidad_medida, sedesData: [{ sede_id, stock_actual, stock_minimo, precio_venta }] }
 */
export const createProduct = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { codigo_sku, nombre, descripcion, unidad_medida, sedesData } = req.body;

    if (!codigo_sku || !nombre) {
      return res.status(400).json({
        success: false,
        message: 'El código SKU y el nombre del producto son obligatorios.'
      });
    }

    const cleanSku = codigo_sku.trim().toUpperCase();
    const cleanName = nombre.trim();

    // Validar si el SKU ya existe
    const [existing] = await connection.query(
      'SELECT id FROM productos WHERE codigo_sku = ?',
      [cleanSku]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: `El código SKU '${cleanSku}' ya existe en el catálogo.`
      });
    }

    await connection.beginTransaction();

    // 1. Insertar en tabla productos
    const [prodResult] = await connection.query(
      `INSERT INTO productos (codigo_sku, nombre, descripcion, unidad_medida, activo)
       VALUES (?, ?, ?, ?, TRUE)`,
      [cleanSku, cleanName, descripcion ? descripcion.trim() : null, unidad_medida || 'UNIDAD']
    );

    const productId = prodResult.insertId;

    // 2. Insertar stock y precio para las 4 sedes
    // Si sedesData viene en la petición se usa, de lo contrario se obtienen las sedes activas
    const [allSedes] = await connection.query('SELECT id FROM sedes WHERE activo = TRUE');

    for (const sede of allSedes) {
      const dataForSede = (sedesData && Array.isArray(sedesData)) 
        ? sedesData.find(s => Number(s.sede_id) === Number(sede.id))
        : null;

      const stockActual = dataForSede ? parseFloat(dataForSede.stock_actual) || 0 : 0;
      const stockMinimo = dataForSede ? parseFloat(dataForSede.stock_minimo) || 0 : 5;
      const precioVenta = dataForSede ? parseFloat(dataForSede.precio_venta) || 0 : 0;

      await connection.query(
        `INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [productId, sede.id, stockActual, stockMinimo, precioVenta]
      );

      // Registrar movimiento inicial en Kardex si hubo stock inicial
      if (stockActual > 0) {
        await connection.query(
          `INSERT INTO movimientos_inventario (tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, stock_anterior, stock_posterior, precio_unitario, referencia_documento, motivo_observacion)
           VALUES ('ENTRADA', ?, ?, ?, ?, 0.00, ?, ?, 'ALTA-INICIAL', 'Carga inicial al crear producto')`,
          [productId, sede.id, req.user ? req.user.id : 1, stockActual, stockActual, precioVenta]
        );
      }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: `Producto '${cleanName}' (SKU: ${cleanSku}) creado exitosamente en la base de datos con stock asignado a las 4 sedes.`,
      productId
    });

  } catch (error) {
    await connection.rollback();
    console.error('[Create Product Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al registrar el producto en la base de datos: ' + error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * Realizar un traslado directo de stock entre dos sedes en tiempo real
 * POST /api/inventory/transfers
 * Body: { producto_id, sede_origen_id, sede_destino_id, cantidad, observaciones }
 */
export const executeTransfer = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { producto_id, sede_origen_id, sede_destino_id, cantidad, observaciones } = req.body;

    if (!producto_id || !sede_origen_id || !sede_destino_id || !cantidad) {
      return res.status(400).json({
        success: false,
        message: 'Faltan datos requeridos: producto, sede origen, sede destino y cantidad.'
      });
    }

    const prodId = Number(producto_id);
    const origId = Number(sede_origen_id);
    const destId = Number(sede_destino_id);
    const qty = parseFloat(cantidad);

    if (origId === destId) {
      return res.status(400).json({
        success: false,
        message: 'La sede origen y la sede destino deben ser diferentes.'
      });
    }

    if (qty <= 0) {
      return res.status(400).json({
        success: false,
        message: 'La cantidad a trasladar debe ser mayor a cero.'
      });
    }

    await connection.beginTransaction();

    // 1. Validar stock en la sede origen (con bloqueo FOR UPDATE para consistencia transaccional)
    const [origRows] = await connection.query(
      `SELECT stock_actual, precio_venta FROM producto_sede 
       WHERE producto_id = ? AND sede_id = ? FOR UPDATE`,
      [prodId, origId]
    );

    if (origRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'El producto no está configurado en la sede origen.'
      });
    }

    const origStock = parseFloat(origRows[0].stock_actual);
    if (origStock < qty) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Stock insuficiente en la sede origen. Disponible: ${origStock}, solicitado: ${qty}.`
      });
    }

    // 2. Obtener datos de sede destino
    const [destRows] = await connection.query(
      `SELECT stock_actual, precio_venta FROM producto_sede 
       WHERE producto_id = ? AND sede_id = ? FOR UPDATE`,
      [prodId, destId]
    );

    let destStock = 0;
    let precioDestino = origRows[0].precio_venta;

    if (destRows.length === 0) {
      // Si no existía en destino, creamos la fila
      await connection.query(
        `INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede)
         VALUES (?, ?, 0.00, 5.00, ?, TRUE)`,
        [prodId, destId, precioDestino]
      );
    } else {
      destStock = parseFloat(destRows[0].stock_actual);
      precioDestino = destRows[0].precio_venta;
    }

    const newOrigStock = origStock - qty;
    const newDestStock = destStock + qty;

    // 3. Descontar en origen
    await connection.query(
      `UPDATE producto_sede SET stock_actual = ? WHERE producto_id = ? AND sede_id = ?`,
      [newOrigStock, prodId, origId]
    );

    // 4. Acreditar en destino
    await connection.query(
      `UPDATE producto_sede SET stock_actual = ? WHERE producto_id = ? AND sede_id = ?`,
      [newDestStock, prodId, destId]
    );

    // 5. Registrar en tabla traslados
    const [trasladoResult] = await connection.query(
      `INSERT INTO traslados (producto_id, sede_origen_id, sede_destino_id, cantidad, precio_destino_vigente, usuario_envia_id, estado, observaciones, fecha_recepcion)
       VALUES (?, ?, ?, ?, ?, ?, 'COMPLETADO', ?, NOW())`,
      [prodId, origId, destId, qty, precioDestino, req.user ? req.user.id : 1, observaciones || 'Traslado directo entre sedes']
    );

    const trasladoId = trasladoResult.insertId;

    // 6. Registrar en Kardex movimientos_inventario (Salida origen y Entrada destino)
    await connection.query(
      `INSERT INTO movimientos_inventario (tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, stock_anterior, stock_posterior, precio_unitario, traslado_id, referencia_documento, motivo_observacion)
       VALUES ('TRASLADO_SALIDA', ?, ?, ?, ?, ?, ?, ?, ?, CONCAT('TR-', ?), 'Salida por traslado hacia sede destino')`,
      [prodId, origId, req.user ? req.user.id : 1, qty, origStock, newOrigStock, origRows[0].precio_venta, trasladoId, trasladoId]
    );

    await connection.query(
      `INSERT INTO movimientos_inventario (tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, stock_anterior, stock_posterior, precio_unitario, traslado_id, referencia_documento, motivo_observacion)
       VALUES ('TRASLADO_ENTRADA', ?, ?, ?, ?, ?, ?, ?, ?, CONCAT('TR-', ?), 'Entrada por recepción de traslado')`,
      [prodId, destId, req.user ? req.user.id : 1, qty, destStock, newDestStock, precioDestino, trasladoId, trasladoId]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Traslado de ${qty} unidades ejecutado con éxito en la base de datos.`,
      transfer: {
        id: trasladoId,
        producto_id: prodId,
        origen_id: origId,
        destino_id: destId,
        cantidad: qty,
        nuevo_stock_origen: newOrigStock,
        nuevo_stock_destino: newDestStock
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('[Transfer Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al ejecutar el traslado en la base de datos: ' + error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * Obtener historial de traslados recientes
 * GET /api/inventory/transfers
 */
export const getRecentTransfers = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.producto_id, p.nombre AS producto_nombre, p.codigo_sku, 
              t.sede_origen_id, so.nombre AS origen_nombre,
              t.sede_destino_id, sd.nombre AS destino_nombre,
              t.cantidad, t.precio_destino_vigente, t.estado, t.observaciones, t.created_at
       FROM traslados t
       JOIN productos p ON t.producto_id = p.id
       JOIN sedes so ON t.sede_origen_id = so.id
       JOIN sedes sd ON t.sede_destino_id = sd.id
       ORDER BY t.id DESC LIMIT 15`
    );

    return res.status(200).json({
      success: true,
      transfers: rows
    });
  } catch (error) {
    console.error('[Get Transfers Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al consultar traslados.'
    });
  }
};

/**
 * Actualizar producto y sus precios/stock en sede
 * PUT /api/inventory/products/:id
 */
export const updateProduct = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { nombre, descripcion, unidad_medida, sedesData } = req.body;

    await connection.beginTransaction();

    // Actualizar producto global si vienen los datos
    if (nombre || descripcion || unidad_medida) {
      const updates = [];
      const values = [];
      if (nombre) { updates.push('nombre = ?'); values.push(nombre.trim()); }
      if (descripcion !== undefined) { updates.push('descripcion = ?'); values.push(descripcion ? descripcion.trim() : null); }
      if (unidad_medida) { updates.push('unidad_medida = ?'); values.push(unidad_medida); }
      
      if (updates.length > 0) {
        values.push(id);
        await connection.query(
          `UPDATE productos SET ${updates.join(', ')} WHERE id = ?`,
          values
        );
      }
    }

    // Actualizar datos por sede si vienen especificados
    if (sedesData && Array.isArray(sedesData)) {
      for (const data of sedesData) {
        if (!data.sede_id) continue;
        
        // Verifica si existe el producto en esa sede
        const [existing] = await connection.query(
          'SELECT stock_actual FROM producto_sede WHERE producto_id = ? AND sede_id = ?',
          [id, data.sede_id]
        );

        if (existing.length > 0) {
          const updates = [];
          const values = [];
          if (data.stock_actual !== undefined) { updates.push('stock_actual = ?'); values.push(parseFloat(data.stock_actual) || 0); }
          if (data.stock_minimo !== undefined) { updates.push('stock_minimo = ?'); values.push(parseFloat(data.stock_minimo) || 0); }
          if (data.precio_venta !== undefined) { updates.push('precio_venta = ?'); values.push(parseFloat(data.precio_venta) || 0); }
          
          if (updates.length > 0) {
            values.push(id, data.sede_id);
            await connection.query(
              `UPDATE producto_sede SET ${updates.join(', ')} WHERE producto_id = ? AND sede_id = ?`,
              values
            );
          }
        }
      }
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: 'Producto actualizado exitosamente.'
    });

  } catch (error) {
    await connection.rollback();
    console.error('[Update Product Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el producto: ' + error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * Desactivar un producto (Soft Delete)
 * DELETE /api/inventory/products/:id
 */
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Simplemente cambiamos su estado a inactivo
    const [result] = await pool.query(
      'UPDATE productos SET activo = FALSE WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Producto desactivado (Soft Delete) correctamente.'
    });
  } catch (error) {
    console.error('[Delete Product Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al desactivar el producto.'
    });
  }
};
