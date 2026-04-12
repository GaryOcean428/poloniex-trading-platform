/**
 * ML Prediction Service
 * Routes ML inference to the ml-worker service (Python) via HTTP or Redis pub/sub.
 * Falls back to simpleMlService when ml-worker is unreachable.
 *
 * Architecture:
 *   polytrade-be (Node.js) --HTTP--> ml-worker (Python/FastAPI)
 *                          --Redis pub/sub (fallback)--> ml-worker
 *                          --simpleMlService (final fallback)
 */

import { createClient } from 'redis';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

const _rawMlWorkerUrl = process.env.ML_WORKER_URL || '';
let ML_WORKER_URL = '';
if (_rawMlWorkerUrl) {
  try {
    new URL(_rawMlWorkerUrl);
    ML_WORKER_URL = _rawMlWorkerUrl;
  } catch {
    logger.error(`ML_WORKER_URL is not a valid URL: "${_rawMlWorkerUrl}" — ML worker HTTP disabled, will use simple ML fallback`);
  }
}
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || '';

const PREDICT_REQUEST_CHANNEL = 'ml:predict:request';
const PREDICT_RESPONSE_PREFIX = 'ml:predict:response:';
const HEALTH_CHANNEL = 'ml:health';

/** How long (ms) to wait for a response before giving up */
const REQUEST_TIMEOUT_MS = 5000;
/** How long (ms) a Redis heartbeat is considered fresh */
const HEARTBEAT_STALE_MS = 90_000;
const ML_WORKER_NOT_CONFIGURED_CODE = 'ML_WORKER_NOT_CONFIGURED';

class MLPredictionService {
  constructor() {
    /** Cached timestamp of the last observed ml-worker heartbeat */
    this._lastHeartbeatAt = 0;
    /** Dedicated subscriber client for response channels */
    this._subscriber = null;
    /** Whether the subscriber is currently connected */
    this._subscriberConnected = false;
    /** Publisher/command client (shared) */
    this._publisher = null;
    /** Whether missing ML worker transport config has been logged */
    this._missingTransportLogged = false;
  }

  // ---------------------------------------------------------------------------
  // Redis helpers
  // ---------------------------------------------------------------------------

  async _getPublisher() {
    if (this._publisher) return this._publisher;
    if (!REDIS_URL) return null;
    try {
      this._publisher = createClient({ url: REDIS_URL });
      this._publisher.on('error', (err) => {
        logger.error('ML Redis publisher error:', err);
      });
      await this._publisher.connect();
      return this._publisher;
    } catch (err) {
      logger.warn('ML Redis publisher connection failed:', err.message);
      this._publisher = null;
      return null;
    }
  }

  async _getSubscriber() {
    if (this._subscriber && this._subscriberConnected) return this._subscriber;
    if (!REDIS_URL) return null;
    try {
      this._subscriber = createClient({ url: REDIS_URL });
      this._subscriber.on('error', (err) => {
        logger.error('ML Redis subscriber error:', err);
        this._subscriberConnected = false;
      });
      this._subscriber.on('connect', () => {
        this._subscriberConnected = true;
      });
      await this._subscriber.connect();
      this._subscriberConnected = true;
      return this._subscriber;
    } catch (err) {
      logger.warn('ML Redis subscriber connection failed:', err.message);
      this._subscriber = null;
      this._subscriberConnected = false;
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Health / availability checks
  // ---------------------------------------------------------------------------

  /** Returns true if the ml-worker heartbeat in Redis is fresh */
  async _isWorkerAlive() {
    try {
      const pub = await this._getPublisher();
      if (!pub) return false;
      const raw = await pub.get(HEALTH_CHANNEL);
      if (!raw) return false;
      const hb = JSON.parse(raw);
      if (hb?.status === 'ok') {
        this._lastHeartbeatAt = Date.now();
        return true;
      }
    } catch {
      // ignore
    }
    return Date.now() - this._lastHeartbeatAt < HEARTBEAT_STALE_MS;
  }

  // ---------------------------------------------------------------------------
  // Transport layer: HTTP to ml-worker
  // ---------------------------------------------------------------------------

  async _callWorkerHTTP(payload) {
    if (!ML_WORKER_URL) {
      throw new Error('ML_WORKER_URL not configured');
    }
    const url = `${ML_WORKER_URL.replace(/\/$/, '')}/ml/predict`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`ml-worker HTTP ${resp.status}: ${text}`);
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Transport layer: Redis pub/sub to ml-worker
  // ---------------------------------------------------------------------------

  async _callWorkerRedis(payload) {
    const pub = await this._getPublisher();
    const sub = await this._getSubscriber();
    if (!pub || !sub) {
      throw new Error('Redis not available for ML pub/sub');
    }

    const requestId = randomUUID();
    const responseChannel = `${PREDICT_RESPONSE_PREFIX}${requestId}`;

    return new Promise((resolve, reject) => {
      let settled = false;

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      const timeout = setTimeout(() => {
        sub.unsubscribe(responseChannel).catch(err => {
          logger.warn('Redis unsubscribe failed on timeout:', err);
        });
        settle(reject, new Error(`ML worker Redis timeout after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      const onMessage = (message) => {
        clearTimeout(timeout);
        sub.unsubscribe(responseChannel).catch(err => {
          logger.warn('Redis unsubscribe failed on message:', err);
        });
        try {
          const result = JSON.parse(message);
          if (result.status === 'error') {
            settle(reject, new Error(result.error || 'ML worker returned error'));
          } else {
            settle(resolve, result);
          }
        } catch (err) {
          settle(reject, new Error(`Failed to parse ML worker response: ${err.message}`));
        }
      };

      sub.subscribe(responseChannel, onMessage).then(() => {
        pub.publish(PREDICT_REQUEST_CHANNEL, JSON.stringify({ ...payload, requestId })).catch((err) => {
          clearTimeout(timeout);
          sub.unsubscribe(responseChannel).catch(err => {
            logger.warn('Redis unsubscribe failed on publish error:', err);
          });
          settle(reject, new Error(`Failed to publish ML predict request: ${err.message}`));
        });
      }).catch((err) => {
        clearTimeout(timeout);
        settle(reject, new Error(`Failed to subscribe ML response channel: ${err.message}`));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Unified call: HTTP first, Redis fallback
  // ---------------------------------------------------------------------------

  async _callWorker(payload) {
    // Try HTTP first (preferred, lower overhead)
    if (ML_WORKER_URL) {
      try {
        return await this._callWorkerHTTP(payload);
      } catch (httpErr) {
        logger.warn(`ML worker HTTP failed (${httpErr.message}), trying Redis pub/sub`);
      }
    }

    // Redis pub/sub fallback
    if (REDIS_URL) {
      try {
        return await this._callWorkerRedis(payload);
      } catch (redisErr) {
        throw new Error(`ML worker unavailable via HTTP and Redis: ${redisErr.message}`);
      }
    }

    if (!this._missingTransportLogged) {
      this._missingTransportLogged = true;
      logger.warn('ML worker transport is not configured; using simple ML fallback paths');
    }

    const missingTransportError = new Error('ML worker unreachable: neither ML_WORKER_URL nor REDIS_URL is configured');
    missingTransportError.code = ML_WORKER_NOT_CONFIGURED_CODE;
    throw missingTransportError;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get ML prediction for a trading pair
   * @param {string} symbol - Trading pair symbol (e.g., 'BTCUSDTPERP')
   * @param {Array} ohlcvData - Historical OHLCV data
   * @param {string} horizon - Prediction horizon ('1h', '4h', '24h')
   * @returns {Promise<Object>} Prediction results
   */
  async getPrediction(symbol, ohlcvData, horizon = '1h') {
    try {
      const result = await this._callWorker({ action: 'predict', symbol, data: ohlcvData, horizon });
      logger.info(`ML prediction for ${symbol} (${horizon}):`, {
        prediction: result.prediction,
        confidence: result.confidence,
        signal: result.signal,
      });
      return result;
    } catch (error) {
      if (error?.code === ML_WORKER_NOT_CONFIGURED_CODE) {
        throw error;
      }
      logger.error(`ML prediction failed for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get trading signal from ML ensemble
   * @param {string} symbol - Trading pair symbol
   * @param {Array} ohlcvData - Historical OHLCV data
   * @param {number} currentPrice - Current market price
   * @returns {Promise<Object>} Trading signal with strength and reasoning
   */
  async getTradingSignal(symbol, ohlcvData, currentPrice) {
    try {
      const result = await this._callWorker({ action: 'signal', symbol, data: ohlcvData, current_price: currentPrice });
      logger.info(`ML trading signal for ${symbol}:`, {
        signal: result.signal,
        strength: result.strength,
        reason: result.reason,
      });
      return result;
    } catch (error) {
      if (error?.code !== ML_WORKER_NOT_CONFIGURED_CODE) {
        logger.error(`ML signal generation failed for ${symbol}:`, error);
      }
      return { signal: 'HOLD', strength: 0, reason: `ML prediction error: ${error.message}`, error: true };
    }
  }

  /**
   * Train ML models on historical data
   * @param {string} symbol - Trading pair symbol
   * @param {Array} historicalData - Historical OHLCV data for training
   * @returns {Promise<Object>} Training results
   */
  async trainModels(symbol, historicalData) {
    try {
      const result = await this._callWorker({ action: 'train', symbol, data: historicalData });
      logger.info(`ML models trained for ${symbol}:`, result);
      return result;
    } catch (error) {
      if (error?.code === ML_WORKER_NOT_CONFIGURED_CODE) {
        throw error;
      }
      logger.error(`ML training failed for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get multi-horizon predictions
   * @param {string} symbol - Trading pair symbol
   * @param {Array} ohlcvData - Historical OHLCV data
   * @returns {Promise<Object>} Predictions for 1h, 4h, and 24h horizons
   */
  async getMultiHorizonPredictions(symbol, ohlcvData) {
    try {
      const result = await this._callWorker({ action: 'multi_horizon', symbol, data: ohlcvData });
      return result;
    } catch (error) {
      if (error?.code === ML_WORKER_NOT_CONFIGURED_CODE) {
        throw error;
      }
      logger.error(`Multi-horizon prediction failed for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Check if ML worker service is available.
   * Checks Redis heartbeat first, then falls back to an HTTP health probe.
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    // Check Redis heartbeat (set by the ml-worker every 30 s)
    try {
      if (await this._isWorkerAlive()) return true;
    } catch {
      // ignore
    }

    // Fallback: try HTTP /health endpoint
    if (ML_WORKER_URL) {
      try {
        const url = `${ML_WORKER_URL.replace(/\/$/, '')}/health`;
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(url, { signal: controller.signal });
        if (resp.ok) {
          this._lastHeartbeatAt = Date.now();
          return true;
        }
      } catch {
        // ignore
      }
    }

    return false;
  }
}

export default new MLPredictionService();
