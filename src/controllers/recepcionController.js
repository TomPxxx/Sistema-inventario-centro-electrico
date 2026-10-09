import RecepcionRepository from '../repositories/RecepcionRepository.js';
import AuditRepository from '../repositories/AuditRepository.js';
export const crearRecepcion = async (req, res) => {
  try {
    const encargadoId = req.user.id;
    const sedeReceptoraId = req.user.sede_id; // Encargado's sede
    const { empleado_id, observaciones } = req.body;

    if (!empleado_id) {
      return res.status(400).json({ error: 'Debe asignar a un empleado para el conteo' });
    }

    const nuevaRecepcion = await RecepcionRepository.createRecepcion(
      sedeReceptoraId,
      encargadoId,
      empleado_id,
      observaciones
    );

    if (req.user) {
      await AuditRepository.logAction(req.user.id, req.user.username, 'RECEPCION', `Creó recepción ID ${nuevaRecepcion.id} asignada a empleado ID ${empleado_id}`, req.ip);
    }

    res.status(201).json({
      message: 'Recepción creada y asignada exitosamente',
      recepcion: nuevaRecepcion
    });

    // Notificar en tiempo real
    if (req.app.get('io')) {
      req.app.get('io').emit('recepcion_creada', nuevaRecepcion);
    }
  } catch (error) {
    console.error('Error al crear recepción:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const obtenerRecepciones = async (req, res) => {
  try {
    const { rol, id, sede_id } = req.user;
    let recepciones = [];

    if (rol === 'ADMINISTRADOR') {
      recepciones = await RecepcionRepository.getAllRecepciones();
    } else if (rol === 'ENCARGADO') {
      recepciones = await RecepcionRepository.getRecepcionesBySede(sede_id);
    } else if (rol === 'EMPLEADO') {
      recepciones = await RecepcionRepository.getRecepcionesByEmpleado(id);
    }

    res.json({ recepciones });
  } catch (error) {
    console.error('Error al obtener recepciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const registrarProductos = async (req, res) => {
  try {
    const { id } = req.params; // recepcionId
    const { productos } = req.body; // Array de { codigo_sku, cantidad_recibida }
    const empleadoId = req.user.id;

    const recepcion = await RecepcionRepository.getRecepcionById(id);
    if (!recepcion) {
      return res.status(404).json({ error: 'Recepción no encontrada' });
    }

    if (recepcion.empleado_id !== empleadoId) {
      return res.status(403).json({ error: 'No está autorizado para registrar esta recepción' });
    }

    if (recepcion.estado !== 'PENDIENTE_CONTEO') {
      return res.status(400).json({ error: 'La recepción ya fue contabilizada o está en otro estado' });
    }

    if (!productos || !Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: 'Debe enviar al menos un producto' });
    }

    await RecepcionRepository.addProductosToRecepcion(id, productos);
    const recepcionActualizada = await RecepcionRepository.updateEstadoRecepcion(id, 'CONTABILIZADO');

    if (req.user) {
      await AuditRepository.logAction(req.user.id, req.user.username, 'CONTEO_MERCANCIA', `Contabilizó la recepción ID ${id}`, req.ip);
    }

    res.json({
      message: 'Productos registrados y recepción contabilizada exitosamente',
      recepcion: recepcionActualizada
    });

    // Notificar en tiempo real
    if (req.app.get('io')) {
      req.app.get('io').emit('recepcion_contabilizada', recepcionActualizada);
    }
  } catch (error) {
    console.error('Error al registrar productos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const obtenerDetalleRecepcion = async (req, res) => {
  try {
    const { id } = req.params;
    const recepcion = await RecepcionRepository.getRecepcionById(id);
    if (!recepcion) {
      return res.status(404).json({ error: 'Recepción no encontrada' });
    }

    const productos = await RecepcionRepository.getProductosByRecepcion(id);
    res.json({ recepcion, productos });
  } catch (error) {
    console.error('Error al obtener detalles:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const distribuirRecepcion = async (req, res) => {
  try {
    // Solo administrador
    if (req.user.rol !== 'ADMINISTRADOR') {
      return res.status(403).json({ error: 'Solo el administrador puede distribuir la recepción' });
    }

    const { id } = req.params; // recepcionId
    const { distribucion } = req.body; 
    // distribucion = [{ codigo_sku, sede_id, cantidad, precio_venta (opcional si ya existe) }]
    // Esta lógica la implementaremos más a fondo luego. Por ahora marcamos como distribuido.

    const recepcion = await RecepcionRepository.getRecepcionById(id);
    if (!recepcion) {
      return res.status(404).json({ error: 'Recepción no encontrada' });
    }

    if (recepcion.estado !== 'CONTABILIZADO') {
      return res.status(400).json({ error: 'La recepción debe estar contabilizada para poder distribuirse' });
    }

    // Lógica para distribuir la recepción: Añadimos el stock al almacén destino (sede_receptora_id)
    const productos = await RecepcionRepository.getProductosByRecepcion(id);
    await RecepcionRepository.distribuirProductosEnInventario(id, recepcion.sede_receptora_id, productos, req.user.id);

    res.json({
      message: 'Recepción distribuida exitosamente al inventario',
      recepcion: { ...recepcion, estado: 'DISTRIBUIDO' }
    });

    // Notificar a todos que el stock ha sido actualizado
    if (req.app.get('io')) {
      req.app.get('io').emit('stock_actualizado', { recepcionId: id });
    }
  } catch (error) {
    console.error('Error al distribuir recepción:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const obtenerEmpleados = async (req, res) => {
  try {
    const empleados = await RecepcionRepository.getEmpleados();
    res.json({ empleados });
  } catch (error) {
    console.error('Error al obtener empleados:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
