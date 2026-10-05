import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

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
    secret: process.env.JWT_SECRET || 'aegis_fallback_jwt_secret_dev_mode',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'aegis_fallback_refresh_secret_dev_mode',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim()),
  },

  rag: {
    // Server-level OpenAI API key (optional global fallback — user settings take priority)
    openAiApiKey: process.env.OPENAI_API_KEY || '',
  },

  encryption: {
    // 32-byte (64 hex chars) key used for AES-256-GCM encryption of data at rest.
    // NEVER change or lose this key after data has been written — it cannot be recovered.
    key: process.env.DATA_ENCRYPTION_KEY || '',
  },

  // Optional shared secret for server-to-server ingestion (e.g. n8n webhooks) that
  // need to ingest on behalf of a specific user via body.user_id.
  ingestWebhookSecret: process.env.INGEST_WEBHOOK_SECRET || '',
};
