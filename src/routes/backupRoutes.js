import { Router } from 'express';
import multer from 'multer';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';
import { downloadBackup, restoreBackup, syncToNeon, createAutoBackupNow, restoreLatestAutoBackup } from '../controllers/backupController.js';

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

const router = Router();

// Backup and Restore endpoints (Admin only)
router.get('/download', authenticateJWT, authorizeRoles('ADMINISTRADOR'), downloadBackup);
router.post('/restore', authenticateJWT, authorizeRoles('ADMINISTRADOR'), upload.single('backupFile'), restoreBackup);
router.post('/restore-latest', authenticateJWT, authorizeRoles('ADMINISTRADOR'), restoreLatestAutoBackup);
router.post('/sync-neon', authenticateJWT, authorizeRoles('ADMINISTRADOR'), syncToNeon);
router.post('/create-auto', authenticateJWT, authorizeRoles('ADMINISTRADOR'), createAutoBackupNow);

export default router;
