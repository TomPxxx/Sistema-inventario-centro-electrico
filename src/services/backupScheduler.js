import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSqlDump } from '../utils/backupGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');

export async function runScheduledBackup() {
  try {
    await fs.mkdir(BACKUPS_DIR, { recursive: true });

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const filename = `backup_auto_${timestamp}.sql`;
    const filePath = path.join(BACKUPS_DIR, filename);

    console.log(`[Backup Auto] Generando copia de seguridad programada: ${filename}...`);
    const sql = await generateSqlDump();
    await fs.writeFile(filePath, sql, 'utf8');
    console.log(`[Backup Auto] ✅ Copia guardada en: ${filePath}`);

    // Rotación: Mantener los 7 respaldos más recientes y eliminar los antiguos
    const files = await fs.readdir(BACKUPS_DIR);
    const autoFiles = files
      .filter(f => f.startsWith('backup_auto_') && f.endsWith('.sql'))
      .sort(); // orden cronológico ascendente

    if (autoFiles.length > 7) {
      const filesToDelete = autoFiles.slice(0, autoFiles.length - 7);
      for (const oldFile of filesToDelete) {
        await fs.unlink(path.join(BACKUPS_DIR, oldFile)).catch(() => {});
        console.log(`[Backup Auto] 🗑️ Respaldo antiguo purgado: ${oldFile}`);
      }
    }

    return { success: true, filename, filePath };
  } catch (error) {
    console.error('[Backup Auto Error]:', error.message);
    return { success: false, error: error.message };
  }
}

export function initBackupScheduler() {
  // 1. Ejecutar respaldo inicial a los 10 segundos del arranque
  setTimeout(() => {
    runScheduledBackup().catch(err => console.error('[Backup Init Error]', err));
  }, 10000);

  // 2. Programar ejecución cada 6 horas (21,600,000 ms)
  const INTERVAL_MS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    runScheduledBackup().catch(err => console.error('[Backup Interval Error]', err));
  }, INTERVAL_MS);

  console.log('[Backup Scheduler] 🛡️ Servicio de copias automáticas activado (rotación cada 6 horas, retención 7 copias).');
}
