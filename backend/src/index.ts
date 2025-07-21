import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routes
import authRoutes from './routes/auth.js';
import apiKeyRoutes from './routes/apiKeys.js';
import futuresRoutes from './routes/futures.js';
import backtestingRoutes from './routes/backtesting.js';
import paperTradingRoutes from './routes/paperTrading.js';
import autonomousTradingRoutes from './routes/autonomousTrading.js';
import confidenceScoringRoutes from './routes/confidenceScoring.js';

// Import services
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/futures', futuresRoutes);
app.use('/api/backtesting', backtestingRoutes);
app.use('/api/paper-trading', paperTradingRoutes);
app.use('/api/autonomous-trading', autonomousTradingRoutes);
app.use('/api/confidence-scoring', confidenceScoringRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  // Serve frontend static files
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));

  // Serve index.html for all other routes (SPA support)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
