import { pool } from '../config/db.js';
import InventoryRepository from '../repositories/InventoryRepository.js';
import { notificationSystem } from '../utils/NotificationObserver.js';

/**
 * Obtener todos los productos con su stock y precios desglosados por sede
 */
export const getProductsWithStock = async (req, res) => {
  try {
    const products = await InventoryRepository.getProducts();
    const stocks = await InventoryRepository.getStocks();

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

    return res.status(200).json({ success: true, products: result });
  } catch (error) {
    console.error('[Inventory Error] getProductsWithStock:', error);
    return res.status(500).json({ success: false, message: 'Error al consultar productos e inventario: ' + error.message });
  }
};

export const getCategories = async (req, res) => {
  try {
    const categories = await InventoryRepository.getCategories();
    return res.status(200).json({ success: true, categories });
  } catch (error) {
    console.error('[Inventory Error] getCategories:', error);
    return res.status(500).json({ success: false, message: 'Error al consultar categorías: ' + error.message });
  }
};

export const createCategory = async (req, res) => {
  try {
    const { nombre, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ success: false, message: 'Nombre de categoría requerido.' });
    
    const newCategory = await InventoryRepository.createCategory(nombre.trim(), descripcion);
    return res.status(201).json({ success: true, message: 'Categoría creada', category: newCategory });
  } catch (error) {
    console.error('[Inventory Error] createCategory:', error);
    return res.status(500).json({ success: false, message: 'Error al crear categoría: ' + error.message });
  }
};

/**
 * Crear producto transaccional (PostgreSQL)
 */
export const createProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    const { codigo_sku, nombre, descripcion, categoria_id, unidad_medida, sedesData } = req.body;
    if (!codigo_sku || !nombre) return res.status(400).json({ success: false, message: 'SKU y nombre requeridos.' });

    const cleanSku = codigo_sku.trim().toUpperCase();
    const existing = await InventoryRepository.checkSkuExists(cleanSku);
    if (existing.length > 0) return res.status(409).json({ success: false, message: 'El SKU ya existe.' });

    await client.query('BEGIN');

    const prodResult = await client.query(
      `INSERT INTO productos (codigo_sku, nombre, descripcion, categoria_id, unidad_medida, activo)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
      [cleanSku, nombre.trim(), descripcion ? descripcion.trim() : null, categoria_id || null, unidad_medida || 'UNIDAD']
    );
    const productId = prodResult.rows[0].id;

    const allSedes = await InventoryRepository.getActiveSedes();

    for (const sede of allSedes) {
      const dataForSede = (sedesData && Array.isArray(sedesData)) 
        ? sedesData.find(s => Number(s.sede_id) === Number(sede.id)) : null;

      const stockActual = dataForSede ? parseFloat(dataForSede.stock_actual) || 0 : 0;
      const stockMinimo = dataForSede ? parseFloat(dataForSede.stock_minimo) || 0 : 5;
      const precioVenta = dataForSede ? parseFloat(dataForSede.precio_venta) || 0 : 0;

      await client.query(
        `INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [productId, sede.id, stockActual, stockMinimo, precioVenta]
      );

      if (stockActual > 0) {
        await client.query(
          `INSERT INTO movimientos_inventario (tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, stock_anterior, stock_posterior, precio_unitario, referencia_documento, motivo_observacion)
           VALUES ('ENTRADA', $1, $2, $3, $4, 0.00, $5, $6, 'ALTA-INICIAL', 'Carga inicial al crear producto')`,
          [productId, sede.id, req.user ? req.user.id : 1, stockActual, stockActual, precioVenta]
        );
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({ success: true, message: 'Producto creado exitosamente.', productId });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Create Product Error]:', error);
    return res.status(500).json({ success: false, message: 'Error interno: ' + error.message });
  } finally {
    client.release();
  }
};

/**
 * Traslado transaccional
 */
export const executeTransfer = async (req, res) => {
  const client = await pool.connect();
  try {
    const { producto_id, sede_origen_id, sede_destino_id, cantidad, observaciones } = req.body;
    if (!producto_id || !sede_origen_id || !sede_destino_id || !cantidad) return res.status(400).json({ success: false, message: 'Datos incompletos.' });

    const qty = parseFloat(cantidad);
    if (sede_origen_id === sede_destino_id || qty <= 0) return res.status(400).json({ success: false, message: 'Sedes iguales o cantidad inválida.' });

    await client.query('BEGIN');

    const origRows = await client.query(
      `SELECT stock_actual, precio_venta FROM producto_sede 
       WHERE producto_id = $1 AND sede_id = $2 FOR UPDATE`,
      [producto_id, sede_origen_id]
    );

    if (origRows.rows.length === 0) throw new Error('Producto no existe en origen');
    const origStock = parseFloat(origRows.rows[0].stock_actual);
    if (origStock < qty) throw new Error('Stock insuficiente');

    const destRows = await client.query(
      `SELECT stock_actual, precio_venta FROM producto_sede 
       WHERE producto_id = $1 AND sede_id = $2 FOR UPDATE`,
      [producto_id, sede_destino_id]
    );

    let destStock = 0;
    let precioDestino = origRows.rows[0].precio_venta;

    if (destRows.rows.length === 0) {
      await client.query(
        `INSERT INTO producto_sede (producto_id, sede_id, stock_actual, stock_minimo, precio_venta, disponible_en_sede)
         VALUES ($1, $2, 0.00, 5.00, $3, TRUE)`,
        [producto_id, sede_destino_id, precioDestino]
      );
    } else {
      destStock = parseFloat(destRows.rows[0].stock_actual);
      precioDestino = destRows.rows[0].precio_venta;
    }

    const newOrigStock = origStock - qty;
    const newDestStock = destStock + qty;

    await client.query(`UPDATE producto_sede SET stock_actual = $1 WHERE producto_id = $2 AND sede_id = $3`, [newOrigStock, producto_id, sede_origen_id]);
    await client.query(`UPDATE producto_sede SET stock_actual = $1 WHERE producto_id = $2 AND sede_id = $3`, [newDestStock, producto_id, sede_destino_id]);

    const trasladoRes = await client.query(
      `INSERT INTO traslados (producto_id, sede_origen_id, sede_destino_id, cantidad, precio_destino_vigente, usuario_envia_id, estado, observaciones, fecha_recepcion)
       VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETADO', $7, NOW()) RETURNING id`,
      [producto_id, sede_origen_id, sede_destino_id, qty, precioDestino, req.user ? req.user.id : 1, observaciones || 'Traslado']
    );
    const trasladoId = trasladoRes.rows[0].id;

    await client.query(
      `INSERT INTO movimientos_inventario (tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, stock_anterior, stock_posterior, precio_unitario, traslado_id, referencia_documento, motivo_observacion)
       VALUES ('TRASLADO_SALIDA', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'Salida por traslado')`,
      [producto_id, sede_origen_id, req.user ? req.user.id : 1, qty, origStock, newOrigStock, origRows.rows[0].precio_venta, trasladoId, 'TR-' + trasladoId]
    );

    await client.query(
      `INSERT INTO movimientos_inventario (tipo_movimiento, producto_id, sede_id, usuario_id, cantidad, stock_anterior, stock_posterior, precio_unitario, traslado_id, referencia_documento, motivo_observacion)
       VALUES ('TRASLADO_ENTRADA', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'Entrada por traslado')`,
      [producto_id, sede_destino_id, req.user ? req.user.id : 1, qty, destStock, newDestStock, precioDestino, trasladoId, 'TR-' + trasladoId]
    );

    await client.query('COMMIT');
    
    // Notificar a todos los encargados y administradores
    notificationSystem.notifyAll({
      type: 'NUEVO_TRASLADO',
      message: `Nuevo traslado ejecutado. ${qty} unidades movidas.`,
      sede_origen_id,
      sede_destino_id
    });
    
    return res.status(200).json({ success: true, message: 'Traslado completado.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Transfer Error]:', error);
    return res.status(500).json({ success: false, message: 'Error: ' + error.message });
  } finally {
    client.release();
  }
};

export const getRecentTransfers = async (req, res) => {
  try {
    const transfers = await InventoryRepository.getRecentTransfers();
    return res.status(200).json({ success: true, transfers });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error al consultar traslados.' });
  }
};

export const updateProduct = async (req, res) => {
  // Simplificado para la demostración
  return res.status(501).json({ message: 'Update product no implementado en este refactor todavía' });
};

export const deleteProduct = async (req, res) => {
  try {
    const success = await InventoryRepository.deactivateProduct(req.params.id);
    if (!success) return res.status(404).json({ success: false, message: 'Producto no encontrado.' });
    return res.status(200).json({ success: true, message: 'Producto desactivado.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error al desactivar el producto.' });
  }
};
