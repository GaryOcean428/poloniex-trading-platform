import React from 'react';
import { Activity, Brain, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface AgentStatusPanelProps {
  status?: string;
  strategiesGenerated?: number;
  backtestsCompleted?: number;
  paperTradesExecuted?: number;
  lastActivity?: string;
  startedAt?: Date;
  errorCount?: number;
}

const AgentStatusPanel: React.FC<AgentStatusPanelProps> = ({
  status,
  strategiesGenerated = 0,
  backtestsCompleted = 0,
  paperTradesExecuted = 0,
  lastActivity,
  startedAt,
  errorCount = 0,
}) => {
  const isRunning = status === 'running';
  const isStopped = !status || status === 'stopped';

  const getStatusColor = () => {
    if (status === 'running') return 'text-green-600';
    if (status === 'paused') return 'text-yellow-600';
    return 'text-gray-500';
  };

  const getStatusDot = () => {
    if (status === 'running') return 'bg-green-500 animate-pulse';
    if (status === 'paused') return 'bg-yellow-500';
    return 'bg-gray-400';
  };

  return (
    <div className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${getStatusDot()}`} />
          <span className={`text-sm font-semibold capitalize ${getStatusColor()}`}>
            Agent {status || 'Stopped'}
          </span>
        </div>
        {startedAt && isRunning && (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Since {new Date(startedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
        <div className="bg-white px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Brain className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-xs text-gray-500">Strategies</span>
          </div>
          <span className="text-lg font-bold text-gray-900">{strategiesGenerated}</span>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Activity className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs text-gray-500">Backtests</span>
          </div>
          <span className="text-lg font-bold text-gray-900">{backtestsCompleted}</span>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            <span className="text-xs text-gray-500">Paper Trades</span>
          </div>
          <span className="text-lg font-bold text-gray-900">{paperTradesExecuted}</span>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle className={`w-3.5 h-3.5 ${errorCount > 0 ? 'text-red-500' : 'text-gray-300'}`} />
            <span className="text-xs text-gray-500">Errors</span>
          </div>
          <span className={`text-lg font-bold ${errorCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>{errorCount}</span>
        </div>
      </div>

      {lastActivity && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <span className="text-xs text-gray-500">Last action: </span>
          <span className="text-xs text-gray-700">{lastActivity}</span>
        </div>
      )}

      {isStopped && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <span className="text-xs text-gray-400">Start the agent above to begin autonomous strategy generation.</span>
        </div>
      )}
    </div>
  );
};

export default AgentStatusPanel;
