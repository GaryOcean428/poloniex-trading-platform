import React, { useState } from 'react';
import { CheckCircle, XCircle, Pause, Play, AlertTriangle, Settings, Shield } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app' 
    : 'http://localhost:3000');

interface Strategy {
  id: string;
  strategy_name: string;
  status: 'generated' | 'backtested' | 'paper_trading' | 'approved' | 'live' | 'paused' | 'retired';
  backtest_score: number;
  paper_trading_score?: number;
  risk_level: 'low' | 'medium' | 'high';
  requires_approval: boolean;
}

interface StrategyControlPanelProps {
  strategy: Strategy;
  onUpdate?: () => void;
}

const StrategyControlPanel: React.FC<StrategyControlPanelProps> = ({ strategy, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approveStrategy = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = getAccessToken();
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/strategy/${strategy.id}/approve`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        onUpdate?.();
        setShowConfirmation(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to approve strategy');
    } finally {
      setLoading(false);
    }
  };

  const rejectStrategy = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = getAccessToken();
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/strategy/${strategy.id}/reject`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        onUpdate?.();
        setShowConfirmation(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to reject strategy');
    } finally {
      setLoading(false);
    }
  };

  const pauseStrategy = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = getAccessToken();
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/strategy/${strategy.id}/pause`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        onUpdate?.();
        setShowConfirmation(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to pause strategy');
    } finally {
      setLoading(false);
    }
  };

  const resumeStrategy = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = getAccessToken();
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/strategy/${strategy.id}/resume`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        onUpdate?.();
        setShowConfirmation(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to resume strategy');
    } finally {
      setLoading(false);
    }
  };

  const retireStrategy = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = getAccessToken();
      const response = await axios.post(
        `${API_BASE_URL}/api/agent/strategy/${strategy.id}/retire`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        onUpdate?.();
        setShowConfirmation(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to retire strategy');
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'high':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live':
        return 'bg-green-100 text-green-700';
      case 'paper_trading':
        return 'bg-blue-100 text-blue-700';
      case 'approved':
        return 'bg-purple-100 text-purple-700';
      case 'paused':
        return 'bg-yellow-100 text-yellow-700';
      case 'retired':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {/* Strategy Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-lg font-bold text-gray-900">{strategy.strategy_name}</h4>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(strategy.status)}`}>
              {strategy.status.replace('_', ' ').toUpperCase()}
            </span>
            <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${getRiskColor(strategy.risk_level)}`}>
              {strategy.risk_level.toUpperCase()} RISK
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-600">Backtest Score</p>
          <p className="text-2xl font-bold text-blue-600">{strategy.backtest_score.toFixed(2)}</p>
          {strategy.paper_trading_score && (
            <p className="text-xs text-gray-600 mt-1">
              Paper: {strategy.paper_trading_score.toFixed(2)}
            </p>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Control Buttons */}
      <div className="space-y-2">
        {/* Approval Required */}
        {strategy.requires_approval && strategy.status === 'backtested' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-yellow-600" />
              <p className="text-sm font-semibold text-yellow-800">Manual Approval Required</p>
            </div>
            <p className="text-xs text-yellow-700 mb-3">
              This strategy requires manual approval before proceeding to paper trading
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirmation('approve')}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </button>
              <button
                onClick={() => setShowConfirmation('reject')}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Live/Paper Trading Controls */}
        {(strategy.status === 'live' || strategy.status === 'paper_trading' || strategy.status === 'paused') && (
          <div className="flex gap-2">
            {strategy.status !== 'paused' ? (
              <button
                onClick={() => setShowConfirmation('pause')}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <Pause className="w-4 h-4" />
                Pause Strategy
              </button>
            ) : (
              <button
                onClick={() => setShowConfirmation('resume')}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                Resume Strategy
              </button>
            )}
            <button
              onClick={() => setShowConfirmation('retire')}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Retire Strategy
            </button>
          </div>
        )}

        {/* Paused Strategy Controls */}
        {strategy.status === 'paused' && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowConfirmation('resume')}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              Resume
            </button>
            <button
              onClick={() => setShowConfirmation('retire')}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Retire
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-orange-600" />
              <h3 className="text-xl font-bold text-gray-900">Confirm Action</h3>
            </div>
            
            <p className="text-gray-700 mb-6">
              {showConfirmation === 'approve' && 'Are you sure you want to approve this strategy for paper trading?'}
              {showConfirmation === 'reject' && 'Are you sure you want to reject this strategy? It will be retired.'}
              {showConfirmation === 'pause' && 'Are you sure you want to pause this strategy? All open positions will remain open.'}
              {showConfirmation === 'resume' && 'Are you sure you want to resume this strategy?'}
              {showConfirmation === 'retire' && 'Are you sure you want to retire this strategy? All open positions will be closed.'}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmation(null)}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (showConfirmation === 'approve') approveStrategy();
                  else if (showConfirmation === 'reject') rejectStrategy();
                  else if (showConfirmation === 'pause') pauseStrategy();
                  else if (showConfirmation === 'resume') resumeStrategy();
                  else if (showConfirmation === 'retire') retireStrategy();
                }}
                disabled={loading}
                className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 ${
                  showConfirmation === 'approve' || showConfirmation === 'resume'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {loading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrategyControlPanel;
