import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// Configure environment variables
dotenv.config();

// ES module path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();
app.use(cors({
  origin: [
    '*',
    'https://healthcheck.railway.app',
    process.env.FRONTEND_URL || 'http://localhost:5173'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Set up Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Connect to Poloniex WebSocket for live market data
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;

const connectToPoloniexWebSocket = () => {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping reconnection.`);
    return null;
  }

  console.log(`Connecting to Poloniex WebSocket... (attempt ${reconnectAttempts + 1})`);
  
  // Create WebSocket connection to Poloniex
  const poloniexWs = new WebSocket('wss://ws.poloniex.com/ws/public');
  
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
    reconnectAttempts++;
    // Attempt to reconnect after a delay
    setTimeout(connectToPoloniexWebSocket, RECONNECT_DELAY);
  });
  
  poloniexWs.on('close', () => {
    console.log('Poloniex WebSocket connection closed');
    reconnectAttempts++;
    // Attempt to reconnect after a delay
    setTimeout(connectToPoloniexWebSocket, RECONNECT_DELAY);
  });
  
  // Keep-alive ping
  setInterval(() => {
    if (poloniexWs.readyState === WebSocket.OPEN) {
      poloniexWs.ping();
    }
  }, 30000);
  
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

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Handle client subscription to market data
  socket.on('subscribeMarket', ({ pair }) => {
    console.log(`Client ${socket.id} subscribed to ${pair}`);
    socket.join(pair);
  });
  
  // Handle client unsubscription from market data
  socket.on('unsubscribeMarket', ({ pair }) => {
    console.log(`Client ${socket.id} unsubscribed from ${pair}`);
    socket.leave(pair);
  });
  
  // Handle chat messages
  socket.on('chatMessage', (message) => {
    console.log('Chat message received:', message);
    // Broadcast to all clients
    io.emit('chatMessage', message);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
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