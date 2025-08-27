import React, { useState, useEffect } from 'react';
import { Brain, TrendingUp, AlertTriangle, Clock, Zap, RefreshCw } from 'lucide-react';
import { openAITradingService, TradingInsight, TradingData } from '../services/openAIService';

interface TradingInsightsProps {
  symbol?: string;
  price?: number;
  change24h?: number;
  volume?: number;
  className?: string;
}

const TradingInsights: React.FC<TradingInsightsProps> = ({
  symbol = 'BTC-USDT',
  price = 41704,
  change24h = -5.91,
  volume = 569500,
  className = ''
}) => {
  const [insights, setInsights] = useState<TradingInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [userQuery, setUserQuery] = useState('');

  // Load initial insights
  useEffect(() => {
    generateInsight();
  }, [symbol, price]);

  const generateInsight = async (customQuery?: string) => {
    setLoading(true);
    setError(null);

    try {
      const tradingData: TradingData = {
        symbol,
        price,
        change24h,
        volume,
        technicalIndicators: {
          rsi: Math.random() * 100,
          macd: (Math.random() - 0.5) * 10
        }
      };

      const insight = await openAITradingService.generateTradingInsight(
        tradingData,
        customQuery
      );

      setInsights(prev => [insight, ...prev.slice(0, 4)]); // Keep last 5 insights
    } catch (err) {
      setError('Failed to generate trading insight');
      // console.error('Trading insight error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomQuery = async () => {
    if (!userQuery.trim()) return;
    await generateInsight(userQuery);
    setUserQuery('');
  };

  const getInsightIcon = (type: TradingInsight['type']) => {
    switch (type) {
      case 'recommendation':
        return <TrendingUp className="h-4 w-4" />;
      case 'risk_assessment':
        return <AlertTriangle className="h-4 w-4" />;
      case 'market_outlook':
        return <Brain className="h-4 w-4" />;
      default:
        return <Zap className="h-4 w-4" />;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-600';
    if (confidence >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const connectionStatus = openAITradingService.getConnectionStatus();

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 ${className}`}>
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Brain className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">AI Trading Insights</h3>
            <div className={`px-2 py-1 rounded-full text-xs font-medium ${
              connectionStatus === 'connected' 
                ? 'bg-green-100 text-green-800' 
                : 'bg-yellow-100 text-yellow-800'
            }`}>
              {connectionStatus === 'connected' ? '🤖 GPT-4.1' : '🧪 Mock'}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => generateInsight()}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
              title="Refresh insights"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-sm text-blue-600 hover:text-blue-800 focus:outline-none focus:underline"
            >
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        {connectionStatus === 'mock' && (
          <p className="text-xs text-gray-500 mt-2">
            Add VITE_OPENAI_API_KEY to enable real GPT-4.1 insights
          </p>
        )}
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {isExpanded && (
          <div className="mb-4 p-3 bg-gray-50 rounded-md">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ask AI about {symbol}:
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder={`Ask AI about ${symbol} (e.g., risk level, buy now?)`}
                className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyPress={(e) => e.key === 'Enter' && handleCustomQuery()}
              />
              <button
                onClick={handleCustomQuery}
                disabled={loading || !userQuery.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Ask
              </button>
            </div>
          </div>
        )}

        {loading && insights.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="ml-2 text-sm text-gray-600">Generating insights...</span>
          </div>
        )}

        <div className="space-y-3">
          {insights.map((insight, index) => (
            <div key={index} className="border border-gray-200 rounded-md p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center space-x-2">
                  {getInsightIcon(insight.type)}
                  <h4 className="text-sm font-medium text-gray-900">{insight.title}</h4>
                </div>
                <div className="flex items-center space-x-2 text-xs text-gray-500">
                  <Clock className="h-3 w-3" />
                  <span>{insight.timeframe}</span>
                  <span className={`font-medium ${getConfidenceColor(insight.confidence)}`}>
                    {insight.confidence}%
                  </span>
                </div>
              </div>
              
              <p className="text-sm text-gray-600 leading-relaxed">{insight.content}</p>
              
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  insight.type === 'recommendation' ? 'bg-blue-100 text-blue-800' :
                  insight.type === 'risk_assessment' ? 'bg-red-100 text-red-800' :
                  insight.type === 'market_outlook' ? 'bg-purple-100 text-purple-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {insight.type.replace('_', ' ').toUpperCase()}
                </span>
                <span className="text-xs text-gray-400">
                  {insight.createdAt.toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}

          {insights.length === 0 && !loading && (
            <div className="text-center py-6 text-gray-500">
              <Brain className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No insights yet. Click refresh to generate AI analysis.</p>
            </div>
          )}
        </div>

        {!isExpanded && insights.length > 0 && (
          <div className="mt-3 text-center">
            <button
              onClick={() => setIsExpanded(true)}
              className="text-xs text-blue-600 hover:text-blue-800 focus:outline-none focus:underline"
            >
              View more insights and ask questions
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TradingInsights;