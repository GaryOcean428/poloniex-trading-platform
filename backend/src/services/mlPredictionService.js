/**
 * ML Prediction Service
 * Integrates ensemble ML predictions with the autonomous trading agent
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MLPredictionService {
  constructor() {
    this.pythonPath = 'python3.11';
    this.scriptPath = path.join(__dirname, '../ml/predict.py');
    this.modelsPath = path.join(__dirname, '../ml/saved_models');
  }

  /**
   * Get ML prediction for a trading pair
   * @param {string} symbol - Trading pair symbol (e.g., 'BTCUSDTPERP')
   * @param {Array} ohlcvData - Historical OHLCV data
   * @param {string} horizon - Prediction horizon ('1h', '4h', '24h')
   * @returns {Promise<Object>} Prediction results
   */
  async getPrediction(symbol, ohlcvData, horizon = '1h') {
    try {
      const input = JSON.stringify({
        symbol,
        data: ohlcvData,
        horizon,
        action: 'predict'
      });

      const result = await this._runPythonScript(input);
      
      logger.info(`ML prediction for ${symbol} (${horizon}):`, {
        prediction: result.prediction,
        confidence: result.confidence,
        signal: result.signal
      });

      return result;
    } catch (error) {
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
      const input = JSON.stringify({
        symbol,
        data: ohlcvData,
        current_price: currentPrice,
        action: 'signal'
      });

      const result = await this._runPythonScript(input);
      
      logger.info(`ML trading signal for ${symbol}:`, {
        signal: result.signal,
        strength: result.strength,
        reason: result.reason
      });

      return result;
    } catch (error) {
      logger.error(`ML signal generation failed for ${symbol}:`, error);
      
      // Return neutral signal on error
      return {
        signal: 'HOLD',
        strength: 0,
        reason: `ML prediction error: ${error.message}`,
        error: true
      };
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
      const input = JSON.stringify({
        symbol,
        data: historicalData,
        action: 'train'
      });

      const result = await this._runPythonScript(input);
      
      logger.info(`ML models trained for ${symbol}:`, result);

      return result;
    } catch (error) {
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
      const input = JSON.stringify({
        symbol,
        data: ohlcvData,
        action: 'multi_horizon'
      });

      const result = await this._runPythonScript(input);
      
      return result;
    } catch (error) {
      logger.error(`Multi-horizon prediction failed for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Run Python ML script and get results
   * @private
   */
  _runPythonScript(input) {
    return new Promise((resolve, reject) => {
      const python = spawn(this.pythonPath, [this.scriptPath]);
      
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python script exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse Python output: ${error.message}\nOutput: ${stdout}`));
        }
      });

      python.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      // Send input to Python script
      python.stdin.write(input);
      python.stdin.end();
    });
  }

  /**
   * Check if ML service is available
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const input = JSON.stringify({ action: 'health' });
      const result = await this._runPythonScript(input);
      return result.status === 'healthy';
    } catch (error) {
      logger.error('ML service health check failed:', error);
      return false;
    }
  }
}

export default new MLPredictionService();
