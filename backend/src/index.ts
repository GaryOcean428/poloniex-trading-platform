import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { CorsOptions } from 'cors';

// Import routes
import authRoutes from './routes/auth.js';
import apiKeyRoutes from './routes/apiKeys.js';
import futuresRoutes from './routes/futures.js';
import backtestingRoutes from './routes/backtesting.js';
import paperTradingRoutes from './routes/paperTrading.js';
import autonomousTradingRoutes from './routes/autonomousTrading.js';
import confidenceScoringRoutes from './routes/confidenceScoring.js';
import strategiesRoutes from './routes/strategies.js';
import statusRoutes from './routes/status.js';
import marketsRoutes from './routes/markets.js';

// Import services
import { logger } from './utils/logger.js';

// Load environment variables and validate them
dotenv.config();

// Import environment validation after dotenv config
import { env } from './config/env.js';
import { 
  securityHeaders, 
  rateLimiter, 
  authRateLimiter, 
  createCorsOptions, 
  securityLogger, 
  sanitizeRequest 
} from './config/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Use Railway PORT environment variable or fallback to .clinerules compliant port range (8765-8799)
const PORT = env.PORT;

// Socket.IO server setup with Railway-compatible CORS
const allowedOrigins = [
  'https://healthcheck.railway.app',
  ...(env.FRONTEND_URL ? [env.FRONTEND_URL] : []),
  ...(env.CORS_ALLOWED_ORIGINS || []),
  ...(env.NODE_ENV === 'production' ? [] : [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5675'
  ])
];

const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST']
  },
  // Configure for Railway deployment compatibility
  transports: ['websocket', 'polling'],
  pingTimeout: 120000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e6
});

// Enhanced security middleware
app.use(securityHeaders);
app.use(compression());
app.use(securityLogger);
app.use(sanitizeRequest);

// Rate limiting
app.use(rateLimiter);

// Enhanced CORS configuration
app.use(cors(createCorsOptions()));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoints
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Simplified health check for Railway
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes with rate limiting
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/futures', futuresRoutes);
app.use('/api/backtesting', backtestingRoutes);
app.use('/api/paper-trading', paperTradingRoutes);
app.use('/api/autonomous-trading', autonomousTradingRoutes);
app.use('/api/confidence-scoring', confidenceScoringRoutes);
app.use('/api/strategies', strategiesRoutes);
app.use('/api/status', statusRoutes);

/**
 * Serve static frontend only when running as a combined service and the dist exists.
 * In Railpack split deployments the frontend runs as its own service, so skip here.
 */
if (process.env.NODE_ENV === 'production') {
  if (process.env.FRONTEND_STANDALONE === 'true') {
    logger.warn('FRONTEND_STANDALONE=true: skipping static frontend serving in backend');
  } else {
    const distPath = path.resolve(__dirname, '../../frontend/dist');
    if (fs.existsSync(distPath)) {
      // Serve frontend static files with proper MIME types
      app.use(
        express.static(distPath, {
          setHeaders: (res, p) => {
            // Ensure JavaScript files are served with correct MIME type
            if (p.endsWith('.js')) {
              res.set('Content-Type', 'application/javascript');
            }
            // Ensure service worker is served with proper headers
            if (p.endsWith('sw.js')) {
              res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
              res.set('Service-Worker-Allowed', '/');
            }
            // Ensure PNG files are served with correct MIME type
            if (p.endsWith('.png')) {
              res.set('Content-Type', 'image/png');
            }
            // Ensure manifest.json is served with correct MIME type
            if (p.endsWith('manifest.json')) {
              res.set('Content-Type', 'application/manifest+json');
            }
          },
        })
      );

      // Serve index.html for all other routes (SPA support)
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      logger.warn(`Frontend dist not found at ${distPath}; skipping static frontend serving`);
    }
  }
}

/**
 * Redirect root to frontend when running standalone API to avoid "Cannot GET /"
 */
if (process.env.NODE_ENV === 'production' && process.env.FRONTEND_STANDALONE === 'true') {
  const feUrl = process.env.FRONTEND_URL;
  app.get('/', (_req: Request, res: Response) => {
    if (feUrl) {
      return res.redirect(302, feUrl);
    }
    return res
      .status(200)
      .send(
        'Polytrade API is running. FRONTEND_STANDALONE=true; set FRONTEND_URL to enable redirect.'
      );
  });
  // Quiet favicon when API is standalone
  app.get('/favicon.ico', (_req: Request, res: Response) => res.status(204).end());
}

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Handle health check
  socket.on('health-check', () => {
    socket.emit('health-response', {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // Handle market data subscription (mock implementation)
  socket.on('subscribe-market-data', (data) => {
    logger.info(`Client ${socket.id} subscribed to market data:`, data);
    socket.emit('market-data-subscribed', { status: 'subscribed', symbol: data.symbol });
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
  });

  // Handle connection errors
  socket.on('error', (error) => {
    logger.error(`Socket error for ${socket.id}:`, error);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Socket.IO server initialized`);
});
