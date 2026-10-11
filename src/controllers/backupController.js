import { pool } from '../config/db.js';
import { config } from '../config/env.js';
import pkg from 'pg';
const { Client } = pkg;
import { generateSqlDump } from '../utils/backupGenerator.js';
import { runScheduledBackup } from '../services/backupScheduler.js';
import AuditRepository from '../repositories/AuditRepository.js';

export const downloadBackup = async (req, res) => {
  try {
    const sqlData = await generateSqlDump();
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-');
    const filename = `backup_inventario_ce_${dateStr}.sql`;
    
    if (req.user) {
      await AuditRepository.logAction(
        req.user.id, 
        req.user.username, 
        'DESCARGAR_BACKUP', 
        `Generó y descargó copia de seguridad auto-recuperable: ${filename}`, 
        req.ip
      );
    }

    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(sqlData);
  } catch (error) {
    console.error('[Backup Download Error]', error);
    return res.status(500).json({ success: false, message: 'Error generando la copia de seguridad: ' + error.message });
  }
};

export const restoreBackup = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se subió ningún archivo de copia de seguridad.' });
    }

    const sqlScript = req.file.buffer.toString('utf8');
    if (!sqlScript || sqlScript.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'El archivo de copia de seguridad está vacío.' });
    }

    console.log('[Backup Restore] Ejecutando script de restauración SQL...');
    // Ejecutar script completo (incluyendo DDL auto-recuperable y DML)
    await pool.query(sqlScript);
    console.log('[Backup Restore] ✅ Restauración completada exitosamente.');

    if (req.user) {
      await AuditRepository.logAction(
        req.user.id, 
        req.user.username, 
        'RESTAURAR_BACKUP', 
        `Restauró exitosamente la base de datos desde archivo subido (${req.file.originalname || 'SQL'})`, 
        req.ip
      );
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Base de datos restaurada correctamente. Todas las tablas, relaciones y datos han sido recuperados.' 
    });
  } catch (error) {
    console.error('[Backup Restore Error]', error);
    return res.status(500).json({ 
      success: false, 
      message: `Error restaurando la copia de seguridad: ${error.message}` 
    });
  }
};

export const syncToNeon = async (req, res) => {
  let neonClient = null;
  try {
    const neonUrl = config.db.neonConnectionString;
    if (!neonUrl) {
      return res.status(400).json({ 
        success: false, 
        message: 'No está configurada la variable NEON_DATABASE_URL en el servidor.' 
      });
    }

    console.log('[Neon Sync] Generando dump de Docker para transferir a Neon...');
    const sqlScript = await generateSqlDump(pool);

    console.log('[Neon Sync] Conectando a Neon Cloud...');
    neonClient = new Client({
      connectionString: neonUrl,
      ssl: { rejectUnauthorized: false }
    });
    await neonClient.connect();

    console.log('[Neon Sync] Aplicando dump a Neon...');
    await neonClient.query(sqlScript);
    console.log('[Neon Sync] ✅ Sincronización exitosa con Neon.');

    if (req.user) {
      await AuditRepository.logAction(
        req.user.id,
        req.user.username,
        'SINCRONIZAR_NEON',
        'Sincronizó exitosamente la base de datos de Docker hacia Neon en la nube.',
        req.ip
      );
    }

    return res.status(200).json({
      success: true,
      message: '¡Sincronización completada! La base de datos en Neon Cloud ahora tiene exactamente los mismos datos y tablas que Docker.'
    });
  } catch (error) {
    console.error('[Neon Sync Error]', error);
    return res.status(500).json({
      success: false,
      message: `Error al sincronizar con Neon: ${error.message}`
    });
  } finally {
    if (neonClient) {
      await neonClient.end().catch(() => {});
    }
  }
};

export const restoreLatestAutoBackup = async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const backupsDir = path.resolve(__dirname, '../../backups');

    const files = await fs.readdir(backupsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    if (sqlFiles.length === 0) {
      return res.status(404).json({ success: false, message: 'No se encontraron copias de seguridad automáticas en el servidor.' });
    }

    const latestFile = sqlFiles[sqlFiles.length - 1];
    const filePath = path.join(backupsDir, latestFile);
    console.log(`[Backup Restore Latest] Restaurando desde: ${latestFile}`);

    const sqlScript = await fs.readFile(filePath, 'utf8');
    await pool.query(sqlScript);
    console.log('[Backup Restore Latest] ✅ Base de datos recuperada exitosamente.');

    if (req.user) {
      await AuditRepository.logAction(
        req.user.id,
        req.user.username,
        'RESTAURAR_ULTIMO_BACKUP',
        `Restauró el sistema en 1-clic usando la copia automática más reciente: ${latestFile}`,
        req.ip
      );
    }

    return res.status(200).json({
      success: true,
      message: `¡Sistema 100% recuperado con éxito! Se restauraron todas las tablas y datos usando la copia: ${latestFile}`
    });
  } catch (error) {
    console.error('[Backup Restore Latest Error]', error);
    return res.status(500).json({ success: false, message: 'Error al restaurar última copia: ' + error.message });
  }
};


export const createAutoBackupNow = async (req, res) => {
  try {
    const result = await runScheduledBackup();
    if (result.success) {
      return res.status(200).json({ success: true, message: `Respaldo automático generado: ${result.filename}` });
    }
    return res.status(500).json({ success: false, message: result.error });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};


