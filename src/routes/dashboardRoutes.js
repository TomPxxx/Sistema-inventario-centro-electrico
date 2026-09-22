import { Router } from 'express';
import { getDashboardSummary } from '../controllers/dashboardController.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';

const router = Router();

// Todas las rutas de dashboard requieren autenticación y rol ADMINISTRADOR
router.use(authenticateJWT);
router.use(authorizeRoles('ADMINISTRADOR'));

// Endpoints de gráficos
router.get('/summary', getDashboardSummary);

export default router;
