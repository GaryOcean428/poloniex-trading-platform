import express from 'express';
import poloniexSpotService from '../services/poloniexSpotService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Market data endpoints are public (no authentication required)

/**
 * Get 24h ticker for a symbol
 * GET /api/market/ticker/:symbol
 */
router.get('/ticker/:symbol', async (req, res) => {
  try {
    const result = await poloniexSpotService.getTicker24h(req.params.symbol);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching ticker:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get all tickers
 * GET /api/market/ticker
 */
router.get('/ticker', async (req, res) => {
  try {
    const result = await poloniexSpotService.getAllTickers();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching all tickers:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get price for a symbol
 * GET /api/market/price/:symbol
 */
router.get('/price/:symbol', async (req, res) => {
  try {
    const result = await poloniexSpotService.getPrice(req.params.symbol);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching price:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get all prices
 * GET /api/market/price
 */
router.get('/price', async (req, res) => {
  try {
    const result = await poloniexSpotService.getAllPrices();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching all prices:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get order book for a symbol
 * GET /api/market/orderbook/:symbol
 */
router.get('/orderbook/:symbol', async (req, res) => {
  try {
    const result = await poloniexSpotService.getOrderBook(req.params.symbol, req.query);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching order book:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get recent trades for a symbol
 * GET /api/market/trades/:symbol
 */
router.get('/trades/:symbol', async (req, res) => {
  try {
    const result = await poloniexSpotService.getRecentTrades(req.params.symbol, req.query);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching recent trades:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get candles for a symbol
 * GET /api/market/candles/:symbol
 */
router.get('/candles/:symbol', async (req, res) => {
  try {
    const result = await poloniexSpotService.getCandles(req.params.symbol, req.query as any);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    logger.error('Error fetching candles:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get symbol information
 * GET /api/market/symbols/:symbol
 */
router.get('/symbols/:symbol', async (req, res) => {
  try {
    const result = await poloniexSpotService.getSymbolInfo(req.params.symbol);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching symbol info:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get all symbols
 * GET /api/market/symbols
 */
router.get('/symbols', async (req, res) => {
  try {
    const result = await poloniexSpotService.getAllSymbols();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching all symbols:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get currency information
 * GET /api/market/currencies/:currency
 */
router.get('/currencies/:currency', async (req, res) => {
  try {
    const result = await poloniexSpotService.getCurrencyInfo(req.params.currency);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching currency info:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get all currencies
 * GET /api/market/currencies
 */
router.get('/currencies', async (req, res) => {
  try {
    const result = await poloniexSpotService.getAllCurrencies();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching all currencies:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get system timestamp
 * GET /api/market/timestamp
 */
router.get('/timestamp', async (req, res) => {
  try {
    const result = await poloniexSpotService.getTimestamp();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching timestamp:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
