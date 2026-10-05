import app from './app.js';
import { config } from './src/config/env.js';
import { testDatabaseConnection, pool } from './src/config/database.js';
import { settingsRepository } from './src/modules/settings/settings.repository.js';

async function bootstrap() {
  console.log('🛡️  Aegis RAG Server Initializing...');

  try {
    const dbStatus = await testDatabaseConnection();
    console.log(`✅ Connected to PostgreSQL database: "${dbStatus.database}" at ${dbStatus.timestamp}`);

    const encryptedCount = await settingsRepository.encryptLegacyRows();
    if (encryptedCount > 0) {
      console.log(`🔒 Encrypted ${encryptedCount} legacy settings row(s) with AES-256-GCM.`);
    }
  } catch (err) {
    console.error('❌ Failed to connect to PostgreSQL database:', err.message);
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`🚀 Server listening on http://localhost:${config.port}`);
    console.log(`📡 Health check available at http://localhost:${config.port}/health`);
    console.log(`📚 REST API mounted at http://localhost:${config.port}/api/v1`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Gracefully shutting down server...`);
    server.close(async () => {
      console.log('🔒 HTTP server closed.');
      await pool.end();
      console.log('📦 PostgreSQL connection pool drained.');
      process.exit(0);
    });

    // Force close after 10s
    setTimeout(() => {
      console.error('⚠️ Forcefully terminating after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap();
