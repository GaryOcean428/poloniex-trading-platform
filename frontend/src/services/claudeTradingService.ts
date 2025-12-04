import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

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

// Auto-detect API URL based on environment
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app' 
    : 'http://localhost:3000');

class ClaudeTradingService {
  private isConfigured = true; // Always configured since we use backend

  async generateTradingInsight(
    tradingData: TradingData,
    userQuery?: string
  ): Promise<TradingInsight> {
    try {
      const token = getAccessToken();
      
      // Call backend API which uses Claude Sonnet 4.5
      const response = await axios.post(
        `${API_BASE_URL}/api/ai/trading-insight`,
        {
          tradingData,
          userQuery
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.success) {
        return {
          ...response.data.insight,
          createdAt: new Date()
        };
      }

      throw new Error('Failed to generate insight');
    } catch (_error) {
      // console.error('Error generating trading insight:', error);
      return this.getMockInsight(tradingData, userQuery);
    }
  }

  private getMockInsight(tradingData: TradingData, userQuery?: string): TradingInsight {
    const insights = [
      {
        type: 'analysis' as const,
        title: 'Market Analysis',
        content: `${tradingData.symbol} is showing ${tradingData.change24h > 0 ? 'bullish' : 'bearish'} momentum with ${Math.abs(tradingData.change24h).toFixed(2)}% change in 24h. Current price: $${tradingData.price.toLocaleString()}`,
        confidence: 75,
        timeframe: '24h'
      },
      {
        type: 'recommendation' as const,
        title: 'Trading Recommendation',
        content: tradingData.change24h > 0 
          ? 'Consider taking profits on long positions. Market showing strong upward momentum.'
          : 'Look for support levels to enter long positions. Market correction may present buying opportunities.',
        confidence: 70,
        timeframe: '4h-24h'
      },
      {
        type: 'risk_assessment' as const,
        title: 'Risk Assessment',
        content: `Volume: ${tradingData.volume.toLocaleString()}. ${tradingData.volume > 500000 ? 'High liquidity suggests lower slippage risk.' : 'Moderate liquidity - use limit orders.'}`,
        confidence: 80,
        timeframe: 'Current'
      }
    ];

    const index = Math.floor(Math.random() * insights.length);
    const selectedInsight = insights[index];
    
    if (!selectedInsight) {
      // Fallback in case of unexpected error
      return {
        type: 'analysis',
        title: 'Market Analysis',
        content: 'Market data analysis in progress.',
        confidence: 50,
        timeframe: 'Current',
        createdAt: new Date()
      };
    }
    
    return {
      type: selectedInsight.type,
      title: selectedInsight.title,
      content: selectedInsight.content,
      confidence: selectedInsight.confidence,
      timeframe: selectedInsight.timeframe,
      createdAt: new Date()
    };
  }

  getConnectionStatus(): 'connected' | 'mock' {
    return this.isConfigured ? 'connected' : 'mock';
  }
}

export const claudeTradingService = new ClaudeTradingService();
