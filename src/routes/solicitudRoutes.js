import { Router } from 'express';
import {
  createSolicitud,
  getSolicitudes,
  responderSolicitud,
  asignarCorredor,
  completarRecepcion,
  getCorredores,
  adminDespachar
} from '../controllers/solicitudController.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateJWT);

// Obtener corredores disponibles
router.get('/corredores', authorizeRoles('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'), getCorredores);

// Listar solicitudes visibles
router.get('/', authorizeRoles('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'), getSolicitudes);

// Crear nueva solicitud (Encargados o Administrador)
router.post('/', authorizeRoles('ADMINISTRADOR', 'ENCARGADO'), createSolicitud);

// Responder a solicitud (Aceptar o Rechazar)
router.post('/:id/responder', authorizeRoles('ADMINISTRADOR', 'ENCARGADO'), responderSolicitud);

// Despacho directo Multi-Sede administrado por el Administrador Global
router.post('/:id/admin-despachar', authorizeRoles('ADMINISTRADOR'), adminDespachar);

// Asignar corredor logístico
router.post('/:id/asignar-corredor', authorizeRoles('ADMINISTRADOR', 'ENCARGADO'), asignarCorredor);

// Confirmar recepción física
router.post('/:id/completar', authorizeRoles('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'), completarRecepcion);

export default router;
