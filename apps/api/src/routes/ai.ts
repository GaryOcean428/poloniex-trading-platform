import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Initialize Claude client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * POST /api/ai/trading-insight
 * Generate trading insights using Claude Sonnet 4.5 with extended thinking
 */
router.post('/trading-insight', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { tradingData, userQuery, enableThinking = true } = req.body;

    if (!tradingData) {
      return res.status(400).json({
        success: false,
        error: 'Trading data is required'
      });
    }

    // Build prompt for Claude
    const prompt = buildTradingPrompt(tradingData, userQuery);

    // Call Claude Sonnet 4.5 with extended thinking for better trading analysis
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096, // Increased from 1024 for more detailed analysis
      // Enable extended thinking for complex trading analysis (can be disabled for speed)
      ...(enableThinking && {
        thinking: {
          type: 'enabled' as const,
          budget_tokens: 2000 // Reserve tokens for reasoning about market conditions
        }
      }),
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Handle refusal stop reason (Claude 4.5 feature)
    if (message.stop_reason === 'refusal') {
      return res.status(400).json({
        success: false,
        error: 'Request declined by AI for safety reasons',
        refusal: true
      });
    }

    // Parse Claude's response (skip thinking blocks, use text content)
    const textContent = message.content.filter(block => block.type === 'text');
    const responseText = textContent.length > 0 && textContent[0].type === 'text'
      ? textContent[0].text
      : '';

    // Extract structured insight from response
    const insight = parseClaudeResponse(responseText, tradingData);

    res.json({
      success: true,
      insight,
      // Include metadata about thinking usage
      meta: {
        thinkingEnabled: enableThinking,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens
      }
    });
  } catch (error: any) {
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
function buildTradingPrompt(tradingData: any, userQuery?: string): string {
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
function parseClaudeResponse(responseText: string, tradingData: any): any {
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
  } catch (error) {
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
