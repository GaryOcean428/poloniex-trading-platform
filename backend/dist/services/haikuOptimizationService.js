import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
export class HaikuOptimizationService {
    constructor() {
        this.client = null;
        this.model = 'claude-haiku-4-5-20251001'; // Claude Haiku 4.5 (latest)
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        if (this.apiKey) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            logger.info('Haiku Optimization Service initialized with Claude Haiku 4.5 (claude-haiku-4-5-20251001)');
        }
        else {
            logger.warn('ANTHROPIC_API_KEY not set - Haiku optimization will be unavailable');
        }
    }
    /**
     * Check if service is available
     */
    isAvailable() {
        return this.client !== null;
    }
    /**
     * Ensure client is initialized
     */
    ensureClient() {
        if (!this.client) {
            throw new Error('Haiku Optimization Service is not available. Please set ANTHROPIC_API_KEY.');
        }
    }
    /**
     * Quick market sentiment analysis (real-time)
     * Perfect for high-frequency trading decisions
     */
    async quickMarketSentiment(symbol, price, priceChange24h, volume, technicalIndicators) {
        this.ensureClient();
        try {
            const prompt = `Analyze ${symbol} for quick trading decision:
Price: $${price.toFixed(2)}
24h Change: ${priceChange24h.toFixed(2)}%
Volume: ${volume.toLocaleString()}
${technicalIndicators ? `RSI: ${technicalIndicators.rsi?.toFixed(2) || 'N/A'}` : ''}

Provide: sentiment (bullish/bearish/neutral), confidence (0-100), 2-3 key signals, risk level (low/medium/high), brief reasoning.
Return as JSON: {"sentiment": "...", "confidence": 85, "signals": ["...", "..."], "riskLevel": "...", "reasoning": "..."}`;
            // Use Haiku 4.5 with extended thinking for better analysis
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 1024, // Keep low for speed
                thinking: {
                    type: 'enabled',
                    budget_tokens: 500 // Quick reasoning
                },
                messages: [{
                        role: 'user',
                        content: prompt
                    }]
            });
            // Handle refusal
            if (response.stop_reason === 'refusal') {
                throw new Error('Analysis request declined for safety reasons');
            }
            // Extract text content
            const textBlocks = response.content.filter(b => b.type === 'text');
            const text = textBlocks[0]?.type === 'text' ? textBlocks[0].text : '{}';
            // Parse JSON
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            // Fallback
            return {
                sentiment: 'neutral',
                confidence: 50,
                signals: ['Insufficient data'],
                riskLevel: 'medium',
                reasoning: 'Could not parse response'
            };
        }
        catch (error) {
            logger.error('Error in quick market sentiment:', error);
            throw error;
        }
    }
    /**
     * Fast risk check before trade execution
     * Called for every trade to ensure safety
     */
    async quickRiskCheck(symbol, action, amount, currentPosition, accountBalance, marketConditions) {
        this.ensureClient();
        try {
            const prompt = `RISK CHECK for ${action.toUpperCase()} ${symbol}:
Amount: ${amount}
Current Position: ${currentPosition}
Account Balance: $${accountBalance}
Market: ${marketConditions.volatility} volatility, ${marketConditions.liquidity} liquidity, ${marketConditions.trend} trend

Evaluate risk and approve/reject. Return JSON:
{"approved": true/false, "riskScore": 0-100, "warnings": ["..."], "recommendation": "..."}`;
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 512,
                thinking: {
                    type: 'enabled',
                    budget_tokens: 300 // Fast risk assessment
                },
                messages: [{
                        role: 'user',
                        content: prompt
                    }]
            });
            if (response.stop_reason === 'refusal') {
                return {
                    approved: false,
                    riskScore: 100,
                    warnings: ['AI declined to assess this trade'],
                    recommendation: 'Do not proceed'
                };
            }
            const textBlocks = response.content.filter(b => b.type === 'text');
            const text = textBlocks[0]?.type === 'text' ? textBlocks[0].text : '{}';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            // Conservative fallback
            return {
                approved: false,
                riskScore: 75,
                warnings: ['Could not parse risk assessment'],
                recommendation: 'Manual review required'
            };
        }
        catch (error) {
            logger.error('Error in quick risk check:', error);
            // Fail-safe: reject on error
            return {
                approved: false,
                riskScore: 100,
                warnings: ['Risk check failed'],
                recommendation: 'Do not proceed due to system error'
            };
        }
    }
    /**
     * Batch process multiple market checks (high-volume)
     * Process 10-100 signals quickly for filtering
     */
    async batchMarketScreening(symbols, priceData) {
        this.ensureClient();
        try {
            const prompt = `Screen these ${symbols.length} assets for trading opportunities:
${priceData.map(d => `${d.symbol}: $${d.price}, ${d.change24h.toFixed(2)}%, vol: ${d.volume}`).join('\n')}

Rank top 5 by opportunity score (0-100). Return JSON array:
[{"symbol": "...", "score": 85, "signals": ["...", "..."]}]`;
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 2048,
                thinking: {
                    type: 'enabled',
                    budget_tokens: 1000 // Balance speed and quality
                },
                messages: [{
                        role: 'user',
                        content: prompt
                    }]
            });
            if (response.stop_reason === 'refusal') {
                return [];
            }
            const textBlocks = response.content.filter(b => b.type === 'text');
            const text = textBlocks[0]?.type === 'text' ? textBlocks[0].text : '[]';
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return [];
        }
        catch (error) {
            logger.error('Error in batch market screening:', error);
            return [];
        }
    }
    /**
     * Get usage statistics for cost tracking
     */
    getUsageInfo() {
        return {
            model: 'Claude Haiku 4.5',
            inputCost: '$1 per million tokens',
            outputCost: '$5 per million tokens',
            speedVsSonnet: '2x faster than Sonnet 4.5',
            bestFor: [
                'Real-time market analysis',
                'High-frequency risk checks',
                'Batch signal screening',
                'Quick sentiment analysis',
                'Cost-sensitive operations'
            ]
        };
    }
}
// Singleton instance
let haikuServiceInstance = null;
/**
 * Get or create the Haiku optimization service singleton
 */
export function getHaikuOptimizationService() {
    if (!haikuServiceInstance) {
        haikuServiceInstance = new HaikuOptimizationService();
    }
    return haikuServiceInstance;
}
