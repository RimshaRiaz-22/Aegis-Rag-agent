import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isProd = process.env.NODE_ENV === 'production';

// In production, enforce that security secrets are explicitly configured
if (isProd) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    throw new Error('FATAL: JWT_SECRET environment variable is missing or insecure in production mode.');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 16) {
    throw new Error('FATAL: JWT_REFRESH_SECRET environment variable is missing or insecure in production mode.');
  }
}

export const config = {
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: isProd,

  database: {
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'aegis_rag_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:
      process.env.DB_SSL === 'true' ||
      (process.env.DATABASE_URL &&
        (process.env.DATABASE_URL.includes('neon.tech') ||
          process.env.DATABASE_URL.includes('sslmode=require')))
        ? { rejectUnauthorized: false }
        : false,
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'aegis_secure_dev_jwt_key_random_fallback',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'aegis_secure_dev_refresh_key_random_fallback',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  cors: {
    origin: '*',
  },


  rag: {
    openAiApiKey: process.env.OPENAI_API_KEY || '',
  },

  encryption: {
    key: process.env.DATA_ENCRYPTION_KEY || '',
  },

  ingestWebhookSecret: process.env.INGEST_WEBHOOK_SECRET || '',
};
