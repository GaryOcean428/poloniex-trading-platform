import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Activity } from 'lucide-react';
import { dashboardService, Position } from '../../services/dashboardService';

const ActivePositionsWidget: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPositions = async () => {
    try {
      setError(null);
      const data = await dashboardService.getPositions();
      setPositions(data.positions);
      setSummary(data.summary);
    } catch (err: any) {
      setError(err.message);
      console.error('Failed to fetch positions:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPositions();
    
    // Auto-refresh every 10 seconds for positions
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPositions();
  };

  const formatNumber = (value: string | number, decimals: number = 2) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '0.00';
    return num.toFixed(decimals);
  };

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  };

  const getPnLColor = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (num > 0) return 'text-green-600 bg-green-50';
    if (num < 0) return 'text-red-600 bg-red-50';
    return 'text-gray-600 bg-gray-50';
  };

  const getSideColor = (side: string) => {
    return side === 'LONG' ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Active Positions</h3>
          <Activity className="w-6 h-6 text-blue-600" />
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-16 bg-gray-200 rounded"></div>
          <div className="h-16 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Active Positions</h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-gray-600 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-start space-x-3 text-amber-700 bg-amber-50 p-4 rounded-lg">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Unable to load positions</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Active Positions ({summary?.count || 0})
        </h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          title="Refresh positions"
        >
          <RefreshCw className={`w-5 h-5 text-gray-600 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
          <div>
            <p className="text-xs text-gray-600">Total Value</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(summary.totalValue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Total P&L</p>
            <p className={`text-lg font-semibold ${summary.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(summary.totalPnL)}
            </p>
          </div>
        </div>
      )}

      {/* Positions List */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {positions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Activity className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No active positions</p>
          </div>
        ) : (
          positions.map((position, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-gray-900">{position.symbol}</span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${getSideColor(position.positionSide)}`}>
                    {position.positionSide}
                  </span>
                  <span className="text-xs text-gray-600">
                    {position.leverage}x
                  </span>
                </div>
                <div className={`text-sm font-semibold px-2 py-1 rounded ${getPnLColor(position.unrealizedPnl)}`}>
                  {formatCurrency(position.unrealizedPnl)}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-gray-600">Size</p>
                  <p className="font-medium">{formatNumber(position.positionAmt, 4)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Entry</p>
                  <p className="font-medium">{formatNumber(position.entryPrice)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Mark</p>
                  <p className="font-medium">{formatNumber(position.markPrice)}</p>
                </div>
              </div>

              <div className="mt-2 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>Notional: {formatCurrency(position.notionalValue)}</span>
                  <span className="capitalize">{position.marginType}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Last updated: {new Date().toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
};

export default ActivePositionsWidget;
