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

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const ALLOWED_MIMETYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Valida el tipo real de la imagen inspeccionando sus magic bytes (cabecera binaria).
 * Soporta únicamente PNG, JPEG/JPG y WEBP.
 */
export function detectImageRealFormat(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }

  // WEBP: "RIFF" (52 49 46 46) en 0..3 y "WEBP" (57 45 42 50) en 8..11
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

// Configuración de Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// Filtrar por extensión y MIME declarados (png/jpg/webp)
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIMETYPES.has(mime)) {
    return cb(new Error('Formato no permitido. Solo se aceptan imágenes PNG, JPG o WEBP.'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter
});

const router = Router();

// Endpoint para subir imágenes (requiere autenticación y rol ADMINISTRADOR)
router.post('/', authenticateJWT, authorizeRoles('ADMINISTRADOR'), (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'El archivo excede el tamaño máximo permitido de 5 MB.'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Formato de archivo inválido. Solo se aceptan PNG, JPG o WEBP.'
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No se subió ninguna imagen.' });
      }

      // Validar tipo real mediante magic bytes del archivo en disco
      const fd = fs.openSync(req.file.path, 'r');
      const headerBuffer = Buffer.alloc(12);
      const bytesRead = fs.readSync(fd, headerBuffer, 0, 12, 0);
      fs.closeSync(fd);

      const realFormat = detectImageRealFormat(headerBuffer.subarray(0, bytesRead));
      if (!realFormat) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_unlinkErr) {}
        return res.status(400).json({
          success: false,
          message: 'Archivo rechazado: el contenido binario real no corresponde a una imagen válida PNG, JPG o WEBP.'
        });
      }

      const imageUrl = `/uploads/${req.file.filename}`;

      return res.status(200).json({
        success: true,
        message: 'Imagen validada y subida correctamente.',
        formato_detectado: realFormat,
        imagen_url: imageUrl
      });
    } catch (error) {
      console.error('[Upload Error]:', error);
      return res.status(500).json({ success: false, message: 'Error interno al procesar la imagen.' });
    }
  });
});

export default router;
