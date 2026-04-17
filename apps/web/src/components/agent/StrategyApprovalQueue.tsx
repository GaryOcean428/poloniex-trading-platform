import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';
import axios from 'axios';
import { AlertCircle, Clock, RefreshCw, Shield } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import StrategyControlPanel from './StrategyControlPanel';

const API_BASE_URL = getBackendUrl();

/**
 * Originally the "Strategy Approval Queue" — a manual review queue for
 * strategies requiring approval before going live. With the autonomous
 * promotion engine (multi-metric gates, Thompson bandit, graduated
 * sizing), live promotion no longer requires manual review.
 *
 * This component is repurposed as the "Recalibrating Strategies" queue:
 * it surfaces strategies whose rolling-20-trade drawdown triggered a
 * demotion back to an earlier pipeline stage. The operator can see the
 * demotion reason and optionally retire the strategy permanently
 * instead of letting it recalibrate.
 *
 * The /api/agent/strategies/pending-approval endpoint is reused —
 * the backend will return both approval-pending (legacy) and
 * recalibrating strategies in the same payload during the transition.
 */

interface Strategy {
  id: string;
  strategy_name: string;
  status:
    | 'generated'
    | 'backtested'
    | 'paper_trading'
    | 'approved'
    | 'live'
    | 'paused'
    | 'retired'
    | 'recalibrating';
  backtest_score: number;
  paper_trading_score?: number;
  risk_level: 'low' | 'medium' | 'high';
  requires_approval: boolean;
  created_at: Date;
  /** Populated when status === 'recalibrating'. Set by the demotion engine. */
  demotion_reason?: string;
  /** How many times this strategy has been demoted in the last 30 days. */
  demotion_count?: number;
}

interface StrategyApprovalQueueProps {
  agentStatus?: string;
}

const StrategyApprovalQueue: React.FC<StrategyApprovalQueueProps> = ({ agentStatus }) => {
  const [queuedStrategies, setQueuedStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQueuedStrategies();

    if (agentStatus === 'running') {
      const interval = setInterval(() => {
        fetchQueuedStrategies();
      }, 10000); // Check every 10 seconds

      return () => clearInterval(interval);
    }
  }, [agentStatus]);

  const fetchQueuedStrategies = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(`${API_BASE_URL}/api/agent/strategies/pending-approval`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setQueuedStrategies(response.data.strategies ?? []);
      }
    } catch (_err: unknown) {
      // fail-soft: empty queue rather than crashing the page
    } finally {
      setLoading(false);
    }
  };

  const recalibratingCount = queuedStrategies.filter((s) => s.status === 'recalibrating').length;
  const approvalCount = queuedStrategies.length - recalibratingCount;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading queue...</p>
      </div>
    );
  }

  if (queuedStrategies.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          No Recalibrating Strategies
        </h3>
        <p className="text-gray-500">
          Demoted strategies will appear here with their demotion reason.
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
            <RefreshCw className="w-8 h-8" />
            <div>
              <h3 className="text-2xl font-bold">Recalibrating Strategies</h3>
              <p className="text-sm opacity-90 mt-1">
                {recalibratingCount > 0 &&
                  `${recalibratingCount} ${recalibratingCount === 1 ? 'strategy' : 'strategies'} recalibrating`}
                {recalibratingCount > 0 && approvalCount > 0 && ' · '}
                {approvalCount > 0 &&
                  `${approvalCount} awaiting approval`}
              </p>
            </div>
          </div>
          <div className="bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 border-2 border-white">
            <span className="text-2xl font-bold">{queuedStrategies.length}</span>
          </div>
        </div>
      </div>

      {/* Strategies List */}
      <div className="p-6 space-y-4">
        {queuedStrategies.map((strategy) => {
          const isRecalibrating = strategy.status === 'recalibrating';
          return (
            <div
              key={strategy.id}
              className={`border-l-4 pl-4 ${
                isRecalibrating ? 'border-amber-500' : 'border-orange-500'
              }`}
            >
              <div className="flex items-start gap-3 mb-3">
                {isRecalibrating ? (
                  <RefreshCw className="w-5 h-5 text-amber-600 flex-shrink-0 mt-1" />
                ) : (
                  <Clock className="w-5 h-5 text-orange-600 flex-shrink-0 mt-1" />
                )}
                <div className="flex-1">
                  <p className="text-sm text-gray-600">
                    {isRecalibrating ? 'Demoted' : 'Pending since'}{' '}
                    {new Date(strategy.created_at).toLocaleString()}
                  </p>
                  {isRecalibrating && strategy.demotion_reason && (
                    <p className="text-sm text-amber-700 mt-1 font-mono">
                      {strategy.demotion_reason}
                      {strategy.demotion_count !== undefined && (
                        <span className="ml-2 text-xs text-amber-600">
                          (demotions in last 30d: {strategy.demotion_count})
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <StrategyControlPanel
                strategy={strategy}
                onUpdate={fetchQueuedStrategies}
              />
            </div>
          );
        })}
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border-t border-blue-200 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">Recalibration window</p>
            <p className="text-blue-700">
              Demoted strategies re-enter backtest on a fresh window. If they re-pass, they return
              to paper at half capital. Three recalibration failures within 30 days retires the
              strategy permanently.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StrategyApprovalQueue;
