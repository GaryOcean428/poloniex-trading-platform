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

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Use Railway PORT environment variable or fallback to .clinerules compliant port range (8765-8799)
const PORT = parseInt(process.env.PORT || '8765', 10);

// CORS configuration with support for multiple origins and Railway deployment
const allowedOrigins = [
  'https://healthcheck.railway.app',
  'https://poloniex-trading-platform-production.up.railway.app',
  'https://polytrade-red.vercel.app',
  'https://polytrade-be.up.railway.app',
  process.env.FRONTEND_URL || 'http://localhost:5675',
  // Allow dynamic Railway domains
  ...(process.env.RAILWAY_SERVICE_POLYTRADE_FE_URL ? [`https://${process.env.RAILWAY_SERVICE_POLYTRADE_FE_URL}`] : []),
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173'])
];

// Socket.IO server setup with Railway-compatible CORS
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

// Middleware
app.use(helmet());
app.use(compression());

// CORS configuration with support for multiple origins and Railway deployment
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

<<<<<<< HEAD
// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
=======
// Health check endpoints
app.get('/api/health', (_req: Request, res: Response) => {
>>>>>>> origin/main
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

<<<<<<< HEAD
=======
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    service: 'backend'
  });
});

>>>>>>> origin/main
// API routes
app.use('/api/auth', authRoutes);
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
<<<<<<< HEAD
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
=======
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
>>>>>>> origin/main
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
