/**
 * QIG-Enhanced ML Service
 *
 * Integrates Quantum Information Geometry principles into trading predictions:
 * - Surprise-based regime detection
 * - Integration (Φ) for indicator coherence
 * - Regime-adaptive strategy selection
 * - Attention-weighted indicator synthesis
 *
 * Based on: scripts/QIF/RCP_v4.3_QIG_Enhanced_COMPLETE.md
 */
import { logger } from '../../utils/logger.js';
import qigMetrics from './qigMetrics.js';
import marketStatePredictor from './marketStatePredictor.js';
class QIGEnhancedMLService {
    /**
     * Calculate Simple Moving Average
     */
    calculateSMA(data, period) {
        if (data.length < period)
            return data[data.length - 1] || 0;
        const slice = data.slice(-period);
        return slice.reduce((sum, val) => sum + val, 0) / period;
    }
    /**
     * Calculate Exponential Moving Average
     */
    calculateEMA(data, period) {
        if (data.length === 0)
            return 0;
        if (data.length < period)
            return this.calculateSMA(data, data.length);
        const multiplier = 2 / (period + 1);
        let ema = this.calculateSMA(data.slice(0, period), period);
        for (let i = period; i < data.length; i++) {
            ema = (data[i] - ema) * multiplier + ema;
        }
        return ema;
    }
    /**
     * Calculate RSI (Relative Strength Index)
     */
    calculateRSI(data, period = 14) {
        if (data.length < period + 1)
            return 50;
        const changes = [];
        for (let i = 1; i < data.length; i++) {
            changes.push(data[i] - data[i - 1]);
        }
        const gains = changes.map(c => c > 0 ? c : 0);
        const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
        const avgGain = this.calculateSMA(gains, period);
        const avgLoss = this.calculateSMA(losses, period);
        if (avgLoss === 0)
            return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
    /**
     * Calculate MACD
     */
    calculateMACD(data) {
        const ema12 = this.calculateEMA(data, 12);
        const ema26 = this.calculateEMA(data, 26);
        const macd = ema12 - ema26;
        const signal = macd * 0.9;
        const histogram = macd - signal;
        return { macd, signal, histogram };
    }
    /**
     * Build market state from OHLCV data
     */
    buildMarketState(ohlcvData) {
        const closePrices = ohlcvData.map(d => d.close);
        const volumes = ohlcvData.map(d => d.volume);
        const sma20 = this.calculateSMA(closePrices, 20);
        const sma50 = this.calculateSMA(closePrices, 50);
        const ema12 = this.calculateEMA(closePrices, 12);
        const rsi = this.calculateRSI(closePrices);
        const macd = this.calculateMACD(closePrices);
        return {
            prices: closePrices,
            indicators: {
                sma20,
                sma50,
                ema12,
                rsi,
                macd: macd.macd,
                macdSignal: macd.signal,
                macdHistogram: macd.histogram
            },
            volume: volumes,
            timestamp: ohlcvData[ohlcvData.length - 1]?.timestamp || Date.now()
        };
    }
    /**
     * Get multi-horizon predictions with QIG enhancement
     */
    async getMultiHorizonPredictions(symbol, ohlcvData) {
        try {
            // 1. Build current market state
            const currentState = this.buildMarketState(ohlcvData);
            // 2. Get prediction from state predictor
            const predictedState = marketStatePredictor.predict(currentState);
            // 3. Compute QIG metrics
            const metrics = qigMetrics.computeAllMetrics(predictedState, currentState);
            // 4. Generate regime-adaptive predictions
            const predictions = this.generateRegimeAdaptivePredictions(currentState, metrics);
            // 5. Update predictor with actual state
            marketStatePredictor.update(currentState);
            // 6. Generate explanation
            const explanation = this.generateExplanation(metrics, currentState);
            logger.info(`QIG-Enhanced predictions for ${symbol}:`, {
                regime: metrics.regime,
                confidence: metrics.confidence.toFixed(2),
                surprise: metrics.surprise.toFixed(2),
                integration: metrics.integration.toFixed(2)
            });
            return {
                predictions,
                qigMetrics: {
                    surprise: metrics.surprise,
                    integration: metrics.integration,
                    confidence: metrics.confidence,
                    regime: metrics.regime,
                    attentionWeights: Object.fromEntries(metrics.attentionWeights),
                    statePurity: metrics.statePurity
                },
                explanation
            };
        }
        catch (error) {
            logger.error('QIG-Enhanced prediction error:', error);
            throw error;
        }
    }
    /**
     * Generate regime-adaptive predictions
     */
    generateRegimeAdaptivePredictions(state, metrics) {
        const currentPrice = state.prices[state.prices.length - 1];
        switch (metrics.regime) {
            case 'LINEAR':
                return this.linearRegimePrediction(state, metrics, currentPrice);
            case 'GEOMETRIC':
                return this.geometricRegimePrediction(state, metrics, currentPrice);
            case 'BREAKDOWN':
                return this.breakdownRegimePrediction(state, metrics, currentPrice);
            default:
                return this.geometricRegimePrediction(state, metrics, currentPrice);
        }
    }
    /**
     * Linear regime: Simple trend following with high confidence
     */
    linearRegimePrediction(state, metrics, currentPrice) {
        const { sma20, ema12, rsi } = state.indicators;
        // Simple trend detection
        const bullish = currentPrice > sma20 && currentPrice > ema12;
        const direction = bullish ? 'BULLISH' : (currentPrice < sma20 && currentPrice < ema12 ? 'BEARISH' : 'NEUTRAL');
        // High confidence in linear regime
        const baseConfidence = metrics.confidence * 100;
        // Conservative price changes in linear regime
        const priceChange1h = direction === 'BULLISH' ? 0.003 : (direction === 'BEARISH' ? -0.003 : 0);
        const priceChange4h = direction === 'BULLISH' ? 0.01 : (direction === 'BEARISH' ? -0.01 : 0);
        const priceChange24h = direction === 'BULLISH' ? 0.03 : (direction === 'BEARISH' ? -0.03 : 0);
        return {
            '1h': {
                price: Math.round(currentPrice * (1 + priceChange1h) * 100) / 100,
                confidence: Math.round(baseConfidence),
                direction
            },
            '4h': {
                price: Math.round(currentPrice * (1 + priceChange4h) * 100) / 100,
                confidence: Math.round(baseConfidence * 0.95),
                direction
            },
            '24h': {
                price: Math.round(currentPrice * (1 + priceChange24h) * 100) / 100,
                confidence: Math.round(baseConfidence * 0.9),
                direction
            }
        };
    }
    /**
     * Geometric regime: Complex multi-indicator synthesis with attention weighting
     */
    geometricRegimePrediction(state, metrics, currentPrice) {
        const { sma20, sma50, ema12, rsi, macd, macdHistogram } = state.indicators;
        const weights = metrics.attentionWeights;
        // Weighted bullish/bearish scoring
        let bullishScore = 0;
        let bearishScore = 0;
        // SMA20 signal
        if (currentPrice > sma20) {
            bullishScore += (weights.get('sma20') || 0.14) * 0.3;
        }
        else {
            bearishScore += (weights.get('sma20') || 0.14) * 0.3;
        }
        // SMA50 signal
        if (currentPrice > sma50) {
            bullishScore += (weights.get('sma50') || 0.14) * 0.2;
        }
        else {
            bearishScore += (weights.get('sma50') || 0.14) * 0.2;
        }
        // EMA12 signal
        if (currentPrice > ema12) {
            bullishScore += (weights.get('ema12') || 0.14) * 0.3;
        }
        else {
            bearishScore += (weights.get('ema12') || 0.14) * 0.3;
        }
        // RSI signal
        if (rsi < 30) {
            bullishScore += (weights.get('rsi') || 0.14) * 0.4; // Oversold
        }
        else if (rsi > 70) {
            bearishScore += (weights.get('rsi') || 0.14) * 0.4; // Overbought
        }
        else if (rsi > 50) {
            bullishScore += (weights.get('rsi') || 0.14) * 0.1;
        }
        else {
            bearishScore += (weights.get('rsi') || 0.14) * 0.1;
        }
        // MACD signal
        if (macdHistogram > 0) {
            bullishScore += (weights.get('macdHistogram') || 0.14) * 0.3;
        }
        else {
            bearishScore += (weights.get('macdHistogram') || 0.14) * 0.3;
        }
        // Determine direction
        const netScore = bullishScore - bearishScore;
        const direction = netScore > 0.15 ? 'BULLISH' : (netScore < -0.15 ? 'BEARISH' : 'NEUTRAL');
        // Confidence modulated by integration
        const baseConfidence = metrics.confidence * metrics.integration * 100;
        // Price changes based on net score magnitude
        const magnitude = Math.abs(netScore);
        const priceChange1h = netScore > 0 ? magnitude * 0.01 : -magnitude * 0.01;
        const priceChange4h = netScore > 0 ? magnitude * 0.03 : -magnitude * 0.03;
        const priceChange24h = netScore > 0 ? magnitude * 0.08 : -magnitude * 0.08;
        return {
            '1h': {
                price: Math.round(currentPrice * (1 + priceChange1h) * 100) / 100,
                confidence: Math.round(Math.min(baseConfidence, 85)),
                direction
            },
            '4h': {
                price: Math.round(currentPrice * (1 + priceChange4h) * 100) / 100,
                confidence: Math.round(Math.min(baseConfidence * 0.9, 80)),
                direction
            },
            '24h': {
                price: Math.round(currentPrice * (1 + priceChange24h) * 100) / 100,
                confidence: Math.round(Math.min(baseConfidence * 0.8, 75)),
                direction
            }
        };
    }
    /**
     * Breakdown regime: Conservative predictions with reduced confidence
     */
    breakdownRegimePrediction(state, metrics, currentPrice) {
        // In breakdown regime, reduce confidence significantly
        const baseConfidence = metrics.confidence * 50; // 50% penalty
        // Very conservative price predictions (near current price)
        const direction = 'NEUTRAL';
        return {
            '1h': {
                price: Math.round(currentPrice * 100) / 100,
                confidence: Math.round(Math.max(baseConfidence, 20)),
                direction
            },
            '4h': {
                price: Math.round(currentPrice * 100) / 100,
                confidence: Math.round(Math.max(baseConfidence * 0.9, 15)),
                direction
            },
            '24h': {
                price: Math.round(currentPrice * 100) / 100,
                confidence: Math.round(Math.max(baseConfidence * 0.8, 10)),
                direction
            }
        };
    }
    /**
     * Generate human-readable explanation of QIG metrics
     */
    generateExplanation(metrics, state) {
        const regimeExplanations = {
            LINEAR: 'Market is in a stable, predictable state with clear trends. Using simple trend-following strategy.',
            GEOMETRIC: 'Market shows complex patterns requiring full multi-indicator analysis. Using attention-weighted synthesis.',
            BREAKDOWN: 'Market is highly volatile and unstable. Reducing confidence and adopting conservative stance.'
        };
        const surpriseLevel = metrics.surprise < 0.3 ? 'low' : (metrics.surprise < 0.6 ? 'moderate' : 'high');
        const integrationLevel = metrics.integration < 0.4 ? 'low' : (metrics.integration < 0.7 ? 'moderate' : 'high');
        // Find most important indicators
        const sortedWeights = Array.from(metrics.attentionWeights.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        const topIndicators = sortedWeights.map(([name, weight]) => `${name} (${(weight * 100).toFixed(0)}%)`).join(', ');
        return `${regimeExplanations[metrics.regime]} ` +
            `Surprise level is ${surpriseLevel} (${(metrics.surprise * 100).toFixed(0)}%), ` +
            `indicator coherence is ${integrationLevel} (${(metrics.integration * 100).toFixed(0)}%). ` +
            `Top indicators: ${topIndicators}.`;
    }
    /**
     * Health check
     */
    async healthCheck() {
        return true;
    }
}
export default new QIGEnhancedMLService();
