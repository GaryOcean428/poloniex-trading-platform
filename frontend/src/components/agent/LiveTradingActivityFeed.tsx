import React, { useState, useEffect, useRef } from 'react';
import { Activity, TrendingUp, TrendingDown, _DollarSign, Target, AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (window.location.hostname.includes('railway.app') 
    ? 'https://polytrade-be.up.railway.app' 
    : 'http://localhost:3000');

interface TradeActivity {
  id: string;
  timestamp: Date;
  type: 'entry' | 'exit' | 'stop_loss' | 'take_profit' | 'signal' | 'analysis' | 'error';
  strategy_name: string;
  symbol: string;
  side?: 'long' | 'short';
  price?: number;
  quantity?: number;
  pnl?: number;
  pnl_percent?: number;
  message: string;
  metadata?: any;
}

interface LiveTradingActivityFeedProps {
  agentStatus?: string;
  maxItems?: number;
}

const LiveTradingActivityFeed: React.FC<LiveTradingActivityFeedProps> = ({ 
  agentStatus, 
  maxItems = 50 
}) => {
  const [activities, setActivities] = useState<TradeActivity[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  const prevActivitiesLength = useRef(0);

  useEffect(() => {
    if (agentStatus === 'running') {
      fetchActivities();
      
      const interval = setInterval(() => {
        fetchActivities();
      }, 2000); // Update every 2 seconds for real-time feel

      return () => clearInterval(interval);
    }
  }, [agentStatus]);

  useEffect(() => {
    // Auto-scroll to bottom when new activities arrive
    if (autoScroll && activities.length > prevActivitiesLength.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
    prevActivitiesLength.current = activities.length;
  }, [activities, autoScroll]);

  const fetchActivities = async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(`${API_BASE_URL}/api/agent/activity/live?limit=${maxItems}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        setActivities(response.data.activities);
      }
    } catch (_err: any) {
      // console.error('Error fetching live activities:', err);
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'entry':
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'exit':
        return <TrendingDown className="w-4 h-4 text-blue-600" />;
      case 'stop_loss':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'take_profit':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'signal':
        return <Target className="w-4 h-4 text-purple-600" />;
      case 'analysis':
        return <Activity className="w-4 h-4 text-blue-600" />;
      case 'error':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'entry':
        return 'bg-green-50 border-green-200';
      case 'exit':
        return 'bg-blue-50 border-blue-200';
      case 'stop_loss':
        return 'bg-red-50 border-red-200';
      case 'take_profit':
        return 'bg-green-50 border-green-200';
      case 'signal':
        return 'bg-purple-50 border-purple-200';
      case 'analysis':
        return 'bg-blue-50 border-blue-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getPnLColor = (pnl?: number) => {
    if (!pnl) return 'text-gray-600';
    if (pnl > 0) return 'text-green-600';
    if (pnl < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const filteredActivities = filter === 'all' 
    ? activities 
    : activities.filter(a => a.type === filter);

  if (agentStatus !== 'running') {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          Activity Feed Inactive
        </h3>
        <p className="text-gray-500">
          Start the autonomous agent to see live trading activity
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-pink-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 animate-pulse" />
            <div>
              <h3 className="text-2xl font-bold">Live Trading Activity</h3>
              <p className="text-sm opacity-90 mt-1">
                Real-time feed of all trading actions and signals
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
            <span className="text-sm font-semibold">LIVE</span>
          </div>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('entry')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filter === 'entry'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Entries
            </button>
            <button
              onClick={() => setFilter('exit')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filter === 'exit'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Exits
            </button>
            <button
              onClick={() => setFilter('signal')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filter === 'signal'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Signals
            </button>
            <button
              onClick={() => setFilter('error')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filter === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Errors
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Activity Feed */}
      <div 
        ref={feedRef}
        className="h-96 overflow-y-auto p-4 space-y-2"
        onScroll={(e) => {
          const target = e.target as HTMLDivElement;
          const isAtBottom = target.scrollHeight - target.scrollTop === target.clientHeight;
          if (!isAtBottom && autoScroll) {
            setAutoScroll(false);
          }
        }}
      >
        {filteredActivities.length > 0 ? (
          filteredActivities.map((activity) => (
            <div
              key={activity.id}
              className={`border rounded-lg p-3 transition-all hover:shadow-md ${getActivityColor(activity.type)}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  {getActivityIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">
                          {activity.strategy_name}
                        </span>
                        <span className="text-gray-600">•</span>
                        <span className="font-medium text-gray-700">
                          {activity.symbol}
                        </span>
                        {activity.side && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                              activity.side === 'long' 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {activity.side.toUpperCase()}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 mt-1">
                        {activity.message}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-500">
                        {new Date(activity.timestamp).toLocaleTimeString()}
                      </p>
                      {activity.pnl !== undefined && (
                        <p className={`text-sm font-bold ${getPnLColor(activity.pnl)} mt-1`}>
                          {activity.pnl >= 0 ? '+' : ''}${activity.pnl.toFixed(2)}
                          {activity.pnl_percent !== undefined && (
                            <span className="text-xs ml-1">
                              ({activity.pnl_percent >= 0 ? '+' : ''}{activity.pnl_percent.toFixed(2)}%)
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  {activity.price && (
                    <div className="flex items-center gap-4 text-xs text-gray-600 mt-2">
                      <span>Price: ${activity.price.toFixed(2)}</span>
                      {activity.quantity && (
                        <span>Qty: {activity.quantity}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-12">
            <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">
              {filter === 'all' 
                ? 'No activity yet. Waiting for trading signals...' 
                : `No ${filter} activities to display`}
            </p>
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="bg-gray-50 border-t border-gray-200 p-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-gray-600 mb-1">Total Activities</p>
            <p className="text-lg font-bold text-gray-900">{activities.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">Trades Today</p>
            <p className="text-lg font-bold text-blue-600">
              {activities.filter(a => a.type === 'entry' || a.type === 'exit').length}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">Signals Generated</p>
            <p className="text-lg font-bold text-purple-600">
              {activities.filter(a => a.type === 'signal').length}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveTradingActivityFeed;
