/**
 * QIG Metrics Panel Component
 * 
 * Displays Quantum Information Geometry metrics for trading predictions:
 * - Surprise (QFI distance)
 * - Integration (Φ - indicator coherence)
 * - Confidence (state purity × accuracy)
 * - Regime (LINEAR/GEOMETRIC/BREAKDOWN)
 * - Attention weights (dynamic indicator importance)
 */

import React from 'react';

interface QIGMetrics {
  surprise: number;
  integration: number;
  confidence: number;
  regime: 'LINEAR' | 'GEOMETRIC' | 'BREAKDOWN';
  attentionWeights: Record<string, number>;
  statePurity: number;
}

interface QIGMetricsPanelProps {
  metrics: QIGMetrics;
  explanation?: string;
}

export const QIGMetricsPanel: React.FC<QIGMetricsPanelProps> = ({ metrics, explanation }) => {
  // Helper to format percentage
  const formatPercent = (value: number): string => {
    return `${(value * 100).toFixed(1)}%`;
  };

  // Helper to get color based on value
  const getConfidenceColor = (value: number): string => {
    if (value >= 0.7) return 'text-green-600';
    if (value >= 0.4) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSurpriseColor = (value: number): string => {
    if (value <= 0.3) return 'text-green-600';
    if (value <= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getRegimeColor = (regime: string): string => {
    switch (regime) {
      case 'LINEAR': return 'bg-green-100 text-green-800 border-green-300';
      case 'GEOMETRIC': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'BREAKDOWN': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getRegimeIcon = (regime: string): string => {
    switch (regime) {
      case 'LINEAR': return '📈';
      case 'GEOMETRIC': return '🔷';
      case 'BREAKDOWN': return '⚠️';
      default: return '❓';
    }
  };

  // Sort attention weights by value (descending)
  const sortedWeights = Object.entries(metrics.attentionWeights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5); // Top 5 indicators

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          QIG Metrics
        </h3>
        <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getRegimeColor(metrics.regime)}`}>
          {getRegimeIcon(metrics.regime)} {metrics.regime}
        </span>
      </div>

      {/* Core Metrics Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Confidence */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Confidence</div>
          <div className={`text-2xl font-bold ${getConfidenceColor(metrics.confidence)}`}>
            {formatPercent(metrics.confidence)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Purity × Accuracy
          </div>
        </div>

        {/* Surprise */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Surprise</div>
          <div className={`text-2xl font-bold ${getSurpriseColor(metrics.surprise)}`}>
            {formatPercent(metrics.surprise)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            QFI Distance
          </div>
        </div>

        {/* Integration (Φ) */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Integration (Φ)</div>
          <div className={`text-2xl font-bold ${getConfidenceColor(metrics.integration)}`}>
            {formatPercent(metrics.integration)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Indicator Coherence
          </div>
        </div>

        {/* State Purity */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">State Purity</div>
          <div className={`text-2xl font-bold ${getConfidenceColor(metrics.statePurity)}`}>
            {formatPercent(metrics.statePurity)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Signal Clarity
          </div>
        </div>
      </div>

      {/* Attention Weights */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">
          Attention Weights (Top Indicators)
        </h4>
        <div className="space-y-2">
          {sortedWeights.map(([indicator, weight]) => (
            <div key={indicator} className="flex items-center">
              <div className="w-24 text-sm text-gray-600 uppercase">
                {indicator}
              </div>
              <div className="flex-1 mx-3">
                <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${weight * 100}%` }}
                  />
                </div>
              </div>
              <div className="w-12 text-sm font-medium text-gray-900 text-right">
                {formatPercent(weight)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Explanation */}
      {explanation && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Analysis
          </h4>
          <p className="text-sm text-gray-600 leading-relaxed">
            {explanation}
          </p>
        </div>
      )}

      {/* Regime Descriptions */}
      <div className="border-t pt-4">
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium">
            What do these metrics mean?
          </summary>
          <div className="mt-3 space-y-2 text-gray-600">
            <div>
              <strong className="text-gray-900">Confidence:</strong> How certain the prediction is, based on state purity and prediction accuracy.
            </div>
            <div>
              <strong className="text-gray-900">Surprise:</strong> How unexpected the current market state is compared to predictions. Low = predictable, High = unexpected.
            </div>
            <div>
              <strong className="text-gray-900">Integration (Φ):</strong> How well technical indicators agree with each other. High = strong consensus, Low = mixed signals.
            </div>
            <div>
              <strong className="text-gray-900">State Purity:</strong> How clear and definite the market signals are. High = clear trend, Low = noisy/mixed.
            </div>
            <div className="pt-2 border-t">
              <strong className="text-gray-900">Regimes:</strong>
              <ul className="mt-1 ml-4 space-y-1">
                <li><strong>LINEAR:</strong> Stable, predictable market. Simple strategies work well.</li>
                <li><strong>GEOMETRIC:</strong> Complex patterns. Requires full multi-indicator analysis.</li>
                <li><strong>BREAKDOWN:</strong> High volatility, unstable. Risk-off mode activated.</li>
              </ul>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

export default QIGMetricsPanel;
