import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authenticateToken } from '../middleware/auth.js';
const router = Router();
// Initialize Claude client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});
/**
 * POST /api/ai/trading-insight
 * Generate trading insights using Claude Sonnet 4.5
 */
router.post('/trading-insight', authenticateToken, async (req, res) => {
    try {
        const { tradingData, userQuery } = req.body;
        if (!tradingData) {
            return res.status(400).json({
                success: false,
                error: 'Trading data is required'
            });
        }
        // Build prompt for Claude
        const prompt = buildTradingPrompt(tradingData, userQuery);
        // Call Claude Sonnet 4.5
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        });
        // Parse Claude's response
        const content = message.content[0];
        const responseText = content.type === 'text' ? content.text : '';
        // Extract structured insight from response
        const insight = parseClaudeResponse(responseText, tradingData);
        res.json({
            success: true,
            insight
        });
    }
    catch (error) {
        console.error('Error generating trading insight:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate trading insight',
            details: error.message
        });
    }
});
/**
 * Build trading prompt for Claude
 */
function buildTradingPrompt(tradingData, userQuery) {
    const { symbol, price, change24h, volume, technicalIndicators } = tradingData;
    let prompt = `You are an expert cryptocurrency trading analyst. Analyze the following market data and provide a concise trading insight.

Market Data:
- Symbol: ${symbol}
- Current Price: $${price.toLocaleString()}
- 24h Change: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%
- 24h Volume: ${volume.toLocaleString()}`;
    if (technicalIndicators) {
        prompt += `\n\nTechnical Indicators:`;
        if (technicalIndicators.rsi) {
            prompt += `\n- RSI: ${technicalIndicators.rsi.toFixed(2)}`;
        }
        if (technicalIndicators.macd) {
            prompt += `\n- MACD: ${technicalIndicators.macd.toFixed(2)}`;
        }
    }
    if (userQuery) {
        prompt += `\n\nUser Question: ${userQuery}`;
    }
    prompt += `\n\nProvide your analysis in the following JSON format:
{
  "type": "analysis" | "recommendation" | "risk_assessment" | "market_outlook",
  "title": "Brief title (max 50 chars)",
  "content": "Detailed insight (max 200 chars)",
  "confidence": 0-100,
  "timeframe": "e.g., 1h, 4h, 24h, 1w"
}

Focus on actionable insights and be concise.`;
    return prompt;
}
/**
 * Parse Claude's response into structured insight
 */
function parseClaudeResponse(responseText, tradingData) {
    try {
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                type: parsed.type || 'analysis',
                title: parsed.title || 'Market Analysis',
                content: parsed.content || responseText.substring(0, 200),
                confidence: parsed.confidence || 75,
                timeframe: parsed.timeframe || '24h'
            };
        }
        // Fallback: create insight from raw text
        return {
            type: 'analysis',
            title: 'Market Analysis',
            content: responseText.substring(0, 200),
            confidence: 75,
            timeframe: '24h'
        };
    }
    catch (error) {
        console.error('Error parsing Claude response:', error);
        // Return mock insight as fallback
        return {
            type: 'analysis',
            title: 'Market Analysis',
            content: `${tradingData.symbol} is ${tradingData.change24h > 0 ? 'up' : 'down'} ${Math.abs(tradingData.change24h).toFixed(2)}% in 24h at $${tradingData.price.toLocaleString()}`,
            confidence: 70,
            timeframe: '24h'
        };
    }
}
export default router;
