import React, { useState, useEffect } from 'react';
import { Shield, Clock, AlertCircle } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import StrategyControlPanel from './StrategyControlPanel';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app' 
    : 'http://localhost:3000');

interface Strategy {
  id: string;
  strategy_name: string;
  status: string;
  backtest_score: number;
  paper_trading_score?: number;
  risk_level: 'low' | 'medium' | 'high';
  requires_approval: boolean;
  created_at: Date;
}

interface StrategyApprovalQueueProps {
  agentStatus?: string;
}

const StrategyApprovalQueue: React.FC<StrategyApprovalQueueProps> = ({ agentStatus }) => {
  const [pendingStrategies, setPendingStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPendingStrategies();
    
    if (agentStatus === 'running') {
      const interval = setInterval(() => {
        fetchPendingStrategies();
      }, 10000); // Check every 10 seconds

      return () => clearInterval(interval);
    }
  }, [agentStatus]);

  const fetchPendingStrategies = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(`${API_BASE_URL}/api/agent/strategies/pending-approval`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        setPendingStrategies(response.data.strategies);
      }
    } catch (err: any) {
      console.error('Error fetching pending strategies:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading approval queue...</p>
      </div>
    );
  }

  if (pendingStrategies.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          No Strategies Pending Approval
        </h3>
        <p className="text-gray-500">
          Strategies requiring manual approval will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8" />
            <div>
              <h3 className="text-2xl font-bold">Strategy Approval Queue</h3>
              <p className="text-sm opacity-90 mt-1">
                {pendingStrategies.length} {pendingStrategies.length === 1 ? 'strategy' : 'strategies'} awaiting review
              </p>
            </div>
          </div>
          <div className="bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 border-2 border-white">
            <span className="text-2xl font-bold">{pendingStrategies.length}</span>
          </div>
        </div>
      </div>

      {/* Pending Strategies List */}
      <div className="p-6 space-y-4">
        {pendingStrategies.map((strategy) => (
          <div key={strategy.id} className="border-l-4 border-orange-500 pl-4">
            <div className="flex items-start gap-3 mb-3">
              <Clock className="w-5 h-5 text-orange-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="text-sm text-gray-600">
                  Pending since {new Date(strategy.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            <StrategyControlPanel 
              strategy={strategy} 
              onUpdate={fetchPendingStrategies}
            />
          </div>
        ))}
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border-t border-blue-200 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">Manual Approval Required</p>
            <p className="text-blue-700">
              High-risk strategies or those with unusual parameters require manual approval before 
              proceeding to paper trading. Review the backtest results and risk parameters carefully 
              before approving.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StrategyApprovalQueue;
