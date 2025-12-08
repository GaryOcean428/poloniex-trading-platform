import React, { useState } from 'react';
import { Play, Loader, TrendingUp, TrendingDown, BarChart3, Calendar } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { useTradingContext } from '@/hooks/useTradingContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface BacktestConfig {
  strategyId: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  timeframe: string;
}

interface BacktestResults {
  winRate: number;
  profitFactor: number;
  totalReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWin: number;
  averageLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
  trades?: any[];
}

interface Props {
  strategyId: string;
  strategyName: string;
  onComplete?: (results: BacktestResults) => void;
}

export default function BacktestRunner({ strategyId, strategyName, onComplete }: Props) {
  const { accountBalance } = useTradingContext();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BacktestResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backtestId, setBacktestId] = useState<string | null>(null);
  
  // Use real account balance for initial capital, fallback to 10000 if not available
  const defaultInitialCapital = accountBalance?.total || 10000;
  
  const [config, setConfig] = useState<BacktestConfig>({
    strategyId,
    symbol: 'BTC_USDT',
    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] ?? '',
    endDate: new Date().toISOString().split('T')[0] ?? '',
    initialCapital: defaultInitialCapital,
    timeframe: '1h'
  });

  const runBacktest = async () => {
    setRunning(true);
    setError(null);
    setProgress(0);
    setResults(null);
    
    try {
      const token = getAccessToken();
      
      // Start backtest
      const response = await axios.post(
        `${API_BASE_URL}/api/backtest/run`,
        config,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      const id = response.data.id;
      setBacktestId(id);
      
      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const statusResponse = await axios.get(
            `${API_BASE_URL}/api/backtest/status/${id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          
          const status = statusResponse.data;
          setProgress(status.progress || 0);
          
          if (status.status === 'completed') {
            clearInterval(pollInterval);
            setResults(status.results);
            setRunning(false);
            if (onComplete) onComplete(status.results);
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            setError(status.error || 'Backtest failed');
            setRunning(false);
          }
        } catch (_pollError) {
          // console.error('Error polling backtest status:', pollError);
        }
      }, 1000);
      
      // Cleanup on unmount
      return () => clearInterval(pollInterval);
      
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start backtest');
      setRunning(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-900">Backtest: {strategyName}</h3>
        <BarChart3 className="text-blue-600" size={24} />
      </div>
      
      {/* Configuration */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Symbol
          </label>
          <select
            value={config.symbol}
            onChange={(e) => setConfig({...config, symbol: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={running}
          >
            <option value="BTC_USDT">BTC/USDT</option>
            <option value="ETH_USDT">ETH/USDT</option>
            <option value="SOL_USDT">SOL/USDT</option>
            <option value="BNB_USDT">BNB/USDT</option>
            <option value="XRP_USDT">XRP/USDT</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Timeframe
          </label>
          <select
            value={config.timeframe}
            onChange={(e) => setConfig({...config, timeframe: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={running}
          >
            <option value="5m">5 minutes</option>
            <option value="15m">15 minutes</option>
            <option value="1h">1 hour</option>
            <option value="4h">4 hours</option>
            <option value="1d">1 day</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Calendar size={16} className="inline mr-1" />
            Start Date
          </label>
          <input
            type="date"
            value={config.startDate}
            onChange={(e) => setConfig({...config, startDate: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={running}
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Calendar size={16} className="inline mr-1" />
            End Date
          </label>
          <input
            type="date"
            value={config.endDate}
            onChange={(e) => setConfig({...config, endDate: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={running}
          />
        </div>
        
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Initial Capital (USDT)
          </label>
          <input
            type="number"
            value={config.initialCapital}
            onChange={(e) => setConfig({...config, initialCapital: Number(e.target.value)})}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={running}
            min="100"
            step="100"
          />
        </div>
      </div>

      {/* Run Button */}
      <button
        onClick={runBacktest}
        disabled={running}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {running ? (
          <>
            <Loader className="animate-spin" size={20} />
            Running Backtest... {progress}%
          </>
        ) : (
          <>
            <Play size={20} />
            Run Backtest
          </>
        )}
      </button>

      {/* Progress Bar */}
      {running && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 font-medium">Error</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="mt-6 border-t pt-6">
          <h4 className="text-lg font-semibold mb-4 text-gray-900">Backtest Results</h4>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg border border-green-200">
              <div className="text-sm text-green-700 font-medium mb-1">Win Rate</div>
              <div className="text-2xl font-bold text-green-600">
                {(results.winRate * 100).toFixed(1)}%
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200">
              <div className="text-sm text-blue-700 font-medium mb-1">Profit Factor</div>
              <div className="text-2xl font-bold text-blue-600">
                {results.profitFactor.toFixed(2)}
              </div>
            </div>
            
            <div className={`p-4 rounded-lg border ${results.totalReturn >= 0 ? 'bg-gradient-to-br from-green-50 to-green-100 border-green-200' : 'bg-gradient-to-br from-red-50 to-red-100 border-red-200'}`}>
              <div className={`text-sm font-medium mb-1 ${results.totalReturn >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                Total Return
              </div>
              <div className={`text-2xl font-bold ${results.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {results.totalReturn >= 0 ? '+' : ''}{(results.totalReturn * 100).toFixed(2)}%
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg border border-purple-200">
              <div className="text-sm text-purple-700 font-medium mb-1">Total Trades</div>
              <div className="text-2xl font-bold text-purple-600">
                {results.totalTrades}
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg border border-indigo-200">
              <div className="text-sm text-indigo-700 font-medium mb-1">Sharpe Ratio</div>
              <div className="text-2xl font-bold text-indigo-600">
                {results.sharpeRatio.toFixed(2)}
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-br from-red-50 to-red-100 rounded-lg border border-red-200">
              <div className="text-sm text-red-700 font-medium mb-1">Max Drawdown</div>
              <div className="text-2xl font-bold text-red-600">
                -{(results.maxDrawdown * 100).toFixed(2)}%
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg border border-green-200">
              <div className="text-sm text-green-700 font-medium mb-1 flex items-center gap-1">
                <TrendingUp size={14} />
                Winning Trades
              </div>
              <div className="text-2xl font-bold text-green-600">
                {results.winningTrades}
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-br from-red-50 to-red-100 rounded-lg border border-red-200">
              <div className="text-sm text-red-700 font-medium mb-1 flex items-center gap-1">
                <TrendingDown size={14} />
                Losing Trades
              </div>
              <div className="text-2xl font-bold text-red-600">
                {results.losingTrades}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
