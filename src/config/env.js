import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'inventario_electrico_ce',
    port: Number(process.env.DB_PORT) || 3306,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'jwt_default_secret_key_ce',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  }
};
