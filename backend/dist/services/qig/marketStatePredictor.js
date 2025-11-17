/**
 * Market State Predictor
 *
 * Maintains rolling prediction of next market state based on historical patterns.
 * Analogous to SelfModel.predict() in consciousness_agent.py
 *
 * Uses weighted exponential moving average of recent states to predict next state.
 */
import { logger } from '../../utils/logger.js';
export class MarketStatePredictor {
    constructor() {
        this.history = [];
        this.maxHistorySize = 100;
        this.predictionWindow = 5; // Use last 5 states for prediction
    }
    /**
     * Predict next market state based on historical patterns
     *
     * Uses exponentially weighted average of recent states
     * More recent states have higher weight
     */
    predict(currentState) {
        try {
            // If no history, return current state as prediction
            if (this.history.length === 0) {
                logger.debug('No history available, returning current state as prediction');
                return this.cloneState(currentState);
            }
            // Get recent states for prediction
            const recentStates = this.history.slice(-this.predictionWindow);
            if (recentStates.length === 0) {
                return this.cloneState(currentState);
            }
            // Compute exponential weights (more recent = higher weight)
            const weights = this.computeExponentialWeights(recentStates.length);
            // Weighted average of indicators
            const predictedIndicators = {
                sma20: 0,
                sma50: 0,
                ema12: 0,
                rsi: 0,
                macd: 0,
                macdSignal: 0,
                macdHistogram: 0
            };
            for (let i = 0; i < recentStates.length; i++) {
                const state = recentStates[i].state;
                const weight = weights[i];
                predictedIndicators.sma20 += state.indicators.sma20 * weight;
                predictedIndicators.sma50 += state.indicators.sma50 * weight;
                predictedIndicators.ema12 += state.indicators.ema12 * weight;
                predictedIndicators.rsi += state.indicators.rsi * weight;
                predictedIndicators.macd += state.indicators.macd * weight;
                predictedIndicators.macdSignal += state.indicators.macdSignal * weight;
                predictedIndicators.macdHistogram += state.indicators.macdHistogram * weight;
            }
            // Predict price trend (simple linear extrapolation)
            const predictedPrices = this.predictPrices(recentStates);
            // Predict volume (average of recent volumes)
            const predictedVolume = this.predictVolume(recentStates);
            const prediction = {
                prices: predictedPrices,
                indicators: predictedIndicators,
                volume: predictedVolume,
                timestamp: Date.now()
            };
            logger.debug('Market state predicted:', {
                historySize: this.history.length,
                predictionWindow: recentStates.length,
                predictedRSI: predictedIndicators.rsi.toFixed(2),
                predictedMACD: predictedIndicators.macd.toFixed(2)
            });
            return prediction;
        }
        catch (error) {
            logger.error('Error predicting market state:', error);
            return this.cloneState(currentState);
        }
    }
    /**
     * Update history with actual market state
     */
    update(actualState) {
        try {
            this.history.push({
                state: this.cloneState(actualState),
                timestamp: actualState.timestamp
            });
            // Trim history if exceeds max size
            if (this.history.length > this.maxHistorySize) {
                this.history.shift();
            }
            logger.debug('Market state history updated:', {
                historySize: this.history.length,
                timestamp: actualState.timestamp
            });
        }
        catch (error) {
            logger.error('Error updating market state history:', error);
        }
    }
    /**
     * Get prediction accuracy (average surprise over recent predictions)
     */
    getAccuracy() {
        // This would require storing predictions and comparing with actuals
        // For now, return a placeholder
        return 0.75; // 75% accuracy placeholder
    }
    /**
     * Clear history (useful for testing or regime changes)
     */
    clearHistory() {
        this.history = [];
        logger.info('Market state history cleared');
    }
    /**
     * Get history size
     */
    getHistorySize() {
        return this.history.length;
    }
    // ========== Helper Methods ==========
    /**
     * Compute exponential weights for recent states
     * More recent states get higher weights
     */
    computeExponentialWeights(n) {
        const weights = [];
        let sum = 0;
        // Generate exponential weights
        for (let i = 0; i < n; i++) {
            const weight = Math.exp((i - n + 1) / 2); // Exponential decay
            weights.push(weight);
            sum += weight;
        }
        // Normalize to sum to 1
        return weights.map(w => w / sum);
    }
    /**
     * Predict future prices using linear extrapolation
     */
    predictPrices(recentStates) {
        if (recentStates.length === 0)
            return [];
        // Get last prices from each state
        const lastPrices = recentStates.map(s => {
            const prices = s.state.prices;
            return prices[prices.length - 1] || 0;
        });
        if (lastPrices.length < 2) {
            return recentStates[recentStates.length - 1].state.prices;
        }
        // Compute trend (simple linear regression)
        const n = lastPrices.length;
        const xMean = (n - 1) / 2;
        const yMean = lastPrices.reduce((sum, p) => sum + p, 0) / n;
        let numerator = 0;
        let denominator = 0;
        for (let i = 0; i < n; i++) {
            numerator += (i - xMean) * (lastPrices[i] - yMean);
            denominator += (i - xMean) ** 2;
        }
        const slope = denominator !== 0 ? numerator / denominator : 0;
        // Extrapolate next price
        const lastPrice = lastPrices[lastPrices.length - 1];
        const predictedPrice = lastPrice + slope;
        // Return predicted price as single-element array
        return [predictedPrice];
    }
    /**
     * Predict future volume using weighted average
     */
    predictVolume(recentStates) {
        if (recentStates.length === 0)
            return [];
        const weights = this.computeExponentialWeights(recentStates.length);
        // Get last volume from each state
        const lastVolumes = recentStates.map(s => {
            const volumes = s.state.volume;
            return volumes[volumes.length - 1] || 0;
        });
        // Weighted average
        let predictedVolume = 0;
        for (let i = 0; i < lastVolumes.length; i++) {
            predictedVolume += lastVolumes[i] * weights[i];
        }
        return [predictedVolume];
    }
    /**
     * Deep clone a market state
     */
    cloneState(state) {
        return {
            prices: [...state.prices],
            indicators: { ...state.indicators },
            volume: [...state.volume],
            timestamp: state.timestamp
        };
    }
}
export default new MarketStatePredictor();
