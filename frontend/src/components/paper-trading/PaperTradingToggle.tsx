import React, { useState, useEffect } from 'react';
import { Play, Square, Loader, TrendingUp, DollarSign } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { useTradingContext } from '@/hooks/useTradingContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface Props {
  strategyId: string;
  strategyName: string;
  onStatusChange?: (active: boolean) => void;
}

interface PaperTradingStatus {
  active: boolean;
  session?: {
    id: string;
    strategyId: string;
    symbol: string;
    initialCapital: number;
    currentCapital: number;
    totalPnL: number;
    winRate: number;
    totalTrades: number;
  };
}

export default function PaperTradingToggle({ strategyId, strategyName, onStatusChange }: Props) {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<PaperTradingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { accountBalance } = useTradingContext();

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [strategyId]);

  const fetchStatus = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(
        `${API_BASE_URL}/api/paper-trading-v2/status?strategyId=${strategyId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        setStatus(response.data.status);
        setActive(response.data.status.active);
      }
    } catch (_err) {
      // console.error('Error fetching paper trading status:', err);
    }
  };

  const toggle = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = getAccessToken();
      
      if (active) {
        // Stop paper trading
        await axios.post(
          `${API_BASE_URL}/api/paper-trading-v2/stop`,
          { strategyId },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setActive(false);
        if (onStatusChange) onStatusChange(false);
      } else {
        // Start paper trading with real account balance
        // Use total balance from account, fallback to 10000 if not available
        const initialCapital = accountBalance?.total || 10000;
        
        await axios.post(
          `${API_BASE_URL}/api/paper-trading-v2/start`,
          { 
            strategyId,
            symbol: 'BTC_USDT',
            initialCapital
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setActive(true);
        if (onStatusChange) onStatusChange(true);
      }
      
      // Refresh status
      await fetchStatus();
      
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle paper trading');
      // console.error('Error toggling paper trading:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="font-semibold text-gray-900">Paper Trading</h4>
          <p className="text-sm text-gray-600">{strategyName}</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
        }`}>
          {active ? 'Active' : 'Inactive'}
        </div>
      </div>

      {/* Status Display */}
      {active && status?.session && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 text-blue-700 text-xs mb-1">
              <DollarSign size={14} />
              <span>Current Capital</span>
            </div>
            <p className="text-lg font-bold text-blue-900">
              ${status.session.currentCapital.toFixed(2)}
            </p>
          </div>
          
          <div className={`p-3 rounded-lg ${
            status.session.totalPnL >= 0 ? 'bg-green-50' : 'bg-red-50'
          }`}>
            <div className={`flex items-center gap-2 text-xs mb-1 ${
              status.session.totalPnL >= 0 ? 'text-green-700' : 'text-red-700'
            }`}>
              <TrendingUp size={14} />
              <span>Total P&L</span>
            </div>
            <p className={`text-lg font-bold ${
              status.session.totalPnL >= 0 ? 'text-green-900' : 'text-red-900'
            }`}>
              {status.session.totalPnL >= 0 ? '+' : ''}${status.session.totalPnL.toFixed(2)}
            </p>
          </div>
          
          <div className="p-3 bg-purple-50 rounded-lg">
            <div className="text-purple-700 text-xs mb-1">Win Rate</div>
            <p className="text-lg font-bold text-purple-900">
              {(status.session.winRate * 100).toFixed(1)}%
            </p>
          </div>
          
          <div className="p-3 bg-indigo-50 rounded-lg">
            <div className="text-indigo-700 text-xs mb-1">Total Trades</div>
            <p className="text-lg font-bold text-indigo-900">
              {status.session.totalTrades}
            </p>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={toggle}
        disabled={loading}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
          active
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-green-600 hover:bg-green-700 text-white'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {loading ? (
          <>
            <Loader className="animate-spin" size={16} />
            {active ? 'Stopping...' : 'Starting...'}
          </>
        ) : active ? (
          <>
            <Square size={16} />
            Stop Paper Trading
          </>
        ) : (
          <>
            <Play size={16} />
            Start Paper Trading
          </>
        )}
      </button>

      {/* Error Display */}
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Info */}
      {!active && (
        <p className="mt-3 text-xs text-gray-500 text-center">
          Paper trading uses simulated funds to test your strategy
        </p>
      )}
    </div>
  );
}
