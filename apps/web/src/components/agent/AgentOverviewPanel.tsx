import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';
import { safeNum } from '@/utils/safeNum';
import axios from 'axios';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Percent,
  RefreshCw,
  Shield,
  Target,
  TrendingUp
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE_URL = getBackendUrl();

interface PaperTradingSummary {
  totalSessions: number;
  activeSessions: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  averageReturnPct: number;
}

interface StrategyBreakdown {
  strategyName: string;
  returnPct: number;
  totalTrades: number;
  winRatePct: number;
  status: string;
}

interface PipelineSummary {
  strategyCounts: {
    generated: number;
    backtested: number;
    paperTrading: number;
    live: number;
  };
  confidence: {
    score: number;
    level: string;
  };
  risk: {
    rating: string;
    averageMaxDrawdown: number | null;
  };
  paperTrading: PaperTradingSummary | null;
  strategyBreakdown: StrategyBreakdown[];
}

interface PerformanceMetrics {
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWin: number;
  averageLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

interface AgentOverviewPanelProps {
  agentStatus?: string;
  startedAt?: Date;
  circuitBreakerTripped?: boolean;
}

const AgentOverviewPanel: React.FC<AgentOverviewPanelProps> = ({
  agentStatus,
  startedAt,
  circuitBreakerTripped,
}) => {
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary | null>(null);
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const getAuthHeaders = useCallback(() => {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const headers = getAuthHeaders();
      const [summaryRes, perfRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/api/backtest/pipeline/summary`, { headers }),
        axios.get(`${API_BASE_URL}/api/agent/performance`, { headers }),
      ]);

      if (summaryRes.status === 'fulfilled' && summaryRes.value.data?.success) {
        setPipelineSummary(summaryRes.value.data.summary || summaryRes.value.data);
      }

      if (perfRes.status === 'fulfilled' && perfRes.value.data?.success) {
        setPerformance(perfRes.value.data.performance);
      }

      setLastUpdated(new Date());
    } catch {
      // Silently handle errors — data will show as unavailable
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchData();

    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatCurrency = (value: number): string => {
    if (value === 0) return '$0.00';
    const prefix = value > 0 ? '+$' : '-$';
    return `${prefix}${safeNum(Math.abs(value)).toFixed(2)}`;
  };

  // Format a percent value (already in "percent units", e.g. 42.86 → "+42.9%").
  // Use this when the source already stores percent form (DB win_rate column,
  // paper_trading.winRate, averageReturnPct, avgMaxDrawdown from pipeline).
  const formatPercent = (value: number): string => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}${safeNum(value).toFixed(1)}%`;
  };

  // Canonical decimal → percent conversion.
  //
  // Replaces the old magnitude-sniffing `toPercent` heuristic, which silently
  // mis-formatted when upstream rows stored different conventions (the cause
  // of the −89.60% / PF 1.14 / −5.89% DD contradiction the user saw on the
  // Backtest card). The rule going forward: `agent_strategies.performance`
  // values (winRate, totalReturn, maxDrawdown) are decimal (0.4286 = 42.86%),
  // and the UI multiplies by 100 exactly once here. Short-form returns a
  // number suitable for sort/compare; `formatPercent(decimalToPercent(n))`
  // produces the signed string for rendering.
  const decimalToPercent = (value: number | undefined | null): number => {
    return safeNum(value ?? 0) * 100;
  };

  const pnlColor = (value: number): string =>
    value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-gray-600';

  const pnlBg = (value: number): string =>
    value > 0 ? 'bg-green-50' : value < 0 ? 'bg-red-50' : 'bg-gray-50';

  const getUptimeString = (): string => {
    if (!startedAt) return '—';
    const ms = Date.now() - new Date(startedAt).getTime();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  const getHealthLabel = (): { label: string; color: string; icon: React.ReactNode } => {
    if (!agentStatus || agentStatus === 'stopped') {
      return { label: 'Offline', color: 'text-gray-500', icon: <Activity className="w-4 h-4 text-gray-400" /> };
    }
    if (circuitBreakerTripped) {
      return { label: 'Circuit Breaker', color: 'text-red-600', icon: <AlertTriangle className="w-4 h-4 text-red-500" /> };
    }
    if (agentStatus === 'paused') {
      return { label: 'Paused', color: 'text-yellow-600', icon: <Clock className="w-4 h-4 text-yellow-500" /> };
    }
    return { label: 'Healthy', color: 'text-green-600', icon: <CheckCircle2 className="w-4 h-4 text-green-500" /> };
  };

  const getAgentPhase = (): string => {
    if (!agentStatus || agentStatus === 'stopped') return 'Idle';
    if (agentStatus === 'paused') return 'Paused';
    const counts = pipelineSummary?.strategyCounts;
    if (!counts) return 'Monitoring';
    if (counts.live > 0) return 'Live Trading';
    if (counts.paperTrading > 0) return 'Paper Trading';
    if (counts.backtested > 0) return 'Evaluating Strategies';
    if (counts.generated > 0) return 'Backtesting';
    return 'Generating Strategies';
  };

  const paper = pipelineSummary?.paperTrading;
  const totalPaperPnl = paper ? paper.totalRealizedPnl + paper.totalUnrealizedPnl : 0;
  const paperLosingTrades = paper ? paper.totalTrades - paper.winningTrades : 0;
  const health = getHealthLabel();
  const riskRating = pipelineSummary?.risk?.rating || 'unknown';

  // Find best and worst strategies from breakdown.
  // API returns { performance: { winRate, totalReturn, maxDrawdown, ... } } — flatten
  // for display. Canonical unit conventions (per ../api/src/routes/agent.ts and
  // ../api/src/services/backtestingEngine.js):
  //   - performance.winRate    : decimal (0.4286 = 42.86%)
  //   - performance.totalReturn: decimal (−0.006 = −0.6%)
  //   - performance.maxDrawdown: decimal (0.05 = 5%)
  //   - performance.profitFactor: ratio (1.55 = 1.55x)
  //   - performance.totalTrades: count
  // We multiply by 100 exactly once here (via decimalToPercent) to produce
  // percent-form numbers the sort/compare/render code consumes.
  const rawBreakdown = pipelineSummary?.strategyBreakdown || [];
  const breakdown = rawBreakdown.map((s: any) => ({
    strategyName: s.strategyName ?? s.name ?? 'Unnamed strategy',
    status: s.status ?? 'unknown',
    totalTrades: safeNum(s.totalTrades ?? s.performance?.totalTrades ?? 0),
    winRatePct: decimalToPercent(s.winRate ?? s.performance?.winRate ?? 0),
    returnPct: decimalToPercent(s.pnl ?? s.performance?.totalReturn ?? 0),
  }));
  const sortedByReturn = [...breakdown].sort((a, b) => b.returnPct - a.returnPct);
  const bestStrategy = sortedByReturn[0] || null;
  const worstStrategy = sortedByReturn.length > 1 ? sortedByReturn[sortedByReturn.length - 1] : null;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-40 bg-gray-100 rounded" />
          <div className="h-40 bg-gray-100 rounded" />
          <div className="h-40 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-cyan-600" />
          <h2 className="text-lg font-bold text-gray-900">Profitability &amp; Oversight</h2>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {lastUpdated && (
            <span>Updated {lastUpdated.toLocaleTimeString()}</span>
          )}
          <button
            onClick={fetchData}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            aria-label="Refresh data"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* Three Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Column 1: Agent Oversight */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-600" />
              Agent Oversight
            </h3>

            <div className="space-y-2">
              {/* Health */}
              <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">Health</span>
                <span className={`text-sm font-semibold flex items-center gap-1.5 ${health.color}`}>
                  {health.icon}
                  {health.label}
                </span>
              </div>

              {/* Current Phase */}
              <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">Phase</span>
                <span className="text-sm font-semibold text-gray-900">{getAgentPhase()}</span>
              </div>

              {/* Uptime */}
              <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">Uptime</span>
                <span className="text-sm font-semibold text-gray-900">{getUptimeString()}</span>
              </div>

              {/* Risk Level */}
              <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">Risk</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${riskRating === 'low' ? 'bg-green-100 text-green-700' :
                    riskRating === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      riskRating === 'high' ? 'bg-orange-100 text-orange-700' :
                        riskRating === 'very_high' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                  }`}>
                  {riskRating === 'unknown' ? 'N/A' : riskRating.replace(/_/g, ' ')}
                </span>
              </div>

              {/* Confidence */}
              {pipelineSummary?.confidence && (
                <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Confidence</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pipelineSummary.confidence.score >= 70 ? 'bg-green-500' :
                            pipelineSummary.confidence.score >= 40 ? 'bg-yellow-500' :
                              'bg-red-500'
                          }`}
                        style={{ width: `${pipelineSummary.confidence.score}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      {pipelineSummary.confidence.score}%
                    </span>
                  </div>
                </div>
              )}

              {/* Performance: Win Rate + Sharpe */}
              {performance && performance.totalTrades > 0 && (
                <>
                  <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Win Rate</span>
                    <span className={`text-sm font-semibold ${performance.winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                      {safeNum(performance.winRate).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Sharpe Ratio</span>
                    <span className={`text-sm font-semibold ${performance.sharpeRatio >= 1 ? 'text-green-600' : performance.sharpeRatio >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {safeNum(performance.sharpeRatio).toFixed(2)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Column 2: Paper Trading P&L */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-blue-600" />
              Paper Trading P&amp;L
            </h3>

            {paper && paper.totalTrades > 0 ? (
              <div className="space-y-2">
                {/* Total P&L hero */}
                <div className={`p-4 rounded-lg ${pnlBg(totalPaperPnl)}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Total P&amp;L</span>
                    {totalPaperPnl >= 0
                      ? <ArrowUpRight className="w-4 h-4 text-green-500" />
                      : <ArrowDownRight className="w-4 h-4 text-red-500" />
                    }
                  </div>
                  <p className={`text-2xl font-bold ${pnlColor(totalPaperPnl)}`}>
                    {formatCurrency(totalPaperPnl)}
                  </p>
                  {paper.averageReturnPct !== 0 && (
                    <p className={`text-sm ${pnlColor(paper.averageReturnPct)} mt-0.5`}>
                      {formatPercent(paper.averageReturnPct)} avg return
                    </p>
                  )}
                </div>

                {/* Realized / Unrealized breakdown */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 bg-gray-50 rounded-lg">
                    <span className="text-xs text-gray-500 block">Realized</span>
                    <p className={`text-sm font-semibold ${pnlColor(paper.totalRealizedPnl)}`}>
                      {formatCurrency(paper.totalRealizedPnl)}
                    </p>
                  </div>
                  <div className="p-2.5 bg-gray-50 rounded-lg">
                    <span className="text-xs text-gray-500 block">Unrealized</span>
                    <p className={`text-sm font-semibold ${pnlColor(paper.totalUnrealizedPnl)}`}>
                      {formatCurrency(paper.totalUnrealizedPnl)}
                    </p>
                  </div>
                </div>

                {/* Win Rate */}
                <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" /> Win Rate
                  </span>
                  <span className={`text-sm font-semibold ${paper.winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                    {safeNum(paper.winRate).toFixed(1)}%
                  </span>
                </div>

                {/* Trade Counts */}
                <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Trades</span>
                  <span className="text-sm text-gray-900">
                    <span className="font-semibold">{paper.totalTrades}</span>
                    <span className="text-xs text-gray-500 ml-1">
                      ({paper.winningTrades}W / {paperLosingTrades}L)
                    </span>
                  </span>
                </div>

                {/* Sessions */}
                <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Sessions</span>
                  <span className="text-sm text-gray-900">
                    <span className="font-semibold">{paper.totalSessions}</span>
                    <span className="text-xs text-gray-500 ml-1">
                      ({paper.activeSessions} active)
                    </span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-gray-400 bg-gray-50 rounded-lg">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No paper trades yet</p>
                <p className="text-xs mt-1">
                  {agentStatus === 'running'
                    ? 'Agent is generating strategies — paper trades will appear after backtesting'
                    : 'Start the agent to begin paper trading'}
                </p>
              </div>
            )}
          </div>

          {/* Column 3: Backtesting Profitability */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-600" />
              Backtesting Results
            </h3>

            {breakdown.length > 0 ? (
              <div className="space-y-2">
                {/* Avg Win Rate across strategies */}
                {(() => {
                  const totalTrades = breakdown.reduce((sum, s) => sum + safeNum(s.totalTrades), 0);
                  const avgWinRate = totalTrades > 0
                    ? breakdown.reduce((sum, s) => sum + (s.winRatePct * safeNum(s.totalTrades)), 0) / totalTrades
                    : breakdown.reduce((sum, s) => sum + s.winRatePct, 0) / breakdown.length;
                  const avgReturn = breakdown.reduce((sum, s) => sum + s.returnPct, 0) / breakdown.length;
                  return (
                    <>
                      <div className={`p-4 rounded-lg ${pnlBg(avgReturn)}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-gray-600">Avg Return</span>
                          <Percent className="w-4 h-4 text-gray-400" />
                        </div>
                        <p className={`text-2xl font-bold ${pnlColor(avgReturn)}`}>
                          {formatPercent(avgReturn)}
                        </p>
                        <p className="text-sm text-gray-500 mt-0.5">
                          across {breakdown.length} strategies
                        </p>
                      </div>

                      <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-600">Avg Win Rate</span>
                        <span className={`text-sm font-semibold ${avgWinRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                          {safeNum(avgWinRate).toFixed(1)}%
                        </span>
                      </div>
                    </>
                  );
                })()}

                {/* Max Drawdown */}
                {pipelineSummary?.risk?.averageMaxDrawdown != null && (
                  <div className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Avg Max Drawdown</span>
                    <span className="text-sm font-semibold text-orange-600">
                      {safeNum(pipelineSummary?.risk?.averageMaxDrawdown).toFixed(1)}%
                    </span>
                  </div>
                )}

                {/* Best Strategy */}
                {bestStrategy && (
                  <div className={`p-2.5 rounded-lg border ${bestStrategy.returnPct >= 0 ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Best Strategy</span>
                      <span className={`text-xs font-semibold ${pnlColor(bestStrategy.returnPct)}`}>
                        {formatPercent(bestStrategy.returnPct)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 truncate mt-0.5">
                      {bestStrategy.strategyName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {bestStrategy.totalTrades} trades · {safeNum(bestStrategy.winRatePct).toFixed(1)}% win
                    </p>
                  </div>
                )}

                {/* Worst Strategy */}
                {worstStrategy && worstStrategy !== bestStrategy && (
                  <div className={`p-2.5 rounded-lg border ${worstStrategy.returnPct < 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Worst Strategy</span>
                      <span className={`text-xs font-semibold ${pnlColor(worstStrategy.returnPct)}`}>
                        {formatPercent(worstStrategy.returnPct)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 truncate mt-0.5">
                      {worstStrategy.strategyName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {worstStrategy.totalTrades} trades · {safeNum(worstStrategy.winRatePct).toFixed(1)}% win
                    </p>
                  </div>
                )}

                {/* Link to full details */}
                <Link
                  to="/backtesting"
                  className="block text-center text-sm text-cyan-600 hover:text-cyan-700 font-medium p-2 hover:bg-cyan-50 rounded-lg transition-colors"
                >
                  View full pipeline →
                </Link>
              </div>
            ) : (
              <div className="p-6 text-center text-gray-400 bg-gray-50 rounded-lg">
                <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No backtest results yet</p>
                <p className="text-xs mt-1">
                  {agentStatus === 'running'
                    ? 'Agent is generating strategies — backtests will run automatically'
                    : 'Start the agent to run backtests'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom summary row: key performance numbers */}
        {performance && performance.totalTrades > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-gray-500">Total P&amp;L</span>
                  <span className={`ml-2 font-bold ${pnlColor(performance.totalPnl)}`}>
                    {formatCurrency(performance.totalPnl)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Trades</span>
                  <span className="ml-2 font-bold text-gray-900">{performance.totalTrades}</span>
                </div>
                <div>
                  <span className="text-gray-500">Max Drawdown</span>
                  <span className="ml-2 font-bold text-orange-600">{safeNum(performance.maxDrawdown).toFixed(1)}%</span>
                </div>
              </div>
              <Link
                to="/performance"
                className="text-cyan-600 hover:text-cyan-700 font-medium flex items-center gap-1"
              >
                Full Performance <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentOverviewPanel;
