/**
 * QIG Dashboard Page
 * 
 * Main dashboard for viewing QIG-enhanced predictions
 */

import React, { useState } from 'react';
import { QIGPredictionCard } from '../components/QIGPredictionCard';

const QIGDashboard: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTC_USDT');
  
  // Get API URL and auth token from environment/context
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8765';
  const authToken = localStorage.getItem('authToken') || '';

  const symbols = [
    'BTC_USDT',
    'ETH_USDT',
    'SOL_USDT',
    'DOGE_USDT',
    'XRP_USDT'
  ];

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            QIG-Enhanced Trading Predictions
          </h1>
          <p className="text-gray-600">
            Quantum Information Geometry powered market analysis with regime-adaptive strategies
          </p>
        </div>

        {/* Symbol Selector */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Trading Pair
          </label>
          <div className="flex gap-2 flex-wrap">
            {symbols.map(symbol => (
              <button
                key={symbol}
                onClick={() => setSelectedSymbol(symbol)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedSymbol === symbol
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {symbol.replace('_', '/')}
              </button>
            ))}
          </div>
        </div>

        {/* QIG Prediction Card */}
        <QIGPredictionCard
          symbol={selectedSymbol}
          apiUrl={apiUrl}
          authToken={authToken}
        />

        {/* Info Section */}
        <div className="mt-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            About QIG-Enhanced Predictions
          </h2>
          <div className="space-y-4 text-gray-600">
            <p>
              QIG (Quantum Information Geometry) predictions use advanced information-theoretic principles
              to analyze market dynamics and adapt trading strategies based on market regime.
            </p>
            <div className="grid md:grid-cols-3 gap-4 mt-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-semibold text-green-900 mb-2">📈 LINEAR Regime</h3>
                <p className="text-sm text-green-800">
                  Stable, predictable markets. Uses simple trend-following strategies with high confidence.
                </p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">🔷 GEOMETRIC Regime</h3>
                <p className="text-sm text-blue-800">
                  Complex market patterns. Employs full multi-indicator analysis with attention-weighted synthesis.
                </p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h3 className="font-semibold text-red-900 mb-2">⚠️ BREAKDOWN Regime</h3>
                <p className="text-sm text-red-800">
                  High volatility and instability. Activates risk-off mode with conservative predictions.
                </p>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t">
              <h3 className="font-semibold text-gray-900 mb-2">Key Advantages</h3>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Adaptive complexity: Simple strategies in stable markets, complex analysis when needed</li>
                <li>Explainable AI: QIG metrics explain why confidence is high or low</li>
                <li>Natural sparsity: Physics determines which indicators matter most</li>
                <li>Regime awareness: Automatic risk reduction in volatile conditions</li>
                <li>Attention mechanism: Dynamic indicator weighting based on distinguishability</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QIGDashboard;
