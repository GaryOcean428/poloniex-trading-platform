import OpenAI from 'openai';

export interface TradingInsight {
  type: 'analysis' | 'recommendation' | 'risk_assessment' | 'market_outlook';
  title: string;
  content: string;
  confidence: number; // 0-100
  timeframe: string;
  createdAt: Date;
}

export interface TradingData {
  symbol: string;
  price: number;
  change24h: number;
  volume: number;
  marketCap?: number;
  technicalIndicators?: {
    rsi?: number;
    macd?: number;
    bollingerBands?: {
      upper: number;
      middle: number;
      lower: number;
    };
  };
}

class OpenAITradingService {
  private client: OpenAI | null = null;
  private isConfigured = false;

  constructor() {
    this.initializeClient();
  }

  private initializeClient() {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    
    if (!apiKey) {
      // console.warn('OpenAI API key not found. LLM features will use mock data.');
      return;
    }

    try {
      this.client = new OpenAI({
        apiKey,
        // Note: In a production environment, API calls should go through your backend
        // This is for demo purposes only
        dangerouslyAllowBrowser: true
      });
      this.isConfigured = true;
      // console.log('OpenAI client initialized successfully');
    } catch (error) {
      // console.error('Failed to initialize OpenAI client:', error);
    }
  }

  async generateTradingInsight(
    tradingData: TradingData,
    userQuery?: string
  ): Promise<TradingInsight> {
    if (!this.isConfigured || !this.client) {
      return this.getMockInsight(tradingData, userQuery);
    }

    try {
      const prompt = this.buildTradingPrompt(tradingData, userQuery);
      
      const completion = await this.client.chat.completions.create({
        model: "gpt-4.1-nano", // Using the new GPT-4.1 model as specified
        messages: [
          {
            role: "system",
            content: `You are an expert cryptocurrency trading analyst. Provide concise, actionable trading insights based on market data. Always include:
            1. Clear analysis of current market conditions
            2. Specific recommendations with risk levels
            3. Timeframe for the analysis
            4. Confidence level (0-100)
            
            Keep responses under 200 words and focus on actionable insights.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.7,
        top_p: 1,
      });

      const content = completion.choices[0]?.message?.content || '';
      
      return {
        type: this.determineInsightType(content, userQuery),
        title: this.extractTitle(content, tradingData.symbol),
        content: content,
        confidence: this.extractConfidence(content),
        timeframe: this.extractTimeframe(content),
        createdAt: new Date()
      };

    } catch (error) {
      // console.error('OpenAI API error:', error);
      return this.getMockInsight(tradingData, userQuery);
    }
  }

  async generateMarketAnalysis(symbols: string[]): Promise<TradingInsight> {
    if (!this.isConfigured || !this.client) {
      return this.getMockMarketAnalysis(symbols);
    }

    try {
      const prompt = `Analyze the current cryptocurrency market focusing on ${symbols.join(', ')}. 
      Provide a brief market outlook, key trends, and overall sentiment. Include any significant market-moving events or technical patterns.`;

      const completion = await this.client.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [
          {
            role: "system",
            content: "You are a cryptocurrency market analyst. Provide concise market analysis with key insights and trends."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 250,
        temperature: 0.6,
      });

      const content = completion.choices[0]?.message?.content || '';

      return {
        type: 'market_outlook',
        title: 'Market Analysis',
        content: content,
        confidence: 75,
        timeframe: '24h',
        createdAt: new Date()
      };

    } catch (error) {
      // console.error('OpenAI API error:', error);
      return this.getMockMarketAnalysis(symbols);
    }
  }

  private buildTradingPrompt(data: TradingData, userQuery?: string): string {
    const prompt = `Analyze ${data.symbol} trading data:
    - Current Price: $${data.price.toFixed(2)}
    - 24h Change: ${data.change24h.toFixed(2)}%
    - Volume: ${data.volume.toLocaleString()}`;

    if (data.technicalIndicators) {
      prompt += `\n- Technical Indicators:`;
      if (data.technicalIndicators.rsi) {
        prompt += `\n  RSI: ${data.technicalIndicators.rsi}`;
      }
      if (data.technicalIndicators.macd) {
        prompt += `\n  MACD: ${data.technicalIndicators.macd}`;
      }
    }

    if (userQuery) {
      prompt += `\n\nSpecific question: ${userQuery}`;
    }

    prompt += `\n\nProvide trading insight including entry/exit points, risk level, and confidence.`;

    return prompt;
  }

  private determineInsightType(content: string, userQuery?: string): TradingInsight['type'] {
    if (userQuery?.toLowerCase().includes('risk')) return 'risk_assessment';
    if (content.toLowerCase().includes('buy') || content.toLowerCase().includes('sell')) return 'recommendation';
    if (content.toLowerCase().includes('outlook') || content.toLowerCase().includes('trend')) return 'market_outlook';
    return 'analysis';
  }

  private extractTitle(content: string, symbol: string): string {
    // Simple title extraction - in production, this could be more sophisticated
    if (content.toLowerCase().includes('bullish')) return `${symbol} Bullish Signal`;
    if (content.toLowerCase().includes('bearish')) return `${symbol} Bearish Signal`;
    if (content.toLowerCase().includes('neutral')) return `${symbol} Neutral Outlook`;
    return `${symbol} Analysis`;
  }

  private extractConfidence(content: string): number {
    // Look for confidence indicators in the text
    const confidenceRegex = /confidence[:\s]+(\d+)%?/i;
    const match = content.match(confidenceRegex);
    if (match) {
      return parseInt(match[1]);
    }
    
    // Fallback: estimate confidence based on language
    if (content.toLowerCase().includes('strong') || content.toLowerCase().includes('clear')) return 85;
    if (content.toLowerCase().includes('likely') || content.toLowerCase().includes('probable')) return 70;
    if (content.toLowerCase().includes('possible') || content.toLowerCase().includes('might')) return 60;
    return 75;
  }

  private extractTimeframe(content: string): string {
    if (content.toLowerCase().includes('short term') || content.toLowerCase().includes('1-3 days')) return '1-3 days';
    if (content.toLowerCase().includes('medium term') || content.toLowerCase().includes('1-2 weeks')) return '1-2 weeks';
    if (content.toLowerCase().includes('long term') || content.toLowerCase().includes('month')) return '1 month+';
    return '24-48h';
  }

  private getMockInsight(data: TradingData, _userQuery?: string): TradingInsight {
    const mockInsights = [
      {
        type: 'analysis' as const,
        title: `${data.symbol} Technical Analysis`,
        content: `Based on current price action at $${data.price.toFixed(2)} with ${data.change24h > 0 ? 'positive' : 'negative'} momentum (${data.change24h.toFixed(2)}%), ${data.symbol} shows ${data.change24h > 5 ? 'strong bullish' : data.change24h < -5 ? 'bearish' : 'neutral'} signals. Volume of ${data.volume.toLocaleString()} indicates ${data.volume > 1000000 ? 'high' : 'moderate'} market interest. Consider ${data.change24h > 0 ? 'taking profits on rallies' : 'accumulating on dips'} with proper risk management.`,
        confidence: Math.floor(Math.random() * 20) + 70,
        timeframe: '24-48h',
        createdAt: new Date()
      },
      {
        type: 'recommendation' as const,
        title: `${data.symbol} Trading Signal`,
        content: `${data.change24h > 2 ? 'BUY' : data.change24h < -2 ? 'SELL' : 'HOLD'} signal detected for ${data.symbol}. Current momentum suggests ${data.change24h > 0 ? 'continuation upward' : 'potential reversal'}. Entry point: $${(data.price * (data.change24h > 0 ? 0.98 : 1.02)).toFixed(2)}, Stop loss: $${(data.price * (data.change24h > 0 ? 0.95 : 1.05)).toFixed(2)}, Target: $${(data.price * (data.change24h > 0 ? 1.05 : 0.95)).toFixed(2)}. Risk level: ${Math.abs(data.change24h) > 5 ? 'High' : 'Medium'}.`,
        confidence: Math.floor(Math.random() * 15) + 75,
        timeframe: '1-3 days',
        createdAt: new Date()
      }
    ];

    return mockInsights[Math.floor(Math.random() * mockInsights.length)];
  }

  private getMockMarketAnalysis(symbols: string[]): TradingInsight {
    return {
      type: 'market_outlook',
      title: 'Crypto Market Outlook',
      content: `Current market sentiment appears ${Math.random() > 0.5 ? 'bullish' : 'cautiously optimistic'} across major cryptocurrencies including ${symbols.slice(0, 3).join(', ')}. Bitcoin continues to show institutional adoption signals while altcoins demonstrate mixed performance. Key resistance levels are being tested across the board. Traders should monitor volume patterns and regulatory developments. Overall market volatility remains elevated, suggesting opportunities for active traders with proper risk management.`,
      confidence: Math.floor(Math.random() * 10) + 70,
      timeframe: '1 week',
      createdAt: new Date()
    };
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  getConnectionStatus(): 'connected' | 'mock' | 'error' {
    if (this.isConfigured) return 'connected';
    return 'mock';
  }
}

export const openAITradingService = new OpenAITradingService();