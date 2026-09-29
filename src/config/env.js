import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Tomas1022352347@localhost:5432/inventario_electrico_ce'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'jwt_default_secret_key_ce',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  recaptcha: {
    secretKey: process.env.RECAPTCHA_SECRET_KEY,
    siteKey: process.env.RECAPTCHA_SITE_KEY,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }
};
