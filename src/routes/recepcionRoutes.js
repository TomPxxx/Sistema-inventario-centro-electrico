import { Router } from 'express';
import { 
  crearRecepcion, 
  obtenerRecepciones, 
  registrarProductos, 
  obtenerDetalleRecepcion, 
  distribuirRecepcion,
  obtenerEmpleados
} from '../controllers/recepcionController.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';

const router = Router();

// Todas las rutas de recepción requieren autenticación
router.use(authenticateJWT);

// Obtener empleados (Para el encargado al crear recepción)
router.get('/empleados', authorizeRoles('ENCARGADO', 'ADMINISTRADOR'), obtenerEmpleados);

// Obtener recepciones (El controlador filtra por rol)
router.get('/', obtenerRecepciones);

// Obtener detalle de una recepción (y sus productos)
router.get('/:id', obtenerDetalleRecepcion);

// Encargado crea la recepción y asigna a un empleado
router.post('/', authorizeRoles('ENCARGADO'), crearRecepcion);

// Empleado registra los productos (conteo)
router.post('/:id/conteo', authorizeRoles('EMPLEADO'), registrarProductos);

// Administrador distribuye la mercancía
router.post('/:id/distribuir', authorizeRoles('ADMINISTRADOR'), distribuirRecepcion);

export default router;
