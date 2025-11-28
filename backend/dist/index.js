import express from 'express';
import cors from 'cors';
import compression from 'compression';
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
import backtestRoutes from './routes/backtest.js';
import paperTradingRoutes from './routes/paperTrading.js';
import paperTradingRoutesNew from './routes/paper-trading.js';
import riskRoutes from './routes/risk.js';
import autonomousTradingRoutes from './routes/autonomousTrading.js';
import confidenceScoringRoutes from './routes/confidenceScoring.js';
import strategiesRoutes from './routes/strategies.js';
import statusRoutes from './routes/status.js';
import marketsRoutes from './routes/markets.js';
import proxyRoutes from './routes/proxy.js';
import llmStrategiesRoutes from './routes/llmStrategies.js';
import credentialsRoutes from './routes/credentials.js';
import tradingSessionsRoutes from './routes/tradingSessions.js';
import debugRoutes from './routes/debug.js';
import agentRoutes from './routes/agent.js';
import monitoringRoutes from './routes/monitoring.js';
import adminRoutes from './routes/admin.js';
import aiRoutes from './routes/ai.js';
import dashboardRoutes from './routes/dashboard.js';
import mlRoutes from './routes/ml.js';
import qigRoutes from './routes/qig.js';
import publicAdminRoutes from './routes/public-admin.js';
import versionCheckRoutes from './routes/version-check.js';
import autonomousTraderRoutes from './routes/autonomousTrader.js';
import diagnosticRoutes from './routes/diagnostic.js';
import testBalanceRoutes from './routes/test-balance.js';
// Import services
import { logger } from './utils/logger.js';
import { persistentTradingEngine } from './services/persistentTradingEngine.js';
import { agentScheduler } from './services/agentScheduler.js';
// Import environment configuration (dotenv.config() is called inside env.ts)
import { env } from './config/env.js';
import { securityHeaders, rateLimiter, authRateLimiter, createCorsOptions, securityLogger, sanitizeRequest } from './config/security.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = createServer(app);
// Use Railway PORT environment variable or fallback to .clinerules compliant port range (8765-8799)
const PORT = env.PORT;
// Production monitoring configuration
const HEARTBEAT_INTERVAL_MS = 60000; // 60 seconds
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
// CORS MUST be early in the middleware stack to ensure headers are added to ALL responses
// including error responses from rate limiter, auth failures, etc.
app.use(cors(createCorsOptions()));
// Body parsing (before rate limiting so rate limiter can inspect body if needed)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Security logging and sanitization
app.use(securityLogger);
app.use(sanitizeRequest);
// Rate limiting (after CORS so rate-limited responses still have CORS headers)
app.use(rateLimiter);
// Health check endpoints
const healthResponse = { status: 'ok', timestamp: new Date().toISOString() };
// Root health check (for exec_preview)
app.get('/health', (_req, res) => {
    res.json(healthResponse);
});
// API health check
app.get('/api/health', async (_req, res) => {
    // Get server's public IP address
    let publicIP = 'unknown';
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        publicIP = data.ip;
    }
    catch (error) {
        logger.error('Failed to fetch public IP:', error);
    }
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        publicIP: publicIP
    });
});
// Simplified health check for Railway (backward compatibility)
app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Version check endpoint (no auth required)
app.use('/api/version-check', versionCheckRoutes);
// Deploy version endpoint (no auth required)
app.get('/api/deploy/version', (_req, res) => {
    res.json({
        version: '2.0.0-FIXED',
        timestamp: new Date().toISOString(),
        commit: 'f611ea2',
        message: 'Pre-built dist with permissions fix',
        userServiceFixed: true
    });
});
// API routes with rate limiting
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/keys', apiKeyRoutes); // Alias for frontend compatibility
app.use('/api/markets', marketsRoutes);
app.use('/api/futures', futuresRoutes);
app.use('/api/backtesting', backtestingRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/paper-trading', paperTradingRoutes);
app.use('/api/paper-trading-v2', paperTradingRoutesNew);
app.use('/api/risk', riskRoutes);
app.use('/api/autonomous-trading', autonomousTradingRoutes);
app.use('/api/confidence-scoring', confidenceScoringRoutes);
app.use('/api/strategies', strategiesRoutes);
app.use('/api/llm-strategies', llmStrategiesRoutes);
app.use('/api/credentials', credentialsRoutes);
app.use('/api/trading-sessions', tradingSessionsRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/debug', debugRoutes); // Debug routes for database inspection
app.use('/api/diagnostic', diagnosticRoutes); // Diagnostic routes for troubleshooting
app.use('/api/test-balance', testBalanceRoutes); // Test balance endpoint with detailed logging
app.use('/api/agent', agentRoutes); // Autonomous trading agent routes
app.use('/api/autonomous', autonomousTraderRoutes); // Fully autonomous trading system
app.use('/api/monitoring', monitoringRoutes); // Monitoring and error tracking routes
app.use('/api/admin', adminRoutes); // Admin routes for migrations
app.use('/api/ai', aiRoutes); // AI-powered trading insights using Claude Sonnet 4.5
app.use('/api/dashboard', dashboardRoutes); // Unified dashboard data endpoint
app.use('/api/ml', mlRoutes); // ML model predictions and performance
app.use('/api/qig', qigRoutes); // QIG-enhanced predictions with information geometry
app.use('/api/public-admin', publicAdminRoutes); // Public admin routes for password reset
// Legacy proxy routes (deprecated - use futures API instead)
app.use('/api', proxyRoutes);
/**
 * Serve static frontend only when running as a combined service and the dist exists.
 * In Railpack split deployments the frontend runs as its own service, so skip here.
 */
if (process.env.NODE_ENV === 'production') {
    if (process.env.FRONTEND_STANDALONE === 'true') {
        logger.warn('FRONTEND_STANDALONE=true: skipping static frontend serving in backend');
    }
    else {
        const distPath = path.resolve(__dirname, '../../frontend/dist');
        logger.info(`Checking for frontend dist at: ${distPath}`);
        if (fs.existsSync(distPath)) {
            logger.info('Frontend dist found, serving static files');
            // Serve frontend static files with proper MIME types
            app.use(express.static(distPath, {
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
            }));
            // SPA fallback: Serve index.html for all non-API, non-static-file routes
            // This ensures routes like /dashboard/live, /strategies, etc. work correctly
            app.get('*', (req, res) => {
                // Only serve index.html for non-API routes
                if (!req.path.startsWith('/api')) {
                    logger.debug(`SPA fallback: serving index.html for ${req.path}`);
                    res.sendFile(path.join(distPath, 'index.html'));
                }
                else {
                    // API routes that didn't match should return 404
                    res.status(404).json({ error: 'API endpoint not found' });
                }
            });
        }
        else {
            logger.warn(`Frontend dist not found at ${distPath}; skipping static frontend serving`);
            logger.warn('Run "yarn build:frontend" to generate frontend build');
        }
    }
}
/**
 * Redirect root to frontend when running standalone API to avoid "Cannot GET /"
 */
if (process.env.NODE_ENV === 'production' && process.env.FRONTEND_STANDALONE === 'true') {
    const feUrl = process.env.FRONTEND_URL;
    app.get('/', (_req, res) => {
        if (feUrl) {
            return res.redirect(302, feUrl);
        }
        return res
            .status(200)
            .send('Polytrade API is running. FRONTEND_STANDALONE=true; set FRONTEND_URL to enable redirect.');
    });
    // Quiet favicon when API is standalone
    app.get('/favicon.ico', (_req, res) => res.status(204).end());
}
// Error handling middleware
app.use((err, _req, res, _next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});
// Process-level error handlers for stability
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection:', {
        reason,
        promise,
        stack: reason instanceof Error ? reason.stack : undefined
    });
    // Don't exit - log and continue for better stability
});
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', {
        error: error.message,
        stack: error.stack
    });
    // Log and exit gracefully - uncaught exceptions leave app in undefined state
    logger.error('Process will exit due to uncaught exception');
    setTimeout(() => {
        process.exit(1);
    }, 1000); // Give time for logs to flush
});
// Graceful shutdown handler
const gracefulShutdown = (signal) => {
    logger.info(`${signal} signal received: starting graceful shutdown`);
    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
        logger.error('Graceful shutdown timeout exceeded, forcing exit');
        process.exit(1);
    }, 10000); // 10 second timeout
    // First, stop the trading engine
    persistentTradingEngine.stop().then(() => {
        logger.info('Trading engine stopped');
        // Then close Socket.IO to disconnect all websocket connections
        io.close(() => {
            logger.info('Socket.IO server closed');
            // Then close the HTTP server
            server.close(() => {
                logger.info('HTTP server closed');
                clearTimeout(forceExitTimeout);
                process.exit(0);
            });
        });
    }).catch(error => {
        logger.error('Error stopping trading engine:', error);
        process.exit(1);
    });
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
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
server.listen(PORT, '::', () => {
    logger.info(`✅ Backend startup complete`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform
    });
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Socket.IO server initialized`);
    // Start persistent trading engine
    persistentTradingEngine.start().catch(error => {
        logger.error('Failed to start persistent trading engine:', error);
    });
    // Start agent scheduler
    agentScheduler.start().catch(error => {
        logger.error('Failed to start trading engine:', error);
    });
    // Health heartbeat for production monitoring
    if (process.env.NODE_ENV === 'production') {
        setInterval(() => {
            const memUsage = process.memoryUsage();
            logger.info('💓 Backend heartbeat', {
                uptime: Math.floor(process.uptime()),
                memory: {
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                    rss: Math.round(memUsage.rss / 1024 / 1024)
                },
                timestamp: new Date().toISOString()
            });
        }, HEARTBEAT_INTERVAL_MS);
    }
});
