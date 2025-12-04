import React, { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, TrendingDown, RefreshCw, AlertCircle } from 'lucide-react';
import { dashboardService, Balance } from '../../services/dashboardService';

const AccountBalanceWidget: React.FC = () => {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBalance = async () => {
    try {
      setError(null);
      const data = await dashboardService.getBalance();
      setBalance(data);
    } catch (err: any) {
      setError(err.message);
      // console.error('Failed to fetch balance:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchBalance();
  };

  const formatCurrency = (value: number | undefined) => {
    if (value === undefined || value === null) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const getPnLColor = (value: number) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const getPnLIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="w-4 h-4" />;
    if (value < 0) return <TrendingDown className="w-4 h-4" />;
    return null;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Account Balance</h3>
          <DollarSign className="w-6 h-6 text-blue-600" />
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-8 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Account Balance</h3>
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
            <p className="font-medium">Unable to load balance</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Account Balance</h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          title="Refresh balance"
        >
          <RefreshCw className={`w-5 h-5 text-gray-600 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-4">
        {/* Total Balance */}
        <div>
          <p className="text-sm text-gray-600 mb-1">Total Balance</p>
          <p className="text-3xl font-bold text-gray-900">
            {formatCurrency(balance?.totalBalance)}
          </p>
        </div>

        {/* Available Balance */}
        <div className="flex items-center justify-between py-2 border-t border-gray-200">
          <span className="text-sm text-gray-600">Available</span>
          <span className="text-sm font-semibold text-gray-900">
            {formatCurrency(balance?.availableBalance)}
          </span>
        </div>

        {/* Margin Balance */}
        <div className="flex items-center justify-between py-2 border-t border-gray-200">
          <span className="text-sm text-gray-600">Margin</span>
          <span className="text-sm font-semibold text-gray-900">
            {formatCurrency(balance?.marginBalance)}
          </span>
        </div>

        {/* Unrealized PnL */}
        <div className="flex items-center justify-between py-2 border-t border-gray-200">
          <span className="text-sm text-gray-600">Unrealized P&L</span>
          <div className={`flex items-center space-x-1 text-sm font-semibold ${getPnLColor(balance?.unrealizedPnL || 0)}`}>
            {getPnLIcon(balance?.unrealizedPnL || 0)}
            <span>{formatCurrency(balance?.unrealizedPnL)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Last updated: {new Date().toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
};

export default AccountBalanceWidget;
