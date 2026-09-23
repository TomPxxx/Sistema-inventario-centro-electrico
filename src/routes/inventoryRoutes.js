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

const router = Router();

// Endpoints de productos y traslados
router.get('/products', getProductsWithStock);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.get('/transfers', getRecentTransfers);
router.post('/transfers', executeTransfer);

// Endpoints de categorias
router.get('/categories', getCategories);
router.post('/categories', createCategory);

export default router;
