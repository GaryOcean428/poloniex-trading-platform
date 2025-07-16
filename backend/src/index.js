import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import authRoutes from './routes/auth.js';
import { optionalAuth } from './middleware/auth.js';
import { healthCheck } from './db/connection.js';
import { UserService } from './services/userService.js';
import redisService from './services/redisService.js';
import { RedisRateLimiter, SocketIORateLimiter } from './middleware/redisRateLimit.js';
import { logger } from './utils/logger.js';

// Configure environment variables
dotenv.config();

// Add startup logging for debugging
logger.info('\n🚀 POLYTRADE BACKEND STARTUP\n');
logger.info('='.repeat(50));

// Check critical environment variables
const envCheck = {
  POLONIEX_API_KEY: process.env.POLONIEX_API_KEY,
  POLONIEX_API_SECRET: process.env.POLONIEX_API_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_PRIVATE_DOMAIN: process.env.REDIS_PRIVATE_DOMAIN,
  JWT_SECRET: process.env.JWT_SECRET || process.env.JWT_SECRT,
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV,
  FRONTEND_URL: process.env.FRONTEND_URL,
};

// Display configuration
logger.info('📋 Configuration Status:');
Object.entries(envCheck).forEach(([key, value]) => {
  if (key.includes('SECRET') || key.includes('URL') || key.includes('PASSWORD')) {
    logger.info(`${key}: ${value ? '✅ SET' : '❌ NOT SET'}`);
  } else {
    logger.info(`${key}: ${value || '❌ NOT SET'}`);
  }
});

// Check if we're in mock mode
const hasApiCredentials = !!(
  envCheck.POLONIEX_API_KEY &&
  envCheck.POLONIEX_API_SECRET
);

logger.info(`\nTrading Mode: ${hasApiCredentials ? '✅ LIVE' : '🧪 MOCK'}`);
logger.info('='.repeat(50));

// ES module path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Redis
redisService.connect().catch(error => {
  logger.error('❌ Failed to initialize Redis:', error);
});

// Create Express app
const app = express();

// Trust proxy for Railway deployment
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// More restrictive CORS configuration
const allowedOrigins = [
  'https://healthcheck.railway.app',
  'https://poloniex-trading-platform-production.up.railway.app',
  'https://polytrade-red.vercel.app',
  'https://polytrade-be.up.railway.app',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:5173'] : [])
];

// Utility: robust origin check
const isAllowedOrigin = (requestOrigin) => {
  if (!requestOrigin) return true;
  const cleanedOrigin = requestOrigin.replace(/\/$/, '');
  return allowedOrigins.some((allowed) => {
    const cleanedAllowed = allowed.replace(/\/$/, '');
    return cleanedOrigin === cleanedAllowed || cleanedOrigin.startsWith(cleanedAllowed);
  });
};

// CORS middleware configuration
const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      logger.warn(`🚫 CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200,
});

// Redis-based rate limiting
const apiRateLimiter = new RedisRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  keyGenerator: (req) => `api:${req.ip || req.connection?.remoteAddress || 'unknown'}`
});

// Socket.IO rate limiter
const socketRateLimiter = new SocketIORateLimiter({
  maxEventsPerMinute: 30
});

app.use(express.json({ limit: '10mb' }));

// Serve static files from frontend build
const frontendDistPath = path.join(__dirname, '../public');
app.use(express.static(frontendDistPath));

// Apply CORS and rate limiting to API routes
app.use('/api/', corsMiddleware, apiRateLimiter.middleware());

import proxyRoutes from './routes/proxy.js';
import apiKeysRoutes from './routes/apiKeys.js';
import futuresRoutes from './routes/futures.js';
import backtestingRoutes from './routes/backtesting.js';
import paperTradingRoutes from './routes/paperTrading.js';
import confidenceScoringRoutes from './routes/confidenceScoring.js';
import autonomousTradingRoutes from './routes/autonomousTrading.js';
import automatedTradingService from './services/automatedTradingService.js';
import futuresWebSocket from './websocket/futuresWebSocket.js';
import backtestingEngine from './services/backtestingEngine.js';
import paperTradingService from './services/paperTradingService.js';
import confidenceScoringService from './services/confidenceScoringService.js';
import autonomousStrategyGenerator from './services/autonomousStrategyGenerator.js';
import strategyOptimizer from './services/strategyOptimizer.js';
import profitBankingService from './services/profitBankingService.js';

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/keys', apiKeysRoutes);
app.use('/api/futures', futuresRoutes);
app.use('/api/backtesting', backtestingRoutes);
app.use('/api/paper-trading', paperTradingRoutes);
app.use('/api/confidence-scoring', confidenceScoringRoutes);
app.use('/api/autonomous-trading', autonomousTradingRoutes);
app.use('/api', proxyRoutes);

// Create HTTP server
const server = http.createServer(app);

// Set up Socket.IO with security
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        logger.warn(`🚫 Socket.IO CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 120000,
  pingInterval: 25000
});

// Circuit breaker for WebSocket connections
const circuitBreaker = {
  state: 'CLOSED',
  failureCount: 0,
  lastFailureTime: null,
  successCount: 0,
  FAILURE_THRESHOLD: 3,
  SUCCESS_THRESHOLD: 2,
  TIMEOUT: 60000,

  canAttemptConnection() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'HALF_OPEN') return true;
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.TIMEOUT) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        logger.info('Circuit breaker moved to HALF_OPEN state');
        return true;
      }
      return false;
    }
    return false;
  },

  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.SUCCESS_THRESHOLD) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        logger.info('Circuit breaker moved to CLOSED state (recovery)');
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  },

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      logger.warn(`Circuit breaker OPENED after ${this.failureCount} failures`);
    }
  }
};

// WebSocket connection management
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 10000;

// Connect to Poloniex WebSocket
const connectToPoloniexWebSocket = () => {
  if (!circuitBreaker.canAttemptConnection()) {
    logger.warn('Circuit breaker is OPEN - skipping WebSocket connection attempt');
    return null;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.warn(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
    circuitBreaker.recordFailure();
    return null;
  }

  logger.info(`Connecting to Poloniex WebSocket... (attempt ${reconnectAttempts + 1})`);

  const poloniexWs = new WebSocket('wss://ws.poloniex.com/ws/public', {
    handshakeTimeout: 10000,
    perMessageDeflate: false
  });

  let pingTimer;
  let pongTimer;

  poloniexWs.on('open', () => {
    logger.info('Connected to Poloniex WebSocket');
    reconnectAttempts = 0;
    circuitBreaker.recordSuccess();

    poloniexWs.send(JSON.stringify({
      event: 'subscribe',
      channel: ['ticker'],
      symbols: ['BTC_USDT', 'ETH_USDT', 'SOL_USDT']
    }));

    pingTimer = setInterval(() => {
      if (poloniexWs.readyState === WebSocket.OPEN) {
        poloniexWs.ping();
        pongTimer = setTimeout(() => {
          logger.warn('Poloniex WebSocket pong timeout');
          poloniexWs.terminate();
        }, PONG_TIMEOUT);
      }
    }, PING_INTERVAL);
  });

  poloniexWs.on('pong', () => {
    if (pongTimer) clearTimeout(pongTimer);
  });

  poloniexWs.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.channel === 'ticker' && message.data) {
        const tickerData = Array.isArray(message.data) ? message.data : [message.data];

        for (const ticker of tickerData) {
          const formattedData = formatPoloniexTickerData(ticker);
          if (formattedData) {
            // Cache market data in Redis
            await redisService.set(`market:${formattedData.pair}`, formattedData, 60);
            io.emit('marketData', formattedData);
          }
        }
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  poloniexWs.on('error', (error) => {
    logger.error('Poloniex WebSocket error:', error);
    reconnectAttempts++;
    circuitBreaker.recordFailure();

    setTimeout(() => {
      if (circuitBreaker.canAttemptConnection()) {
        connectToPoloniexWebSocket();
      }
    }, Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 30000));
  });

  poloniexWs.on('close', () => {
    logger.info('Poloniex WebSocket connection closed');
    reconnectAttempts++;
    circuitBreaker.recordFailure();

    setTimeout(() => {
      if (circuitBreaker.canAttemptConnection()) {
        connectToPoloniexWebSocket();
      }
    }, Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 30000));
  });

  return poloniexWs;
};

// Format ticker data
const formatPoloniexTickerData = (data) => {
  try {
    if (!data || !data.symbol) return null;
    const pair = data.symbol.replace('_', '-');
    return {
      pair,
      timestamp: Date.now(),
      open: parseFloat(data.open) || 0,
      high: parseFloat(data.high) || 0,
      low: parseFloat(data.low) || 0,
      close: parseFloat(data.close) || 0,
      volume: parseFloat(data.quantity) || 0
    };
  } catch (error) {
    logger.error('Error formatting ticker data:', error);
    return null;
  }
};

// Socket.IO connection handler
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('subscribeMarket', async ({ pair }) => {
    const rateCheck = await socketRateLimiter.check(socket.id, 'subscribeMarket');
    if (!rateCheck.allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    if (!pair || !/^[A-Z]{3,5}-[A-Z]{3,5}$/.test(pair)) {
      socket.emit('error', { message: 'Invalid pair format' });
      return;
    }

    socket.join(pair);
    logger.info(`Client ${socket.id} subscribed to ${pair}`);

    // Send cached data if available
    const cachedData = await redisService.get(`market:${pair}`);
    if (cachedData) {
      socket.emit('marketData', cachedData);
    }
  });

  socket.on('unsubscribeMarket', ({ pair }) => {
    socket.leave(pair);
    logger.info(`Client ${socket.id} unsubscribed from ${pair}`);
  });

  socket.on('chatMessage', async (message) => {
    const rateCheck = await socketRateLimiter.check(socket.id, 'chatMessage');
    if (!rateCheck.allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    if (!message || typeof message !== 'string' || message.length > 500) {
      socket.emit('error', { message: 'Invalid message format' });
      return;
    }

    const sanitizedMessage = message.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    io.emit('chatMessage', sanitizedMessage);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Enhanced health check with Redis
app.get('/api/health', async (req, res) => {
  try {
    const [dbHealth, redisHealth] = await Promise.all([
      healthCheck(),
      redisService.healthCheck()
    ]);

    res.json({
      status: dbHealth.healthy && redisHealth.healthy ? 'healthy' : 'degraded',
      mode: hasApiCredentials ? 'live' : 'mock',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
      database: {
        healthy: dbHealth.healthy,
        postgis_version: dbHealth.postgis_version,
        pool_size: dbHealth.pool_size,
        idle_connections: dbHealth.idle_connections,
        waiting_connections: dbHealth.waiting_connections
      },
      redis: redisHealth,
      websocket: {
        circuitBreakerState: circuitBreaker.state,
        reconnectAttempts: reconnectAttempts,
        failureCount: circuitBreaker.failureCount
      }
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      mode: hasApiCredentials ? 'live' : 'mock',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
      error: error.message
    });
  }
});

// Cache market data endpoint
app.get('/api/market/:pair', async (req, res) => {
  try {
    const { pair } = req.params;
    const data = await redisService.get(`market:${pair}`);

    if (data) {
      res.json({ ...data, cached: true });
    } else {
      res.status(404).json({ error: 'Market data not found' });
    }
  } catch (error) {
    logger.error('Market data fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

// Account endpoint with caching
app.get('/api/account', optionalAuth, async (req, res) => {
  try {
    if (!hasApiCredentials) {
      const mockData = {
        mock: true,
        balances: {
          USDT: { available: '10000.00', locked: '0.00' },
          BTC: { available: '0.5', locked: '0.00' },
        }
      };

      if (req.user) {
        mockData.user = req.user.username;
        mockData.authenticated = true;
      }

      res.json(mockData);
    } else {
      const accountData = await redisService.cacheGet(
        'account:live',
        () => ({ message: 'Live mode active - implement Poloniex API call' }),
        300
      );

      if (req.user) {
        accountData.user = req.user.username;
        accountData.authenticated = true;
      }

      res.json(accountData);
    }
  } catch (error) {
    logger.error('Account fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch account data' });
  }
});

// Standard health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'poloniex-trading-platform-backend'
  });
});

// Catch-all route
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, async () => {
  logger.info(`🚀 Server running on http://${HOST}:${PORT}`);

  // Test Redis connection on startup
  try {
    await redisService.healthCheck();
    logger.info('✅ Redis connection verified');
  } catch (error) {
    logger.error('❌ Redis connection failed:', error);
  }

  // Initialize futures services for automated trading
  if (hasApiCredentials) {
    try {
      logger.info('🚀 Initializing automated futures trading services...');
      
      // Initialize futures WebSocket connection
      futuresWebSocket.connect();
      
      // Start automated trading service
      await automatedTradingService.initialize();
      
      logger.info('✅ Automated futures trading services initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize futures services:', error);
    }
  } else {
    logger.info('🧪 Running in mock mode - futures services disabled');
  }

  // Initialize backtesting engine WebSocket events
  try {
    logger.info('🔬 Initializing backtesting engine...');
    
    // Listen for backtest progress updates
    backtestingEngine.on('backtestProgress', (data) => {
      io.emit('backtestProgress', data);
    });
    
    // Listen for backtest completion
    backtestingEngine.on('backtestComplete', (data) => {
      io.emit('backtestComplete', data);
    });
    
    // Listen for backtest errors
    backtestingEngine.on('backtestError', (data) => {
      io.emit('backtestError', data);
    });
    
    logger.info('✅ Backtesting engine initialized with WebSocket events');
  } catch (error) {
    logger.error('❌ Failed to initialize backtesting engine:', error);
  }

  // Initialize paper trading service
  try {
    logger.info('📝 Initializing paper trading service...');
    
    // Initialize paper trading service
    await paperTradingService.initialize();
    
    // Listen for paper trading events
    paperTradingService.on('sessionCreated', (data) => {
      io.emit('sessionCreated', data);
    });
    
    paperTradingService.on('sessionStarted', (data) => {
      io.emit('sessionStarted', data);
    });
    
    paperTradingService.on('sessionStopped', (data) => {
      io.emit('sessionStopped', data);
    });
    
    paperTradingService.on('sessionUpdate', (data) => {
      io.emit('sessionUpdate', data);
    });
    
    paperTradingService.on('positionOpened', (data) => {
      io.emit('positionOpened', data);
    });
    
    paperTradingService.on('positionClosed', (data) => {
      io.emit('positionClosed', data);
    });
    
    logger.info('✅ Paper trading service initialized with WebSocket events');
  } catch (error) {
    logger.error('❌ Failed to initialize paper trading service:', error);
  }

  // Initialize confidence scoring service
  try {
    logger.info('🎯 Initializing confidence scoring service...');
    
    // Initialize confidence scoring service
    await confidenceScoringService.initialize();
    
    // Listen for confidence scoring events
    confidenceScoringService.on('confidenceScoreCalculated', (data) => {
      io.emit('confidenceScoreCalculated', data);
    });
    
    confidenceScoringService.on('marketConditionsUpdated', (data) => {
      io.emit('marketConditionsUpdated', data);
    });
    
    confidenceScoringService.on('riskAssessmentAlert', (data) => {
      io.emit('riskAssessmentAlert', data);
    });
    
    logger.info('✅ Confidence scoring service initialized with WebSocket events');
  } catch (error) {
    logger.error('❌ Failed to initialize confidence scoring service:', error);
  }

  // Initialize autonomous trading system
  try {
    logger.info('🧠 Initializing autonomous trading system...');
    
    // Initialize profit banking service
    await profitBankingService.initialize();
    
    // Initialize autonomous strategy generator
    await autonomousStrategyGenerator.initialize();
    
    // Listen for autonomous trading events
    autonomousStrategyGenerator.on('generationComplete', (data) => {
      io.emit('generationComplete', data);
    });
    
    autonomousStrategyGenerator.on('strategyCreated', (data) => {
      io.emit('strategyCreated', data);
    });
    
    profitBankingService.on('profitBanked', (data) => {
      io.emit('profitBanked', data);
    });
    
    profitBankingService.on('bankingFailed', (data) => {
      io.emit('bankingFailed', data);
    });
    
    profitBankingService.on('emergencyStop', (data) => {
      io.emit('emergencyStop', data);
    });
    
    strategyOptimizer.on('backtestCompleted', (data) => {
      io.emit('backtestCompleted', data);
    });
    
    strategyOptimizer.on('paperTradingStarted', (data) => {
      io.emit('paperTradingStarted', data);
    });
    
    strategyOptimizer.on('livePromotionCompleted', (data) => {
      io.emit('livePromotionCompleted', data);
    });
    
    strategyOptimizer.on('strategyRetired', (data) => {
      io.emit('strategyRetired', data);
    });
    
    logger.info('✅ Autonomous trading system initialized with WebSocket events');
  } catch (error) {
    logger.error('❌ Failed to initialize autonomous trading system:', error);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');

  try {
    // Stop autonomous trading system
    await autonomousStrategyGenerator.stop();
    await profitBankingService.shutdown();
    logger.info('✅ Autonomous trading system stopped');
  } catch (error) {
    logger.error('❌ Error stopping autonomous trading system:', error);
  }

  try {
    await redisService.disconnect();
    logger.info('✅ Redis disconnected');
  } catch (error) {
    logger.error('❌ Error disconnecting Redis:', error);
  }

  server.close(() => {
    logger.info('✅ Server shut down');
    process.exit(0);
  });
});
