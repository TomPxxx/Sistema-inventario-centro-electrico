import { pool } from './src/config/db.js';
import bcrypt from 'bcryptjs';

async function fixPassword() {
  try {
    const hash = await bcrypt.hash('Admin123*', 10);
    const result = await pool.query("UPDATE usuarios SET password_hash = $1 WHERE username = 'Cesar'", [hash]);
    console.log(`Updated ${result.rowCount} user(s).`);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

fixPassword();
