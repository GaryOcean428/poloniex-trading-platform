import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import authRoutes from './routes/auth.js';
import { authenticateToken, optionalAuth } from './middleware/auth.js';

// Configure environment variables
dotenv.config();

// Add startup logging for debugging
console.log('\n🚀 POLYTRADE BACKEND STARTUP\n');
console.log('='.repeat(50));

// Check critical environment variables
const envCheck = {
  // Backend should use NON-VITE variables
  POLONIEX_API_KEY: process.env.POLONIEX_API_KEY,
  POLONIEX_API_SECRET: process.env.POLONIEX_API_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  JWT_SECRET: process.env.JWT_SECRET || process.env.JWT_SECRT, // Handle typo
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV,
  FRONTEND_URL: process.env.FRONTEND_URL,
};

// Display configuration
console.log('📋 Configuration Status:');
Object.entries(envCheck).forEach(([key, value]) => {
  if (key.includes('SECRET') || key.includes('URL')) {
    console.log(`${key}: ${value ? '✅ SET' : '❌ NOT SET'}`);
  } else {
    console.log(`${key}: ${value || '❌ NOT SET'}`);
  }
});

// Check if we're in mock mode
const hasApiCredentials = !!(
  envCheck.POLONIEX_API_KEY && 
  envCheck.POLONIEX_API_SECRET
);

console.log('\nTrading Mode:', hasApiCredentials ? '✅ LIVE' : '🧪 MOCK');
console.log('='.repeat(50));

// ES module path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      scriptSrc: ["'self'", "'unsafe-eval'"], // Required for React dev
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allows cross-origin resources
}));

// More restrictive CORS configuration
const allowedOrigins = [
  'https://healthcheck.railway.app',
  'https://poloniex-trading-platform-production.up.railway.app',
  'https://polytrade-red.vercel.app',
  'https://polytrade-be.up.railway.app', // Railway backend URL for API calls
  process.env.FRONTEND_URL || 'http://localhost:5173',
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173'])
];

// Debug: Log allowed origins in production
if (process.env.NODE_ENV === 'production') {
  console.log('🔒 CORS Configuration (Production):');
  console.log('Allowed Origins:', allowedOrigins);
}

// CORS middleware configuration
const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🚫 CORS blocked request from origin: ${origin}`);
      console.warn('🔒 Allowed origins:', allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true, // Trust Railway's proxy
});

app.use(express.json({ limit: '10mb' })); // Limit request size

// Serve static files from frontend build (before API routes)
const frontendDistPath = path.join(__dirname, '../public');
app.use(express.static(frontendDistPath));

// Apply CORS and rate limiting only to API routes
app.use('/api/', corsMiddleware, limiter);

// Mount auth routes
app.use('/api/auth', authRoutes);

// Create HTTP server
const server = http.createServer(app);

// Set up Socket.IO with security
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 120000, // 2 minutes (increased from 60s to prevent Railway proxy timeouts)
  pingInterval: 25000
});

// Circuit breaker for WebSocket connections
const circuitBreaker = {
  state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
  failureCount: 0,
  lastFailureTime: null,
  successCount: 0,
  
  // Circuit breaker thresholds
  FAILURE_THRESHOLD: 3,
  SUCCESS_THRESHOLD: 2,
  TIMEOUT: 60000, // 1 minute timeout for OPEN state
  
  canAttemptConnection() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'HALF_OPEN') return true;
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.TIMEOUT) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log('Circuit breaker moved to HALF_OPEN state');
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
        console.log('Circuit breaker moved to CLOSED state (recovery)');
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
      console.log(`Circuit breaker OPENED after ${this.failureCount} failures`);
    }
  }
};

// Connect to Poloniex WebSocket for live market data
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 30000; // 30 seconds (increased from 25)
const PONG_TIMEOUT = 10000; // 10 seconds (decreased from 60)

const connectToPoloniexWebSocket = () => {
  // Check circuit breaker before attempting connection
  if (!circuitBreaker.canAttemptConnection()) {
    console.log('Circuit breaker is OPEN - skipping WebSocket connection attempt');
    return null;
  }
  
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping reconnection.`);
    circuitBreaker.recordFailure();
    return null;
  }

  console.log(`Connecting to Poloniex WebSocket... (attempt ${reconnectAttempts + 1}, circuit breaker: ${circuitBreaker.state})`);
  
  // Create WebSocket connection to Poloniex with timeout
  const poloniexWs = new WebSocket('wss://ws.poloniex.com/ws/public', {
    handshakeTimeout: 10000,
    perMessageDeflate: false
  });
  
  let pingTimer;
  let pongTimer;
  
  poloniexWs.on('open', () => {
    console.log('Connected to Poloniex WebSocket');
    
    // Reset reconnect attempts on successful connection
    reconnectAttempts = 0;
    
    // Record successful connection in circuit breaker
    circuitBreaker.recordSuccess();
    
    // Subscribe to market data channels
    poloniexWs.send(JSON.stringify({
      event: 'subscribe',
      channel: ['ticker'],
      symbols: ['BTC_USDT', 'ETH_USDT', 'SOL_USDT']
    }));
    
    // Start ping timer for connection health
    pingTimer = setInterval(() => {
      if (poloniexWs.readyState === WebSocket.OPEN) {
        poloniexWs.ping();
        
        // Set timeout for pong response
        pongTimer = setTimeout(() => {
          console.warn('Poloniex WebSocket pong timeout - closing connection');
          poloniexWs.terminate();
        }, PONG_TIMEOUT);
      }
    }, PING_INTERVAL);
  });
  
  poloniexWs.on('pong', () => {
    // Clear pong timeout when response received
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
  });
  
  poloniexWs.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Process different types of messages
      if (message.channel === 'ticker' && message.data) {
        // message.data is an array of ticker objects
        if (Array.isArray(message.data)) {
          message.data.forEach(tickerData => {
            const formattedData = formatPoloniexTickerData(tickerData);
            if (formattedData) {
              // Broadcast to all connected clients
              io.emit('marketData', formattedData);
            }
          });
        } else {
          // Fallback for single ticker object
          const formattedData = formatPoloniexTickerData(message.data);
          if (formattedData) {
            io.emit('marketData', formattedData);
          }
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });
  
  poloniexWs.on('error', (error) => {
    console.error('Poloniex WebSocket error:', error);
    
    // Clean up timers
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
    
    reconnectAttempts++;
    
    // Record failure in circuit breaker
    circuitBreaker.recordFailure();
    
    // Only attempt reconnection if circuit breaker allows it
    if (circuitBreaker.canAttemptConnection()) {
      // Calculate exponential backoff delay
      const backoffDelay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
      console.log(`Attempting to reconnect in ${backoffDelay}ms (attempt ${reconnectAttempts})`);
      
      // Attempt to reconnect after a delay
      setTimeout(connectToPoloniexWebSocket, backoffDelay);
    } else {
      console.log('Circuit breaker preventing reconnection attempt');
    }
  });
  
  poloniexWs.on('close', () => {
    console.log('Poloniex WebSocket connection closed');
    
    // Clean up timers
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
    
    reconnectAttempts++;
    
    // Record failure in circuit breaker
    circuitBreaker.recordFailure();
    
    // Only attempt reconnection if circuit breaker allows it
    if (circuitBreaker.canAttemptConnection()) {
      // Calculate exponential backoff delay
      const backoffDelay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
      console.log(`Connection closed, attempting to reconnect in ${backoffDelay}ms (attempt ${reconnectAttempts})`);
      
      // Attempt to reconnect after a delay
      setTimeout(connectToPoloniexWebSocket, backoffDelay);
    } else {
      console.log('Circuit breaker preventing reconnection attempt');
    }
  });
  
  return poloniexWs;
};

// Format Poloniex ticker data to match our app's data structure
const formatPoloniexTickerData = (data) => {
  try {
    // Validate incoming data structure
    if (!data || !data.symbol) {
      console.warn('Invalid ticker data received:', data);
      return null;
    }

    // Convert Poloniex pair format (BTC_USDT) to our format (BTC-USDT)
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
    console.error('Error formatting ticker data:', error);
    return null;
  }
};

// Socket.IO connection handler with security
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Rate limiting for socket events
  const socketRateLimit = new Map();
  
  const isRateLimited = (eventType) => {
    const now = Date.now();
    const key = `${socket.id}:${eventType}`;
    const limit = socketRateLimit.get(key) || { count: 0, resetTime: now + 60000 };
    
    if (now > limit.resetTime) {
      limit.count = 0;
      limit.resetTime = now + 60000;
    }
    
    if (limit.count >= 30) { // 30 events per minute
      return true;
    }
    
    limit.count++;
    socketRateLimit.set(key, limit);
    return false;
  };
  
  // Handle client subscription to market data
  socket.on('subscribeMarket', ({ pair }) => {
    if (isRateLimited('subscribeMarket')) {
      socket.emit('error', 'Rate limit exceeded for subscribeMarket');
      return;
    }
    
    // Validate pair format
    if (!pair || !/^[A-Z]{3,5}-[A-Z]{3,5}$/.test(pair)) {
      socket.emit('error', 'Invalid pair format');
      return;
    }
    
    console.log(`Client ${socket.id} subscribed to ${pair}`);
    socket.join(pair);
  });
  
  // Handle client unsubscription from market data
  socket.on('unsubscribeMarket', ({ pair }) => {
    if (isRateLimited('unsubscribeMarket')) {
      socket.emit('error', 'Rate limit exceeded for unsubscribeMarket');
      return;
    }
    
    console.log(`Client ${socket.id} unsubscribed from ${pair}`);
    socket.leave(pair);
  });
  
  // Handle chat messages with validation
  socket.on('chatMessage', (message) => {
    if (isRateLimited('chatMessage')) {
      socket.emit('error', 'Rate limit exceeded for chatMessage');
      return;
    }
    
    // Validate message
    if (!message || typeof message !== 'string' || message.length > 500) {
      socket.emit('error', 'Invalid message format');
      return;
    }
    
    // Sanitize message (basic XSS prevention)
    const sanitizedMessage = message.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    console.log('Chat message received:', sanitizedMessage);
    // Broadcast to all clients
    io.emit('chatMessage', sanitizedMessage);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    socketRateLimit.delete(socket.id);
  });
});

// Start Poloniex WebSocket connection
const poloniexWs = connectToPoloniexWebSocket();

// Periodic circuit breaker check and recovery
setInterval(() => {
  if (circuitBreaker.state === 'OPEN') {
    const timeSinceLastFailure = Date.now() - circuitBreaker.lastFailureTime;
    if (timeSinceLastFailure >= circuitBreaker.TIMEOUT) {
      console.log('Circuit breaker timeout reached, attempting recovery');
      circuitBreaker.state = 'HALF_OPEN';
      circuitBreaker.successCount = 0;
      // Only attempt reconnection if we haven't exceeded max attempts
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(connectToPoloniexWebSocket, 1000);
      }
    }
  }
}, 30000); // Check every 30 seconds

// Define API routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    mode: hasApiCredentials ? 'live' : 'mock',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    websocket: {
      circuitBreakerState: circuitBreaker.state,
      reconnectAttempts: reconnectAttempts,
      failureCount: circuitBreaker.failureCount
    }
  });
});

// Mock API endpoint for testing - now with optional authentication
app.get('/api/account', optionalAuth, (req, res) => {
  if (!hasApiCredentials) {
    // Return mock data with user context if authenticated
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
    // TODO: Implement real Poloniex API call
    const response = {
      message: 'Live mode active - implement Poloniex API call'
    };
    
    if (req.user) {
      response.user = req.user.username;
      response.authenticated = true;
    }
    
    res.json(response);
  }
});

// Standard health endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'poloniex-trading-platform-backend'
  });
});

// Catch-all route for client-side routing (must be last)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  
  // Close Poloniex WebSocket
  if (poloniexWs && poloniexWs.readyState === WebSocket.OPEN) {
    poloniexWs.close();
  }
  
  // Close HTTP server
  server.close(() => {
    console.log('Server shut down');
    process.exit(0);
  });
});