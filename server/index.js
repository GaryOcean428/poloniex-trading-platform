import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import WebSocket from 'ws';

// Configure environment variables
dotenv.config();

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
const connectToPoloniexWebSocket = () => {
  console.log('Connecting to Poloniex WebSocket...');
  
  // Create WebSocket connection to Poloniex
  const poloniexWs = new WebSocket('wss://ws.poloniex.com/ws/public');
  
  poloniexWs.on('open', () => {
    console.log('Connected to Poloniex WebSocket');
    
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
        // Format the data for our clients
        const formattedData = formatPoloniexTickerData(message.data);
        
        // Broadcast to all connected clients
        io.emit('marketData', formattedData);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });
  
  poloniexWs.on('error', (error) => {
    console.error('Poloniex WebSocket error:', error);
    // Attempt to reconnect after a delay
    setTimeout(connectToPoloniexWebSocket, 5000);
  });
  
  poloniexWs.on('close', () => {
    console.log('Poloniex WebSocket connection closed');
    // Attempt to reconnect after a delay
    setTimeout(connectToPoloniexWebSocket, 5000);
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
  // Convert Poloniex pair format (BTC_USDT) to our format (BTC-USDT)
  const pair = data.symbol.replace('_', '-');
  
  return {
    pair,
    timestamp: Date.now(),
    open: parseFloat(data.open),
    high: parseFloat(data.high),
    low: parseFloat(data.low),
    close: parseFloat(data.close),
    volume: parseFloat(data.quantity)
  };
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

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
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