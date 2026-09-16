import { Router } from 'express';
import { 
  getProductsWithStock, 
  createProduct, 
  executeTransfer, 
  getRecentTransfers,
  updateProduct,
  deleteProduct
} from '../controllers/inventoryController.js';

const router = Router();

// Endpoints de productos y traslados
router.get('/products', getProductsWithStock);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.get('/transfers', getRecentTransfers);
router.post('/transfers', executeTransfer);

export default router;
