import { Router } from 'express';
import { getDashboardSummary, getPaginatedMovements, optimizeMovementsStorage } from '../controllers/dashboardController.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';

const router = Router();

// Todas las rutas de dashboard requieren autenticación y rol ADMINISTRADOR
router.use(authenticateJWT);
router.use(authorizeRoles('ADMINISTRADOR'));

// Endpoints de gráficos y movimientos paginados en vivo
router.get('/summary', getDashboardSummary);
router.get('/movements', getPaginatedMovements);
router.post('/movements/optimize', optimizeMovementsStorage);

export default router;
