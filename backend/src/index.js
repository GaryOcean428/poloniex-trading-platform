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

// Configure environment variables
dotenv.config();

// ES module path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-eval'"], // Required for React dev
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allows cross-origin resources
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// More restrictive CORS configuration
const allowedOrigins = [
  'https://healthcheck.railway.app',
  process.env.FRONTEND_URL || 'http://localhost:5173',
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173'])
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '10mb' })); // Limit request size

// Create HTTP server
const server = http.createServer(app);

// Set up Socket.IO with security
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Connect to Poloniex WebSocket for live market data
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 30000; // 30 seconds (increased from 25)
const PONG_TIMEOUT = 10000; // 10 seconds (decreased from 60)

const connectToPoloniexWebSocket = () => {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping reconnection.`);
    return null;
  }

  console.log(`Connecting to Poloniex WebSocket... (attempt ${reconnectAttempts + 1})`);
  
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
    
    // Calculate exponential backoff delay
    const backoffDelay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
    console.log(`Attempting to reconnect in ${backoffDelay}ms (attempt ${reconnectAttempts})`);
    
    // Attempt to reconnect after a delay
    setTimeout(connectToPoloniexWebSocket, backoffDelay);
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
    
    // Calculate exponential backoff delay
    const backoffDelay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
    console.log(`Connection closed, attempting to reconnect in ${backoffDelay}ms (attempt ${reconnectAttempts})`);
    
    // Attempt to reconnect after a delay
    setTimeout(connectToPoloniexWebSocket, backoffDelay);
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

// Define API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'up', timestamp: new Date() });
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

// Serve static files from frontend build
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

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