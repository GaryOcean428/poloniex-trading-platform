/**
 * QIG Prediction Card Component
 * 
 * Displays QIG-enhanced predictions with comparison to baseline
 */

import React, { useState, useEffect } from 'react';
import { QIGMetricsPanel } from './QIGMetricsPanel';

interface Prediction {
  price: number;
  confidence: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

interface QIGMetrics {
  surprise: number;
  integration: number;
  confidence: number;
  regime: 'LINEAR' | 'GEOMETRIC' | 'BREAKDOWN';
  attentionWeights: Record<string, number>;
  statePurity: number;
}

interface QIGPredictionData {
  symbol: string;
  currentPrice: number;
  timestamp: number;
  predictions: {
    '1h': Prediction;
    '4h': Prediction;
    '24h': Prediction;
  };
  qigMetrics: QIGMetrics;
  explanation: string;
}

interface QIGPredictionCardProps {
  symbol: string;
  apiUrl: string;
  authToken: string;
}

export const QIGPredictionCard: React.FC<QIGPredictionCardProps> = ({ 
  symbol, 
  apiUrl, 
  authToken 
}) => {
  const [data, setData] = useState<QIGPredictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMetrics, setShowMetrics] = useState(true);

  useEffect(() => {
    fetchPredictions();
    // Refresh every 5 minutes
    const interval = setInterval(fetchPredictions, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [symbol]);

  const fetchPredictions = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${apiUrl}/api/qig/predictions/${symbol}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch predictions: ${response.statusText}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
      // console.error('QIG prediction fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getDirectionColor = (direction: string): string => {
    switch (direction) {
      case 'BULLISH': return 'text-green-600';
      case 'BEARISH': return 'text-red-600';
      case 'NEUTRAL': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  const getDirectionIcon = (direction: string): string => {
    switch (direction) {
      case 'BULLISH': return '↗';
      case 'BEARISH': return '↘';
      case 'NEUTRAL': return '→';
      default: return '?';
    }
  };

  const formatPrice = (price: number): string => {
    return price.toFixed(2);
  };

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  if (loading && !data) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-48 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="text-red-600">
          <h3 className="font-semibold mb-2">Error Loading QIG Predictions</h3>
          <p className="text-sm">{error}</p>
          <button
            onClick={fetchPredictions}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{symbol}</h2>
            <p className="text-sm text-gray-500">
              QIG-Enhanced Predictions • Updated {formatTimestamp(data.timestamp)}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Current Price</div>
            <div className="text-2xl font-bold text-gray-900">
              ${formatPrice(data.currentPrice)}
            </div>
          </div>
        </div>

        {/* Predictions Grid */}
        <div className="grid grid-cols-3 gap-4">
          {/* 1h Prediction */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-2">1 Hour</div>
            <div className={`text-xl font-bold ${getDirectionColor(data.predictions['1h'].direction)}`}>
              {getDirectionIcon(data.predictions['1h'].direction)} ${formatPrice(data.predictions['1h'].price)}
            </div>
            <div className="text-sm text-gray-600 mt-2">
              Confidence: {data.predictions['1h'].confidence}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {data.predictions['1h'].direction}
            </div>
          </div>

          {/* 4h Prediction */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-2">4 Hours</div>
            <div className={`text-xl font-bold ${getDirectionColor(data.predictions['4h'].direction)}`}>
              {getDirectionIcon(data.predictions['4h'].direction)} ${formatPrice(data.predictions['4h'].price)}
            </div>
            <div className="text-sm text-gray-600 mt-2">
              Confidence: {data.predictions['4h'].confidence}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {data.predictions['4h'].direction}
            </div>
          </div>

          {/* 24h Prediction */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-2">24 Hours</div>
            <div className={`text-xl font-bold ${getDirectionColor(data.predictions['24h'].direction)}`}>
              {getDirectionIcon(data.predictions['24h'].direction)} ${formatPrice(data.predictions['24h'].price)}
            </div>
            <div className="text-sm text-gray-600 mt-2">
              Confidence: {data.predictions['24h'].confidence}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {data.predictions['24h'].direction}
            </div>
          </div>
        </div>

        {/* Toggle Metrics Button */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setShowMetrics(!showMetrics)}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
          >
            {showMetrics ? '▼ Hide QIG Metrics' : '▶ Show QIG Metrics'}
          </button>
        </div>
      </div>

      {/* QIG Metrics Panel */}
      {showMetrics && (
        <QIGMetricsPanel 
          metrics={data.qigMetrics} 
          explanation={data.explanation}
        />
      )}
    </div>
  );
};

export default QIGPredictionCard;
