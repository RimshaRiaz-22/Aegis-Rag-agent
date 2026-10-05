import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './src/config/env.js';
import { requestLogger } from './src/middlewares/logging.middleware.js';
import { errorHandler } from './src/middlewares/error.middleware.js';
import { testDatabaseConnection } from './src/config/database.js';
import { settingsRepository } from './src/modules/settings/settings.repository.js';

// Route modules
import authRoutes from './src/modules/auth/auth.routes.js';
import knowledgeRoutes from './src/modules/knowledge/knowledge.routes.js';
import ragRoutes from './src/modules/rag/rag.routes.js';
import settingsRoutes from './src/modules/settings/settings.routes.js';
import widgetRoutes from './src/modules/widget/widget.routes.js';
import chatRoutes from './src/modules/chat/chat.routes.js';
import visitorsRoutes from './src/modules/visitors/visitors.routes.js';

const app = express();

// Security headers with full support for iframe embedding and cross-origin resource requests
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    frameguard: false, // Allows public embed chat widget to run smoothly in iframes
  })
);

// Bulletproof CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    // 1. Allow non-browser callers (curl, postman, server-to-server) or file:// / null origins
    if (!origin || origin === 'null') {
      return callback(null, true);
    }

    // 2. Allow any localhost or 127.0.0.1 port (dev, preview, test runners)
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // 3. Allow origins configured in environment
    if (config.cors.origin.includes(origin)) {
      return callback(null, true);
    }

    // 4. In development and embed mode, allow all origins
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Range',
    'X-Widget-Key',
    'Cache-Control',
  ],
  exposedHeaders: ['Content-Range', 'X-Total-Count', 'Authorization'],
  maxAge: 86400, // 24-hour preflight cache
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLogger);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await testDatabaseConnection();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbHealth,
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: err.message,
    });
  }
});

// Primary REST API v1 Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/knowledge', knowledgeRoutes);
app.use('/api/v1/rag', ragRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/widget', widgetRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/visitors', visitorsRoutes);
app.use('/api/v1/widget/visitor', visitorsRoutes);

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Centralized error handler
app.use(errorHandler);

export default app;
