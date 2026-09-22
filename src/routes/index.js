import { Router } from 'express';
import authRoutes from './authRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';

const router = Router();

// Montaje de rutas de la API
router.use('/auth', authRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/dashboard', dashboardRoutes);

// Ruta base de la API
router.get('/', (req, res) => {
  res.json({
    name: 'API Sistema de Inventario Multisede (Material Eléctrico)',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      auth: '/api/auth'
    }
  });
});

export default router;
