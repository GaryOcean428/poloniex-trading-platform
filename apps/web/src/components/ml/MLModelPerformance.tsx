import React, { useState, useEffect } from 'react';
// Recharts imports available when chart features are implemented
// import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

// Auto-detect API base URL based on environment
const getApiBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname.includes('railway.app')) {
    return 'https://polytrade-be.up.railway.app';
  }
  return 'http://localhost:3000';
};

const API_BASE_URL = getApiBaseUrl();

// Interface available when prediction features are implemented
// interface ModelPrediction {
//   model: string;
//   prediction: number;
//   confidence: number;
//   timestamp: string;
// }

interface MLPerformanceData {
  symbol: string;
  predictions: {
    '1h': any;
    '4h': any;
    '24h': any;
  };
  signal: {
    signal: 'BUY' | 'SELL' | 'HOLD';
    strength: number;
    reason: string;
  };
  timestamp: string;
}

const MLModelPerformance: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [performanceData, setPerformanceData] = useState<MLPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMLPerformance();
    const interval = setInterval(fetchMLPerformance, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [symbol]);

  const fetchMLPerformance = async () => {
    try {
      setLoading(true);
      const token = getAccessToken();
      const response = await axios.get(
        `${API_BASE_URL}/api/ml/performance/${symbol}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        }
      );
      setPerformanceData(response.data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !performanceData) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/4 mb-4"></div>
          <div className="h-32 bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-red-400">
          <p className="font-semibold">ML Models Unavailable</p>
          <p className="text-sm mt-2">{error}</p>
          <button 
            onClick={fetchMLPerformance}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!performanceData) return null;

  const { predictions, signal } = performanceData;

  // Get signal color
  const signalColor = signal.signal === 'BUY' ? 'text-green-400' : 
                      signal.signal === 'SELL' ? 'text-red-400' : 'text-yellow-400';
  
  const signalBgColor = signal.signal === 'BUY' ? 'bg-green-900/30' : 
                        signal.signal === 'SELL' ? 'bg-red-900/30' : 'bg-yellow-900/30';

  return (
    <div className="bg-gray-800 rounded-lg p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold text-white">ML Model Predictions</h3>
        <span className="text-sm text-gray-400">{symbol}</span>
      </div>

      {/* Trading Signal */}
      <div className={`${signalBgColor} rounded-lg p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">Ensemble Signal</p>
            <p className={`text-2xl font-bold ${signalColor}`}>{signal.signal}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-400">Strength</p>
            <p className="text-2xl font-bold text-white">{(signal.strength * 100).toFixed(1)}%</p>
          </div>
        </div>
        <p className="text-sm text-gray-300 mt-2">{signal.reason}</p>
      </div>

      {/* Multi-Horizon Predictions */}
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(predictions).map(([horizon, pred]: [string, any]) => {
          if (pred.error) {
            return (
              <div key={horizon} className="bg-gray-700 rounded-lg p-4">
                <p className="text-sm text-gray-400">{horizon} Prediction</p>
                <p className="text-xs text-red-400 mt-2">Unavailable</p>
              </div>
            );
          }

          return (
            <div key={horizon} className="bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400">{horizon} Prediction</p>
              <p className="text-2xl font-bold text-white mt-2">
                ${pred.prediction?.toFixed(2) || 'N/A'}
              </p>
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Confidence</span>
                  <span className="text-blue-400">{((pred.confidence || 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Agreement</span>
                  <span className="text-green-400">{((pred.agreement || 0) * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Individual Model Predictions */}
      {predictions['1h'] && predictions['1h'].individual_predictions && (
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Individual Model Predictions (1h)</h4>
          <div className="grid grid-cols-5 gap-3">
            {Object.entries(predictions['1h'].individual_predictions).map(([model, prediction]: [string, any]) => (
              <div key={model} className="bg-gray-700 rounded p-3">
                <p className="text-xs text-gray-400 uppercase">{model}</p>
                <p className="text-lg font-bold text-white mt-1">
                  ${(prediction as number).toFixed(2)}
                </p>
                <p className="text-xs text-blue-400 mt-1">
                  {((predictions['1h'].individual_confidences[model] || 0) * 100).toFixed(0)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model Weights */}
      {predictions['1h'] && predictions['1h'].weights && (
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Model Weights</h4>
          <div className="space-y-2">
            {Object.entries(predictions['1h'].weights).map(([model, weight]: [string, any]) => (
              <div key={model} className="flex items-center">
                <span className="text-sm text-gray-400 w-24 uppercase">{model}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full" 
                    style={{ width: `${(weight as number) * 100}%` }}
                  ></div>
                </div>
                <span className="text-sm text-gray-300 ml-3 w-12 text-right">
                  {((weight as number) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Updated */}
      <div className="text-xs text-gray-500 text-right">
        Last updated: {new Date(performanceData.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
};

export default MLModelPerformance;
