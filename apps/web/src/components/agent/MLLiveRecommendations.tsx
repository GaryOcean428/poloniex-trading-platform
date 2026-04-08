import React, { useState, useEffect, useCallback } from 'react';
import { Brain, TrendingUp, AlertCircle, CheckCircle, XCircle, Info } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';
import { safeNum } from '@/utils/safeNum';

const API_BASE_URL = getBackendUrl();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface StrategyRecommendation {
  strategyId: string;
  symbol: string;
  leverage: number;
  timeframe: string;
  strategyType: string;
  regimeAtCreation: string;
  backtestSharpe: number | null;
  backtestWr: number | null;
  paperSharpe: number | null;
  uncensoredSharpe: number | null;
  paperWr: number | null;
  paperPnl: number | null;
  paperTrades: number;
  confidenceScore: number | null;
  fitnessDivergent: boolean;
  isCensored: boolean;
  createdAt: string;
  status: string;
  generation: number;
  parentStrategyId: string | null;
}

interface EngineStatus {
  isRunning: boolean;
  generationCount: number;
  activeStrategies: number;
  paperTrading: number;
  recommended: number;
  live: number;
}

interface ParallelRunnerStatus {
  activeStrategies: number;
  maxSlots: number;
  availableSlots: number;
}

interface MLLiveRecommendationsProps {
  /** Polling interval in ms. Default: 30 000 */
  pollIntervalMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatPnl(pnl: number | null): string {
  if (pnl == null) return '—';
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${safeNum(pnl).toFixed(4)}`;
}

function formatSharpe(v: number | null): string {
  return v != null ? safeNum(v).toFixed(2) : '—';
}

function formatPct(v: number | null): string {
  return v != null ? `${safeNum(v * 100).toFixed(1)}%` : '—';
}

function confidenceColor(score: number | null): string {
  if (score == null) return 'text-gray-500';
  if (score >= 75) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

function regimeBadgeColor(regime: string): string {
  switch (regime) {
    case 'trending': return 'bg-blue-100 text-blue-800';
    case 'ranging': return 'bg-purple-100 text-purple-800';
    case 'volatile': return 'bg-orange-100 text-orange-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const MLLiveRecommendations: React.FC<MLLiveRecommendationsProps> = ({ pollIntervalMs = 30_000 }) => {
  const [recommendations, setRecommendations] = useState<StrategyRecommendation[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [runnerStatus, setRunnerStatus] = useState<ParallelRunnerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [engineRunning, setEngineRunning] = useState(false);
  const [engineToggling, setEngineToggling] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const token = getAccessToken();
      const headers = { Authorization: `Bearer ${token}` };

      const [recRes, statusRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/api/ml/learning/recommendations`, { headers }),
        axios.get(`${API_BASE_URL}/api/ml/learning/status`, { headers }),
      ]);

      if (recRes.status === 'fulfilled' && recRes.value.data.success) {
        setRecommendations(recRes.value.data.recommendations ?? []);
      }
      if (statusRes.status === 'fulfilled' && statusRes.value.data.success) {
        const { engine, parallelRunner } = statusRes.value.data;
        setEngineStatus(engine);
        setRunnerStatus(parallelRunner);
        setEngineRunning(engine?.isRunning ?? false);
      }
      setError(null);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401) return;
      setError(err instanceof Error ? err.message : 'Failed to load ML recommendations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, pollIntervalMs]);

  const handleToggleEngine = async () => {
    setEngineToggling(true);
    try {
      const token = getAccessToken();
      const headers = { Authorization: `Bearer ${token}` };
      const endpoint = engineRunning
        ? `${API_BASE_URL}/api/ml/learning/stop`
        : `${API_BASE_URL}/api/ml/learning/start`;
      await axios.post(endpoint, {}, { headers });
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setEngineToggling(false);
    }
  };

  const handleConfirmLive = async (strategyId: string) => {
    setConfirmingId(strategyId);
    try {
      const token = getAccessToken();
      await axios.post(
        `${API_BASE_URL}/api/ml/learning/recommendations/${strategyId}/confirm`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setConfirmedIds(prev => new Set(prev).add(strategyId));
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Confirmation failed');
    } finally {
      setConfirmingId(null);
    }
  };

  // ─────────────────── render ────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Engine status bar */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Brain className={`w-6 h-6 ${engineRunning ? 'text-blue-600' : 'text-gray-400'}`} />
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">ML Self-Learning Engine</h3>
            <p className="text-xs text-gray-500">
              {engineStatus
                ? `Gen ${engineStatus.generationCount} · ${engineStatus.paperTrading} paper trading · ${engineStatus.recommended} recommended`
                : 'Loading…'}
            </p>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${engineRunning ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
          >
            {engineRunning ? 'Running' : 'Stopped'}
          </span>
        </div>

        {runnerStatus && (
          <div className="text-xs text-gray-500 text-right">
            Parallel slots: {runnerStatus.activeStrategies}/{runnerStatus.maxSlots} active
          </div>
        )}

        <button
          onClick={handleToggleEngine}
          disabled={engineToggling}
          className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
            engineRunning
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
          } disabled:opacity-50`}
        >
          {engineToggling ? 'Please wait…' : engineRunning ? 'Stop Engine' : 'Start Engine'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Recommendations */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-gray-800">Strategies Ready for Live Trading</h3>
          </div>
          {recommendations.length > 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {recommendations.length} ready
            </span>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading recommendations…</p>
          </div>
        ) : recommendations.length === 0 ? (
          <div className="p-8 text-center">
            <Brain className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No strategies ready yet</p>
            <p className="text-gray-400 text-sm mt-1">
              The learning engine is continuously generating and testing strategies.
              Qualifying strategies will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recommendations.map(s => {
              const isConfirming = confirmingId === s.strategyId;
              const isConfirmed = confirmedIds.has(s.strategyId);
              const sharpeDiverges = s.fitnessDivergent;

              return (
                <div key={s.strategyId} className="p-4">
                  {/* Header row */}
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 text-sm">{s.symbol}</span>
                        <span className="text-xs text-gray-500">{s.strategyType} · {s.timeframe} · {s.leverage}×</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${regimeBadgeColor(s.regimeAtCreation)}`}>
                          {s.regimeAtCreation}
                        </span>
                        {s.fitnessDivergent && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 flex items-center gap-1">
                            <Info className="w-3 h-3" /> divergent fitness
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">ID: {s.strategyId} · Gen {s.generation}</p>
                    </div>

                    {/* Confidence badge */}
                    {s.confidenceScore != null && (
                      <span className={`text-sm font-bold ${confidenceColor(s.confidenceScore)}`}>
                        {safeNum(s.confidenceScore).toFixed(0)}% confidence
                      </span>
                    )}
                  </div>

                  {/* Metrics table */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <MetricCell label="Paper Sharpe (all)" value={formatSharpe(s.paperSharpe)} highlight={sharpeDiverges} />
                    <MetricCell
                      label="Uncensored Sharpe"
                      value={formatSharpe(s.uncensoredSharpe)}
                      tooltip="Computed from sessions that did NOT end with forced close or drawdown kill"
                    />
                    <MetricCell label="Paper P&L" value={formatPnl(s.paperPnl)} positive={s.paperPnl != null && s.paperPnl > 0} />
                    <MetricCell label="Win Rate" value={formatPct(s.paperWr)} />
                    <MetricCell label="Paper Trades" value={String(s.paperTrades)} />
                    <MetricCell label="Backtest Sharpe" value={formatSharpe(s.backtestSharpe)} />
                    <MetricCell label="Backtest WR" value={formatPct(s.backtestWr)} />
                    <MetricCell label="Status" value={s.status} />
                  </div>

                  {/* Divergence warning */}
                  {sharpeDiverges && (
                    <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded p-2 mb-3 text-xs text-yellow-700">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>
                        Fitness divergence detected — all-data vs uncensored Sharpe differ by &gt;20%.
                        Review carefully before confirming live.
                      </span>
                    </div>
                  )}

                  {/* Action button */}
                  {isConfirmed ? (
                    <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                      <CheckCircle className="w-4 h-4" />
                      Promoted to live trading
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleConfirmLive(s.strategyId)}
                        disabled={isConfirming}
                        className="flex items-center gap-2 bg-green-600 text-white text-sm px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
                      >
                        {isConfirming ? (
                          <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b border-white" />
                            Confirming…
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            Confirm Live Trading
                          </>
                        )}
                      </button>
                      <p className="text-xs text-gray-400">
                        Starts with minimum position size (~1% of balance). One-time manual confirmation required.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// Small helper cell component
interface MetricCellProps {
  label: string;
  value: string;
  highlight?: boolean;
  positive?: boolean;
  tooltip?: string;
}

const MetricCell: React.FC<MetricCellProps> = ({ label, value, highlight, positive, tooltip }) => (
  <div className={`rounded p-2 ${highlight ? 'bg-yellow-50' : 'bg-gray-50'}`} title={tooltip}>
    <p className="text-xs text-gray-500">{label}</p>
    <p
      className={`text-sm font-semibold ${
        positive === true ? 'text-green-700' : positive === false ? 'text-red-700' : 'text-gray-800'
      }`}
    >
      {value}
    </p>
  </div>
);

export default MLLiveRecommendations;
