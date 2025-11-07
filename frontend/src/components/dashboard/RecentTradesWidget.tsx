import React, { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, RefreshCw, AlertCircle, History } from 'lucide-react';
import { dashboardService, Trade } from '../../services/dashboardService';

const RecentTradesWidget: React.FC = () => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTrades = async () => {
    try {
      setError(null);
      const data = await dashboardService.getTrades({ limit: 10 });
      setTrades(data);
    } catch (err: any) {
      setError(err.message);
      console.error('Failed to fetch trades:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTrades();
    
    // Auto-refresh every 15 seconds
    const interval = setInterval(fetchTrades, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchTrades();
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

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getSideColor = (side: string) => {
    return side === 'BUY' ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100';
  };

  const getSideIcon = (side: string) => {
    return side === 'BUY' 
      ? <ArrowUpRight className="w-4 h-4" />
      : <ArrowDownRight className="w-4 h-4" />;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Recent Trades</h3>
          <History className="w-6 h-6 text-blue-600" />
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-12 bg-gray-200 rounded"></div>
          <div className="h-12 bg-gray-200 rounded"></div>
          <div className="h-12 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Recent Trades</h3>
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
            <p className="font-medium">Unable to load trades</p>
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
          Recent Trades ({trades.length})
        </h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          title="Refresh trades"
        >
          <RefreshCw className={`w-5 h-5 text-gray-600 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No recent trades</p>
          </div>
        ) : (
          trades.map((trade) => (
            <div
              key={trade.id}
              className="border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-full font-medium ${getSideColor(trade.side)}`}>
                    {getSideIcon(trade.side)}
                    <span>{trade.side}</span>
                  </span>
                  <span className="font-semibold text-gray-900">{trade.symbol}</span>
                </div>
                <span className="text-xs text-gray-600">{formatTime(trade.time)}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-gray-600">Price</p>
                  <p className="font-medium">{formatCurrency(trade.price)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Quantity</p>
                  <p className="font-medium">{parseFloat(trade.qty).toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">P&L</p>
                  <p className={`font-medium ${parseFloat(trade.realizedPnl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(trade.realizedPnl)}
                  </p>
                </div>
              </div>

              <div className="mt-2 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>Order #{trade.orderId}</span>
                  <span>Fee: {formatCurrency(trade.commission)} {trade.commissionAsset}</span>
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

export default RecentTradesWidget;
