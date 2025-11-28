import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface Trade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  timestamp: string;
  pnl?: number;
  status: 'open' | 'closed';
}

interface Props {
  strategyId: string;
}

export default function PaperTradingDashboard({ strategyId }: Props) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pnl, setPnl] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000); // Update every 3 seconds
    return () => clearInterval(interval);
  }, [strategyId]);

  const fetchData = async () => {
    try {
      const token = getAccessToken();
      
      // Fetch trades
      const tradesResponse = await axios.get(
        `${API_BASE_URL}/api/paper-trading-v2/trades?strategyId=${strategyId}&limit=20`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (tradesResponse.data.success) {
        setTrades(tradesResponse.data.trades || []);
      }
      
      // Fetch P&L
      const pnlResponse = await axios.get(
        `${API_BASE_URL}/api/paper-trading-v2/pnl?strategyId=${strategyId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (pnlResponse.data.success) {
        setPnl(pnlResponse.data.pnl);
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error fetching paper trading data:', err);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* P&L Summary */}
      {pnl && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center gap-2 text-gray-600 text-sm mb-2">
              <DollarSign size={16} />
              <span>Total P&L</span>
            </div>
            <p className={`text-2xl font-bold ${pnl.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {pnl.totalPnL >= 0 ? '+' : ''}${pnl.totalPnL?.toFixed(2) || '0.00'}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center gap-2 text-gray-600 text-sm mb-2">
              <TrendingUp size={16} />
              <span>Realized P&L</span>
            </div>
            <p className={`text-2xl font-bold ${pnl.realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {pnl.realizedPnL >= 0 ? '+' : ''}${pnl.realizedPnL?.toFixed(2) || '0.00'}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center gap-2 text-gray-600 text-sm mb-2">
              <Activity size={16} />
              <span>Win Rate</span>
            </div>
            <p className="text-2xl font-bold text-blue-600">
              {((pnl.winRate || 0) * 100).toFixed(1)}%
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center gap-2 text-gray-600 text-sm mb-2">
              <Clock size={16} />
              <span>Total Trades</span>
            </div>
            <p className="text-2xl font-bold text-purple-600">
              {pnl.totalTrades || 0}
            </p>
          </div>
        </div>
      )}

      {/* Trade Feed */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Activity size={20} />
            Live Trade Feed
          </h3>
        </div>
        
        <div className="divide-y max-h-96 overflow-y-auto">
          {trades.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Activity size={48} className="mx-auto mb-3 opacity-30" />
              <p>No trades yet</p>
              <p className="text-sm mt-1">Trades will appear here when paper trading is active</p>
            </div>
          ) : (
            trades.map((trade, idx) => (
              <div key={idx} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${
                      trade.side === 'BUY' ? 'bg-green-100' : 'bg-red-100'
                    }`}>
                      {trade.side === 'BUY' ? (
                        <TrendingUp className="text-green-600" size={16} />
                      ) : (
                        <TrendingDown className="text-red-600" size={16} />
                      )}
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${
                          trade.side === 'BUY' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {trade.side}
                        </span>
                        <span className="text-gray-900 font-medium">{trade.symbol}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          trade.status === 'open' 
                            ? 'bg-blue-100 text-blue-700' 
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {trade.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {trade.quantity} @ ${trade.price.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    {trade.pnl !== undefined && (
                      <div className={`text-lg font-bold ${
                        trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(trade.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Performance Chart Placeholder */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance Chart</h3>
        <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <div className="text-center text-gray-500">
            <Activity size={48} className="mx-auto mb-3 opacity-30" />
            <p>Performance chart coming soon</p>
            <p className="text-sm mt-1">Real-time P&L visualization</p>
          </div>
        </div>
      </div>
    </div>
  );
}
