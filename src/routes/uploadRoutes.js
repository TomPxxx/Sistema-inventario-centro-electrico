import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';

// Asegurar que el directorio uploads exista
const uploadDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuración de Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generar un nombre único para evitar colisiones
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// Filtrar solo imágenes
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos de imagen.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB
  fileFilter: fileFilter
});

const router = Router();

// Endpoint para subir imágenes (requiere autenticación y rol ADMINISTRADOR)
router.post('/', authenticateJWT, authorizeRoles('ADMINISTRADOR'), upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se subió ninguna imagen.' });
    }
    
    // La imagen fue guardada en public/uploads/archivo.jpg
    // Devolvemos la ruta relativa para el frontend
    const imageUrl = `/uploads/${req.file.filename}`;
    
    return res.status(200).json({ 
      success: true, 
      message: 'Imagen subida correctamente.',
      imagen_url: imageUrl
    });
  } catch (error) {
    console.error('[Upload Error]:', error);
    return res.status(500).json({ success: false, message: 'Error interno al procesar la imagen.' });
  }
});

export default router;
