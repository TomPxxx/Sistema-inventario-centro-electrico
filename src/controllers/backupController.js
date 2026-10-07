import { pool } from '../config/db.js';
import { generateSqlDump } from '../utils/backupGenerator.js';

export const downloadBackup = async (req, res) => {
  try {
    const sqlData = await generateSqlDump();
    const date = new Date().toISOString().split('T')[0];
    
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="backup_inventario_ce_${date}.sql"`);
    return res.status(200).send(sqlData);
  } catch (error) {
    console.error('[Backup Download Error]', error);
    return res.status(500).json({ success: false, message: 'Error generando la copia de seguridad.' });
  }
};

export const restoreBackup = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se subió ningún archivo de copia de seguridad.' });
    }

    const sqlScript = req.file.buffer.toString('utf8');

    // Executing the backup script
    // Note: The SQL string is assumed to be safe because only ADMINs can upload it,
    // and they are uploading the SQL we generated.
    await pool.query(sqlScript);

    return res.status(200).json({ success: true, message: 'Base de datos restaurada correctamente.' });
  } catch (error) {
    console.error('[Backup Restore Error]', error);
    return res.status(500).json({ success: false, message: 'Error restaurando la copia de seguridad. Archivo corrupto o incompatible.' });
  }
};
