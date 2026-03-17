import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, Activity, AlertCircle, Brain, Shield, BarChart3 } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';

const API_BASE_URL = getBackendUrl();

interface PerformanceMetrics {
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWin: number;
  averageLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgTradeReturn: number;
  profitFactor: number;
  expectancy: number;
}

interface TradePerformanceData {
  date: string;
  pnl: number;
  cumulativePnL: number;
  trades: number;
}

interface StrategyBreakdownItem {
  name: string;
  value: number;
  trades: number;
  winRate: number;
  status: string;
}

interface RiskMetrics {
  currentDrawdown: number;
  dailyLoss: number;
  openPositions: number;
  riskScore: number;
  circuitBreakerActive: boolean;
  consecutiveLosses: number;
}

const CHART_COLORS = {
  primary: '#06b6d4',
  secondary: '#8b5cf6',
  warning: '#f59e0b',
  error: '#ef4444',
  success: '#10b981',
  info: '#3b82f6'
};

const Performance: React.FC = () => {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [performanceData, setPerformanceData] = useState<TradePerformanceData[]>([]);
  const [strategyBreakdown, setStrategyBreakdown] = useState<StrategyBreakdownItem[]>([]);
  const [riskMetrics, setRiskMetrics] = useState<RiskMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const getAuthHeaders = useCallback(() => {
    const token = getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }, []);

  const fetchPerformance = useCallback(async () => {
    try {
      const [perfRes, stratRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/agent/performance`, { headers: getAuthHeaders() }).catch(() => null),
        axios.get(`${API_BASE_URL}/api/backtest/pipeline/summary`, { headers: getAuthHeaders() }).catch(() => null)
      ]);

      if (perfRes?.data?.success && perfRes.data.performance) {
        const p = perfRes.data.performance;
        const avgWin = Math.abs(parseFloat(p.averageWin) || 0);
        const avgLoss = Math.abs(parseFloat(p.averageLoss) || 1);
        const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
        const winRate = parseFloat(p.winRate) || 0;
        const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

        setMetrics({
          totalPnL: parseFloat(p.totalPnl) || 0,
          winRate,
          totalTrades: parseInt(p.totalTrades) || 0,
          winningTrades: parseInt(p.winningTrades) || 0,
          losingTrades: parseInt(p.losingTrades) || 0,
          averageWin: avgWin,
          averageLoss: avgLoss,
          sharpeRatio: parseFloat(p.sharpeRatio) || 0,
          maxDrawdown: parseFloat(p.maxDrawdown) || 0,
          avgTradeReturn: parseInt(p.totalTrades) > 0 ? (parseFloat(p.totalPnl) || 0) / parseInt(p.totalTrades) : 0,
          profitFactor,
          expectancy
        });

        // Build daily performance data from the daily breakdown if available
        if (perfRes.data.dailyPerformance) {
          setPerformanceData(perfRes.data.dailyPerformance);
        }
      }

      if (stratRes?.data?.success) {
        const summary = stratRes.data.summary;
        if (summary?.strategyBreakdown) {
          setStrategyBreakdown(
            summary.strategyBreakdown.map((s: { name: string; pnl?: number; total_pnl?: number; trades?: number; total_trades?: number; win_rate?: number; winRate?: number; status?: string }) => ({
              name: s.name,
              value: parseFloat(String(s.pnl ?? s.total_pnl ?? 0)),
              trades: parseInt(String(s.trades ?? s.total_trades ?? 0)),
              winRate: parseFloat(String(s.win_rate ?? s.winRate ?? 0)),
              status: s.status || 'unknown'
            }))
          );
        }

        // Extract risk metrics from pipeline summary
        if (summary?.risk) {
          setRiskMetrics({
            currentDrawdown: parseFloat(summary.risk.averageMaxDrawdown || 0),
            dailyLoss: 0,
            openPositions: summary.strategyCounts?.live || 0,
            riskScore: summary.risk.rating === 'low' ? 20 : summary.risk.rating === 'medium' ? 50 : summary.risk.rating === 'high' ? 75 : 90,
            circuitBreakerActive: false,
            consecutiveLosses: 0
          });
        }
      }

      setFetchError(null);
      setLastFetched(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch performance data';
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setFetchError('Session expired — please log in again.');
      } else {
        setFetchError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchPerformance();
    const interval = setInterval(fetchPerformance, 30000);
    return () => clearInterval(interval);
  }, [fetchPerformance]);

  const getRiskColor = (score: number) => {
    if (score < 30) return 'text-green-600';
    if (score < 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getRiskBg = (score: number) => {
    if (score < 30) return 'bg-green-500';
    if (score < 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto" />
          <p className="text-text-secondary mt-4">Loading performance data…</p>
        </div>
      </div>
    );
  }

  const hasData = metrics && metrics.totalTrades > 0;

  return (
    <div className="min-h-screen bg-bg-primary p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">Performance Analytics</h1>
            <p className="text-text-secondary">
              Comprehensive trading performance analysis and metrics
              {lastFetched && (
                <span className="ml-2 text-xs text-text-muted">
                  · Updated {lastFetched.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={fetchPerformance}
            className="p-2 rounded-lg hover:bg-bg-secondary transition-colors text-text-secondary hover:text-text-primary"
            aria-label="Refresh performance data"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Error Banner */}
        {fetchError && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3" role="alert">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-800 font-semibold">Error loading performance</p>
              <p className="text-red-700 text-sm mt-1">{fetchError}</p>
            </div>
            <button onClick={() => setFetchError(null)} className="text-red-400 hover:text-red-600 text-sm">Dismiss</button>
          </div>
        )}

        {/* No Data State */}
        {!hasData && (
          <div className="bg-bg-tertiary rounded-lg p-12 border border-border-subtle shadow-elev-1 text-center">
            <Brain className="w-16 h-16 text-cyan-500 mx-auto mb-4 opacity-60" />
            <h2 className="text-2xl font-semibold text-text-primary mb-4">No Performance Data Yet</h2>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Performance metrics will appear here once the autonomous agent completes trades. Start the agent to begin generating strategies and trading.
            </p>
            <Link
              to="/autonomous-agent"
              className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors shadow-md"
            >
              <Activity className="w-5 h-5" />
              Go to Autonomous Agent
            </Link>
          </div>
        )}

        {hasData && (
          <>
            {/* Risk Status Banner */}
            {riskMetrics && (
              <div className="mb-6 bg-bg-tertiary rounded-lg p-4 border border-border-subtle shadow-elev-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Shield className={`w-6 h-6 ${getRiskColor(riskMetrics.riskScore)}`} />
                    <div>
                      <p className="text-sm font-medium text-text-secondary">Risk Level</p>
                      <p className={`text-lg font-bold ${getRiskColor(riskMetrics.riskScore)}`}>
                        {riskMetrics.riskScore < 30 ? 'Low' : riskMetrics.riskScore < 60 ? 'Medium' : 'High'}
                      </p>
                    </div>
                    {/* Risk Score Bar */}
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getRiskBg(riskMetrics.riskScore)}`}
                        style={{ width: `${Math.min(riskMetrics.riskScore, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div>
                      <span className="text-text-muted">Drawdown</span>
                      <p className={`font-semibold ${riskMetrics.currentDrawdown > 10 ? 'text-red-600' : 'text-text-primary'}`}>
                        {riskMetrics.currentDrawdown.toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <span className="text-text-muted">Live Strategies</span>
                      <p className="font-semibold text-text-primary">{riskMetrics.openPositions}</p>
                    </div>
                    {riskMetrics.circuitBreakerActive && (
                      <div className="flex items-center gap-1 text-red-600">
                        <AlertCircle className="w-4 h-4" />
                        <span className="font-semibold text-xs">Circuit Breaker Active</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 mb-8">
              <MetricCard
                label="Total P&L"
                value={`$${metrics.totalPnL.toFixed(2)}`}
                color={metrics.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}
                icon={metrics.totalPnL >= 0 ? <TrendingUp className="w-5 h-5 text-green-600" /> : <TrendingDown className="w-5 h-5 text-red-600" />}
              />
              <MetricCard label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} color="text-brand-cyan" icon={<BarChart3 className="w-5 h-5 text-cyan-600" />} />
              <MetricCard label="Total Trades" value={`${metrics.totalTrades}`} color="text-text-primary" icon={<Activity className="w-5 h-5 text-gray-600" />} subtext={`${metrics.winningTrades}W / ${metrics.losingTrades}L`} />
              <MetricCard label="Sharpe Ratio" value={metrics.sharpeRatio.toFixed(2)} color={metrics.sharpeRatio >= 1 ? 'text-green-600' : metrics.sharpeRatio >= 0 ? 'text-yellow-600' : 'text-red-600'} />
              <MetricCard label="Max Drawdown" value={`${metrics.maxDrawdown.toFixed(1)}%`} color={metrics.maxDrawdown > 15 ? 'text-red-600' : 'text-yellow-600'} />
              <MetricCard label="Profit Factor" value={metrics.profitFactor.toFixed(2)} color={metrics.profitFactor >= 1.5 ? 'text-green-600' : metrics.profitFactor >= 1 ? 'text-yellow-600' : 'text-red-600'} />
            </div>

            {/* Secondary Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <MetricCard label="Avg Win" value={`$${metrics.averageWin.toFixed(2)}`} color="text-green-600" />
              <MetricCard label="Avg Loss" value={`$${metrics.averageLoss.toFixed(2)}`} color="text-red-600" />
              <MetricCard label="Expectancy" value={`$${metrics.expectancy.toFixed(2)}`} color={metrics.expectancy > 0 ? 'text-green-600' : 'text-red-600'} subtext="per trade" />
              <MetricCard label="Avg Return" value={`$${metrics.avgTradeReturn.toFixed(2)}`} color={metrics.avgTradeReturn >= 0 ? 'text-green-600' : 'text-red-600'} subtext="per trade" />
            </div>

            {/* Charts Grid */}
            {performanceData.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Cumulative P&L Chart */}
                <div className="bg-bg-tertiary rounded-lg p-6 border border-border-subtle shadow-elev-1">
                  <h2 className="text-xl font-semibold text-text-primary mb-4">Cumulative P&L</h2>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={performanceData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(val: number) => [`$${val.toFixed(2)}`, 'Cumulative P&L']} />
                        <Legend />
                        <Line type="monotone" dataKey="cumulativePnL" stroke={CHART_COLORS.success} strokeWidth={2} dot={false} name="Cumulative P&L" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Daily P&L Chart */}
                <div className="bg-bg-tertiary rounded-lg p-6 border border-border-subtle shadow-elev-1">
                  <h2 className="text-xl font-semibold text-text-primary mb-4">Daily P&L</h2>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={performanceData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(val: number) => [`$${val.toFixed(2)}`, 'Daily P&L']} />
                        <Legend />
                        <Bar dataKey="pnl" name="Daily P&L" fill={CHART_COLORS.info}>
                          {performanceData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? CHART_COLORS.success : CHART_COLORS.error} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Strategy Breakdown */}
            {strategyBreakdown.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Strategy Performance Pie Chart */}
                <div className="bg-bg-tertiary rounded-lg p-6 border border-border-subtle shadow-elev-1">
                  <h2 className="text-xl font-semibold text-text-primary mb-4">Strategy Breakdown</h2>
                  <div className="h-64 flex justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={strategyBreakdown}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => {
                            const p = (percent as number) ?? 0;
                            return `${name} ${(p * 100).toFixed(0)}%`;
                          }}
                          outerRadius={80}
                          fill={CHART_COLORS.info}
                          dataKey="value"
                        >
                          {strategyBreakdown.map((_entry, index) => (
                            <Cell key={`cell-${index}`} fill={Object.values(CHART_COLORS)[index % Object.values(CHART_COLORS).length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(val: number) => [`$${val.toFixed(2)}`, 'P&L']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Strategy Details Table */}
                <div className="bg-bg-tertiary rounded-lg p-6 border border-border-subtle shadow-elev-1">
                  <h2 className="text-xl font-semibold text-text-primary mb-4">Strategy Details</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border-moderate">
                          <th className="text-left py-2 text-text-secondary">Strategy</th>
                          <th className="text-right py-2 text-text-secondary">P&L</th>
                          <th className="text-right py-2 text-text-secondary">Trades</th>
                          <th className="text-right py-2 text-text-secondary">Win Rate</th>
                          <th className="text-right py-2 text-text-secondary">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strategyBreakdown.map((strategy, index) => (
                          <tr key={strategy.name} className="border-b border-border-subtle">
                            <td className="py-2 flex items-center">
                              <div
                                className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
                                style={{ backgroundColor: Object.values(CHART_COLORS)[index % Object.values(CHART_COLORS).length] }}
                              />
                              <span className="truncate">{strategy.name}</span>
                            </td>
                            <td className={`text-right py-2 font-medium ${strategy.value >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              ${strategy.value.toFixed(2)}
                            </td>
                            <td className="text-right py-2 text-text-primary">{strategy.trades}</td>
                            <td className={`text-right py-2 ${strategy.winRate >= 55 ? 'text-green-600' : strategy.winRate >= 45 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {strategy.winRate.toFixed(1)}%
                            </td>
                            <td className="text-right py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                strategy.status === 'live' ? 'bg-green-100 text-green-700' :
                                strategy.status === 'paper_trading' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {strategy.status.replace('_', ' ')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/** Reusable metric card component */
function MetricCard({ label, value, color, icon, subtext }: {
  label: string;
  value: string;
  color: string;
  icon?: React.ReactNode;
  subtext?: string;
}) {
  return (
    <div className="bg-bg-tertiary rounded-lg p-4 border border-border-subtle shadow-elev-1">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-text-muted">{label}</h3>
        {icon}
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {subtext && <p className="text-xs text-text-muted mt-1">{subtext}</p>}
    </div>
  );
}

export default Performance;
