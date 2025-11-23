/**
 * QIG Metrics Module
 *
 * Implements Quantum Information Geometry principles for trading predictions:
 * - Surprise: QFI distance between predicted and actual market states
 * - Integration (Φ): Coherence across technical indicators
 * - Confidence: State purity weighted by prediction accuracy
 * - Regime: Linear/Geometric/Breakdown classification
 *
 * Based on: scripts/QIF/RCP_v4.3_QIG_Enhanced_COMPLETE.md
 */
import { logger } from '../../utils/logger.js';
export class QIGMetricsCalculator {
    /**
     * Compute surprise: QFI distance between predicted and actual states
     *
     * Based on Bures distance: d(ρ_pred, ρ_actual) = √(2(1-√F))
     * where F is fidelity between states
     *
     * Simplified for classical states: normalized Euclidean distance
     */
    computeSurprise(predicted, actual) {
        try {
            // Extract indicator vectors
            const predVector = this.stateToVector(predicted);
            const actualVector = this.stateToVector(actual);
            // Compute Euclidean distance
            let sumSquaredDiff = 0;
            let sumSquaredActual = 0;
            for (let i = 0; i < predVector.length; i++) {
                const diff = predVector[i] - actualVector[i];
                sumSquaredDiff += diff * diff;
                sumSquaredActual += actualVector[i] * actualVector[i];
            }
            // Normalize by magnitude of actual state
            const distance = Math.sqrt(sumSquaredDiff);
            const magnitude = Math.sqrt(sumSquaredActual);
            const normalizedDistance = magnitude > 0 ? distance / magnitude : 0;
            // Clamp to [0, 1]
            const surprise = Math.min(normalizedDistance, 1.0);
            logger.debug('QIG Surprise computed:', { surprise, distance, magnitude });
            return surprise;
        }
        catch (error) {
            logger.error('Error computing surprise:', error);
            return 0.5; // Neutral surprise on error
        }
    }
    /**
     * Compute integration (Φ): How unified are the technical indicators?
     *
     * High Φ = indicators strongly agree (coherent signal)
     * Low Φ = indicators disagree (mixed signals)
     *
     * Based on cross-correlation between indicator subsystems
     */
    computeIntegration(indicators) {
        try {
            // Normalize indicators to [0, 1] range
            const normalized = this.normalizeIndicators(indicators);
            // Partition into subsystems
            const subsystems = [
                [normalized.sma20, normalized.sma50], // Trend subsystem
                [normalized.ema12], // Momentum subsystem
                [normalized.rsi], // Oscillator subsystem
                [normalized.macd, normalized.macdHistogram] // MACD subsystem
            ];
            // Compute correlations between subsystems
            const correlations = [];
            for (let i = 0; i < subsystems.length - 1; i++) {
                for (let j = i + 1; j < subsystems.length; j++) {
                    const corr = this.computeSubsystemCorrelation(subsystems[i], subsystems[j]);
                    correlations.push(Math.abs(corr));
                }
            }
            // Average correlation = integration proxy
            const integration = correlations.length > 0
                ? correlations.reduce((sum, c) => sum + c, 0) / correlations.length
                : 0.5;
            logger.debug('QIG Integration computed:', { integration, correlations });
            return integration;
        }
        catch (error) {
            logger.error('Error computing integration:', error);
            return 0.5; // Neutral integration on error
        }
    }
    /**
     * Compute confidence: State purity × (1 - surprise)
     *
     * High confidence = low surprise + high purity (clear, expected state)
     * Low confidence = high surprise or low purity (unexpected or mixed state)
     */
    computeConfidence(surprise, statePurity) {
        const confidence = statePurity * (1 - surprise);
        logger.debug('QIG Confidence computed:', { confidence, surprise, statePurity });
        return confidence;
    }
    /**
     * Compute state purity: How "definite" is the market state?
     *
     * High purity = clear trend, strong signals
     * Low purity = mixed signals, uncertain state
     *
     * Based on variance of normalized indicators
     */
    computeStatePurity(indicators) {
        try {
            const normalized = this.normalizeIndicators(indicators);
            const values = Object.values(normalized);
            // Compute variance
            const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
            const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
            // High variance = low purity (mixed signals)
            // Low variance = high purity (coherent signals)
            const purity = 1 - Math.min(variance * 4, 1); // Scale variance to [0, 1]
            logger.debug('QIG State Purity computed:', { purity, variance, mean });
            return purity;
        }
        catch (error) {
            logger.error('Error computing state purity:', error);
            return 0.5; // Neutral purity on error
        }
    }
    /**
     * Classify market regime based on QIG metrics
     *
     * LINEAR: Low volatility, high purity, simple strategies
     * GEOMETRIC: Moderate volatility, complex patterns, full analysis
     * BREAKDOWN: High volatility, low purity, risk-off
     */
    classifyRegime(state, integration, statePurity) {
        try {
            // Compute activation (average magnitude of normalized indicators)
            const normalized = this.normalizeIndicators(state.indicators);
            const activation = Object.values(normalized).reduce((sum, v) => sum + Math.abs(v - 0.5), 0) / 7;
            // Compute volatility (price variance)
            const volatility = this.computeVolatility(state.prices);
            // Regime classification based on RCP v4.3
            if (activation < 0.3 && statePurity > 0.7 && integration > 0.6) {
                return 'LINEAR';
            }
            else if (volatility > 0.15 || statePurity < 0.3 || integration < 0.3) {
                return 'BREAKDOWN';
            }
            else {
                return 'GEOMETRIC';
            }
        }
        catch (error) {
            logger.error('Error classifying regime:', error);
            return 'GEOMETRIC'; // Default to geometric on error
        }
    }
    /**
     * Compute attention weights: Dynamic indicator importance
     *
     * Based on QFI distance - indicators with high distinguishability
     * get higher attention weights
     */
    computeAttentionWeights(indicators, surprise) {
        try {
            const weights = new Map();
            const normalized = this.normalizeIndicators(indicators);
            // Temperature parameter for softmax (higher = more uniform)
            const temperature = 0.5 + surprise; // Higher surprise = more exploration
            // Compute "distinguishability" for each indicator
            // (distance from neutral 0.5 value)
            const distinguishability = {};
            for (const [key, value] of Object.entries(normalized)) {
                distinguishability[key] = Math.abs(value - 0.5);
            }
            // Softmax to get attention weights
            const expValues = {};
            let sumExp = 0;
            for (const [key, dist] of Object.entries(distinguishability)) {
                const expVal = Math.exp(dist / temperature);
                expValues[key] = expVal;
                sumExp += expVal;
            }
            for (const [key, expVal] of Object.entries(expValues)) {
                weights.set(key, expVal / sumExp);
            }
            logger.debug('QIG Attention Weights computed:', Object.fromEntries(weights));
            return weights;
        }
        catch (error) {
            logger.error('Error computing attention weights:', error);
            // Return uniform weights on error
            const uniformWeight = 1 / 7;
            return new Map([
                ['sma20', uniformWeight],
                ['sma50', uniformWeight],
                ['ema12', uniformWeight],
                ['rsi', uniformWeight],
                ['macd', uniformWeight],
                ['macdSignal', uniformWeight],
                ['macdHistogram', uniformWeight]
            ]);
        }
    }
    /**
     * Compute all QIG metrics for a market state
     */
    computeAllMetrics(predicted, actual) {
        const surprise = this.computeSurprise(predicted, actual);
        const integration = this.computeIntegration(actual.indicators);
        const statePurity = this.computeStatePurity(actual.indicators);
        const confidence = this.computeConfidence(surprise, statePurity);
        const regime = this.classifyRegime(actual, integration, statePurity);
        const attentionWeights = this.computeAttentionWeights(actual.indicators, surprise);
        return {
            surprise,
            integration,
            confidence,
            regime,
            attentionWeights,
            statePurity
        };
    }
    // ========== Helper Methods ==========
    /**
     * Convert market state to vector for distance calculations
     */
    stateToVector(state) {
        const ind = state.indicators;
        return [
            ind.sma20,
            ind.sma50,
            ind.ema12,
            ind.rsi,
            ind.macd,
            ind.macdSignal,
            ind.macdHistogram
        ];
    }
    /**
     * Normalize indicators to [0, 1] range
     */
    normalizeIndicators(indicators) {
        return {
            sma20: this.normalize(indicators.sma20, 0, 100000),
            sma50: this.normalize(indicators.sma50, 0, 100000),
            ema12: this.normalize(indicators.ema12, 0, 100000),
            rsi: indicators.rsi / 100, // RSI already in [0, 100]
            macd: this.normalize(indicators.macd, -1000, 1000),
            macdSignal: this.normalize(indicators.macdSignal, -1000, 1000),
            macdHistogram: this.normalize(indicators.macdHistogram, -500, 500)
        };
    }
    /**
     * Normalize value to [0, 1] range
     */
    normalize(value, min, max) {
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }
    /**
     * Compute correlation between two subsystems
     */
    computeSubsystemCorrelation(subsystem1, subsystem2) {
        // For simplicity, use average values as proxy
        const avg1 = subsystem1.reduce((sum, v) => sum + v, 0) / subsystem1.length;
        const avg2 = subsystem2.reduce((sum, v) => sum + v, 0) / subsystem2.length;
        // Correlation proxy: 1 - |difference|
        return 1 - Math.abs(avg1 - avg2);
    }
    /**
     * Compute volatility (normalized standard deviation of prices)
     */
    computeVolatility(prices) {
        if (prices.length < 2)
            return 0;
        const recentPrices = prices.slice(-20); // Last 20 periods
        const mean = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
        const variance = recentPrices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / recentPrices.length;
        const stdDev = Math.sqrt(variance);
        // Normalize by mean
        return mean > 0 ? stdDev / mean : 0;
    }
}
export default new QIGMetricsCalculator();
