import { Router } from 'express';
import multer from 'multer';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';
import { downloadBackup, restoreBackup } from '../controllers/backupController.js';

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

const router = Router();

// Backup and Restore endpoints (Admin only)
router.get('/download', authenticateJWT, authorizeRoles('ADMINISTRADOR'), downloadBackup);
router.post('/restore', authenticateJWT, authorizeRoles('ADMINISTRADOR'), upload.single('backupFile'), restoreBackup);

export default router;
