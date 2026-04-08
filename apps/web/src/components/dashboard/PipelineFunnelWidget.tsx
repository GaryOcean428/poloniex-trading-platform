import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Brain, BarChart3, Eye, TrendingUp, ArrowRight, RefreshCw } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';

const API_BASE_URL = getBackendUrl();

interface StrategyCounts {
  generated: number;
  backtested: number;
  paperTrading: number;
  live: number;
}

const PipelineFunnelWidget: React.FC = () => {
  const [counts, setCounts] = useState<StrategyCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const token = getAccessToken();
      const response = await axios.get(`${API_BASE_URL}/api/backtest/pipeline/summary`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 10000
      });
      if (response.data.success && response.data.summary?.strategyCounts) {
        setCounts(response.data.summary.strategyCounts);
        setLastUpdated(new Date());
      }
    } catch (_err) {
      // Keep previous data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, 30000);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  const stages = [
    {
      label: 'Generated',
      key: 'generated' as keyof StrategyCounts,
      icon: Brain,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      border: 'border-purple-200',
    },
    {
      label: 'Backtested',
      key: 'backtested' as keyof StrategyCounts,
      icon: BarChart3,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
    },
    {
      label: 'Paper Trading',
      key: 'paperTrading' as keyof StrategyCounts,
      icon: Eye,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
    },
    {
      label: 'Live',
      key: 'live' as keyof StrategyCounts,
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
      border: 'border-green-200',
    },
  ];

  return (
    <div className="trading-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-text-primary">Strategy Pipeline</h2>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-text-muted">{lastUpdated.toLocaleTimeString()}</span>
          )}
          <button
            onClick={fetchCounts}
            className="p-1 text-text-muted hover:text-text-secondary rounded transition-colors"
            aria-label="Refresh pipeline counts"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <Link
            to="/backtesting"
            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            View details <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {loading && !counts ? (
        <div className="flex items-center justify-center gap-3 py-4">
          {stages.map((stage) => (
            <div key={stage.key} className="flex-1 h-16 bg-bg-secondary rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex items-stretch gap-1 sm:gap-2">
          {stages.map((stage, idx) => {
            const Icon = stage.icon;
            const value = counts ? counts[stage.key] : 0;
            const maxValue = counts ? counts.generated || 1 : 1;
            const fillPct = Math.round((value / maxValue) * 100);

            return (
              <React.Fragment key={stage.key}>
                <div className={`flex-1 ${stage.bg} ${stage.border} border rounded-lg p-3 flex flex-col items-center gap-1.5 min-w-0`}>
                  <Icon className={`w-5 h-5 ${stage.color} flex-shrink-0`} />
                  <span className={`text-xl font-bold ${stage.color}`}>{value}</span>
                  <span className="text-xs text-text-muted text-center leading-tight">{stage.label}</span>
                  {idx > 0 && counts && counts.generated > 0 && (
                    <span className="text-xs text-text-muted">{fillPct}%</span>
                  )}
                </div>
                {idx < stages.length - 1 && (
                  <div className="flex items-center flex-shrink-0">
                    <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {counts && counts.generated === 0 && (
        <p className="text-xs text-text-muted mt-3 text-center">
          Start the <Link to="/autonomous-agent" className="text-blue-600 hover:underline">Autonomous Agent</Link> to generate strategies.
        </p>
      )}
    </div>
  );
};

export default PipelineFunnelWidget;
