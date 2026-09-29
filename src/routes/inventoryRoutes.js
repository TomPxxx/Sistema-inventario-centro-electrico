import { Router } from 'express';
import { 
  getProductsWithStock, 
  createProduct, 
  executeTransfer, 
  getRecentTransfers,
  updateProduct,
  deleteProduct,
  getCategories,
  createCategory
} from '../controllers/inventoryController.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';

const router = Router();

// Todas las rutas de inventario requieren autenticación
router.use(authenticateJWT);

// Endpoints de productos y traslados
// Lectura y traslados: Administrador, Encargado, Empleado
router.get('/products', authorizeRoles('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'), getProductsWithStock);
router.get('/transfers', authorizeRoles('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'), getRecentTransfers);
router.post('/transfers', authorizeRoles('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'), executeTransfer);
router.get('/categories', authorizeRoles('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'), getCategories);

// Escritura/Modificación: Solo Administrador
router.post('/products', authorizeRoles('ADMINISTRADOR'), createProduct);
router.put('/products/:id', authorizeRoles('ADMINISTRADOR'), updateProduct);
router.delete('/products/:id', authorizeRoles('ADMINISTRADOR'), deleteProduct);
router.post('/categories', authorizeRoles('ADMINISTRADOR'), createCategory);

export default router;
