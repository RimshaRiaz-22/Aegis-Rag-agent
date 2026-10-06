import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './src/config/env.js';
import { requestLogger } from './src/middlewares/logging.middleware.js';
import { errorHandler } from './src/middlewares/error.middleware.js';
import { testDatabaseConnection } from './src/config/database.js';

// Route modules
import authRoutes from './src/modules/auth/auth.routes.js';
import knowledgeRoutes from './src/modules/knowledge/knowledge.routes.js';
import ragRoutes from './src/modules/rag/rag.routes.js';
import settingsRoutes from './src/modules/settings/settings.routes.js';
import widgetRoutes from './src/modules/widget/widget.routes.js';
import chatRoutes from './src/modules/chat/chat.routes.js';
import visitorsRoutes from './src/modules/visitors/visitors.routes.js';
import webSearchRoutes from './src/modules/websearch/webSearch.routes.js';

const app = express();

// Trust reverse proxy (nginx / AWS ALB / Cloudflare / Netlify) for correct req.ip and rate limiting
app.set('trust proxy', 1);

// Security headers with support for iframe embedding on public widgets
app.use(
  helmet({
    contentSecurityPolicy: false,
    hsts: false, // Prevent forcing HTTPS upgrades on local / LAN IP HTTP development
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    frameguard: false, // Allows public embed chat widget to run in customer iframes
  })
);

// Support Chrome Private Network Access (PNA) for LAN/cross-origin requests
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

// Universal Permissive CORS: allow all origins with credentials & any requested headers
const universalCorsOptions = {
  origin: (origin, callback) => callback(null, true), // Reflects any origin, allows all (*)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // Omitting allowedHeaders allows cors to dynamically accept all client headers (e.g. x-user-id, x-guest-id, x-namespace, Authorization)
};

app.use(cors(universalCorsOptions));
app.options('*', cors(universalCorsOptions));



// High-limit parser specifically for document ingestion payloads
app.use('/api/v1/knowledge/ingest', express.json({ limit: '25mb' }));

// Standard safe JSON & urlencoded parser for general API routes (prevents RAM exhaustion DoS)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(requestLogger);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await testDatabaseConnection();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: { operational: true },
      uptime: Math.floor(process.uptime()),
    });
  } catch (err) {
    console.error('[Health Check Failure]:', err.message);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Service temporarily unavailable',
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
app.use('/api/v1/websearch', webSearchRoutes);

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
