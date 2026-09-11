import { Router } from 'express';
import { 
  getProductsWithStock, 
  createProduct, 
  executeTransfer, 
  getRecentTransfers 
} from '../controllers/inventoryController.js';

const router = Router();

// Endpoints de productos y traslados
router.get('/products', getProductsWithStock);
router.post('/products', createProduct);
router.get('/transfers', getRecentTransfers);
router.post('/transfers', executeTransfer);

export default router;
