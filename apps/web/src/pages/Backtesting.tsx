import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';
import { useTradingContext } from '@/hooks/useTradingContext';
import {
  TrendingUp,
  AlertTriangle,
  BarChart3,
  Activity,
  Zap,
  Brain,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  Target,
  Eye,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const API_BASE_URL = getBackendUrl();

// ─── Types ────────────────────────────────────────────────────────────────────

interface StrategyCounts {
  generated: number;
  backtested: number;
  paperTrading: number;
  live: number;
}

interface Confidence {
  score: number;
  level: string;
}

interface Risk {
  rating: string;
  averageMaxDrawdown: number;
}

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

interface LiveReadiness {
  ready: boolean;
  reasons: string[];
}

interface StrategyEvent {
  strategyId: string;
  strategyName: string;
  symbol: string;
  status: string;
  updatedAt: string;
  createdAt: string;
}

interface StrategyBreakdown {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  status: string;
  performance: {
    winRate?: number;
    profitFactor?: number;
    totalTrades?: number;
    totalReturn?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
  };
}

interface PipelineSummary {
  strategyCounts: StrategyCounts;
  confidence: Confidence;
  risk: Risk;
  paperTrading: PaperTradingSummary | null;
  liveReadiness: LiveReadiness;
  recentEvents: StrategyEvent[];
  strategyBreakdown: StrategyBreakdown[];
}

interface PipelineResult {
  strategyId: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  status: string;
  averageScore: number;
  recommendation: string;
  reasoning: string;
  performance: {
    winRate?: number;
    profitFactor?: number;
    totalTrades?: number;
    totalReturn?: number;
  };
  confidence: {
    score: number;
    level: string;
    assessedAt: string;
  };
  createdAt: string;
}

// ─── Helper Components ────────────────────────────────────────────────────────

const MINIMUM_TRADES_FOR_CONFIDENCE = 30;

const ConfidenceMeter: React.FC<{ score: number; level: string; paperTrades?: number }> = ({ score, level, paperTrades }) => {
  const getColor = () => {
    if (level === 'high') return { bar: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' };
    if (level === 'medium') return { bar: 'bg-yellow-500', text: 'text-yellow-700', bg: 'bg-yellow-50' };
    if (level === 'low') return { bar: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50' };
    if (level === 'very_low') return { bar: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' };
    return { bar: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50' };
  };
  const colors = getColor();
  const clampedScore = Math.min(100, Math.max(0, score));
  const tradesCompleted = paperTrades ?? 0;
  const isInsufficient = level === 'insufficient_data' || (score === 0 && tradesCompleted < MINIMUM_TRADES_FOR_CONFIDENCE);
  const tradeProgress = Math.min(tradesCompleted, MINIMUM_TRADES_FOR_CONFIDENCE);
  const tradeProgressPct = Math.round((tradeProgress / MINIMUM_TRADES_FOR_CONFIDENCE) * 100);

  if (isInsufficient) {
    return (
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600">Confidence Score</span>
          <span className="text-sm font-semibold text-gray-500">{tradesCompleted}/{MINIMUM_TRADES_FOR_CONFIDENCE} trades</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
          <div
            className="bg-blue-400 h-3 rounded-full transition-all duration-700"
            style={{ width: `${tradeProgressPct}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">
          Need {MINIMUM_TRADES_FOR_CONFIDENCE} paper trades for a confidence score ({tradesCompleted}/{MINIMUM_TRADES_FOR_CONFIDENCE} completed)
        </p>
      </div>
    );
  }

  return (
    <div className={`${colors.bg} p-4 rounded-lg`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-medium ${colors.text}`}>
          Confidence: {level.replace('_', ' ').toUpperCase()}
        </span>
        <span className={`text-lg font-bold ${colors.text}`}>{clampedScore.toFixed(0)}/100</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className={`${colors.bar} h-3 rounded-full transition-all duration-700`}
          style={{ width: `${clampedScore}%` }}
        />
      </div>
    </div>
  );
};

const RiskBadge: React.FC<{ rating: string; drawdown: number }> = ({ rating, drawdown }) => {
  const getStyle = () => {
    switch (rating) {
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'very_high': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-600 border-gray-300';
    }
  };

  return (
    <div className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-medium ${getStyle()}`}>
      <Shield className="w-3.5 h-3.5 mr-1.5" />
      Risk: {rating.replace('_', ' ').toUpperCase()}
      {drawdown > 0 && <span className="ml-1.5 text-xs opacity-75">(DD: {drawdown.toFixed(1)}%)</span>}
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getStyle = () => {
    switch (status) {
      case 'generated': return 'bg-gray-100 text-gray-700';
      case 'backtested': return 'bg-blue-100 text-blue-700';
      case 'paper_trading': return 'bg-yellow-100 text-yellow-700';
      case 'live': case 'deployed': return 'bg-green-100 text-green-700';
      case 'retired': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStyle()}`}>
      {status.replace('_', ' ')}
    </span>
  );
};

const LifecycleStage: React.FC<{ current: string }> = ({ current }) => {
  const stages = ['generated', 'backtested', 'paper_trading', 'live'];
  const currentIdx = stages.indexOf(current);

  return (
    <div className="flex items-center space-x-1 text-xs">
      {stages.map((stage, i) => (
        <React.Fragment key={stage}>
          <span
            className={`px-2 py-0.5 rounded ${
              i < currentIdx ? 'bg-green-100 text-green-700' :
              i === currentIdx ? 'bg-blue-200 text-blue-800 font-semibold' :
              'bg-gray-100 text-gray-400'
            }`}
          >
            {stage.replace('_', ' ')}
          </span>
          {i < stages.length - 1 && <ArrowRight className="w-3 h-3 text-gray-300" />}
        </React.Fragment>
      ))}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const Backtesting: React.FC = () => {
  const { accountBalance } = useTradingContext();
  const [activeTab, setActiveTab] = useState<'overview' | 'strategies' | 'paper' | 'readiness'>('overview');
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [pipelineResults, setPipelineResults] = useState<PipelineResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const getAuthHeaders = useCallback(() => {
    const token = getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }, []);

  const fetchPipelineSummary = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/backtest/pipeline/summary`, {
        headers: getAuthHeaders(),
        timeout: 15000
      });
      if (response.data.success) {
        setSummary(response.data.summary);
        setFetchError(null);
      } else if (response.data.offline) {
        setFetchError('Backend offline — retrying automatically. Start the agent to generate strategies.');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (data?.offline) {
        setFetchError('Network unavailable — showing cached data if available.');
      } else if (status === 401) {
        setFetchError('Session expired — please log in again.');
      } else if (status === 503) {
        setFetchError('Backend temporarily unavailable — retrying automatically.');
      } else if (status && status >= 500) {
        setFetchError('Backend unavailable — retrying automatically.');
      } else if (err?.code === 'ERR_NETWORK' || err?.message?.includes('Network Error')) {
        setFetchError('Network issue detected — retrying automatically.');
      }
      // For network errors or other cases, keep previous data
    }
  }, [getAuthHeaders]);

  const fetchPipelineResults = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/backtest/pipeline/results`, {
        headers: getAuthHeaders(),
        timeout: 15000
      });
      if (response.data.success) {
        setPipelineResults(response.data.results);
      }
    } catch (_err) {
      // Pipeline results are secondary — summary error already covers feedback
    }
  }, [getAuthHeaders]);

  const refreshData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchPipelineSummary(), fetchPipelineResults()]);
    setLastFetched(new Date());
    setLoading(false);
  }, [fetchPipelineSummary, fetchPipelineResults]);

  useEffect(() => {
    refreshData();
    // Refresh every 30 seconds
    const interval = setInterval(refreshData, 30000);
    return () => clearInterval(interval);
  }, [refreshData]);

  // Determine available balance for simulation context
  const simulationBalance = accountBalance
    ? Number(accountBalance.available ?? accountBalance.total ?? 0) || 0
    : 0;

  // ─── Overview Tab ─────────────────────────────────────────────────────────
  const renderOverviewTab = () => {
    if (!summary) {
      return (
        <div className="bg-bg-tertiary p-8 rounded-lg shadow text-center">
          <Brain className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">Agent Backtesting Pipeline</h3>
          <p className="text-gray-600 mb-4">
            The autonomous agent automatically generates, backtests, and validates trading strategies.
            Start the agent from the Autonomous Agent page to begin.
          </p>
          <p className="text-sm text-text-muted mb-4">
            Strategies progress through: Generated → Backtested → Paper Trading → Live
          </p>
          <Link
            to="/autonomous-agent"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Zap className="w-4 h-4 mr-2" />
            Go to Autonomous Agent
          </Link>
        </div>
      );
    }

    const { strategyCounts, confidence, risk, liveReadiness } = summary;

    return (
      <div className="space-y-6">
        {/* Balance Context Banner */}
        {simulationBalance > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center">
            <Target className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0" />
            <div>
              <span className="text-sm text-blue-800">
                <span className="font-medium">Simulation Balance:</span>{' '}
                ${simulationBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
              </span>
              <span className="text-xs text-blue-600 ml-2">
                — Backtesting and paper trading use your actual available balance as the baseline
              </span>
            </div>
          </div>
        )}

        {/* Strategy Lifecycle Counters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-bg-tertiary p-4 rounded-lg shadow">
            <div className="flex items-center">
              <Brain className="w-8 h-8 text-purple-500 mr-3" />
              <div>
                <p className="text-sm text-gray-600">Generated</p>
                <p className="text-2xl font-bold text-text-primary">{strategyCounts.generated}</p>
              </div>
            </div>
          </div>
          <div className="bg-bg-tertiary p-4 rounded-lg shadow">
            <div className="flex items-center">
              <BarChart3 className="w-8 h-8 text-blue-500 mr-3" />
              <div>
                <p className="text-sm text-gray-600">Backtested</p>
                <p className="text-2xl font-bold text-text-primary">{strategyCounts.backtested}</p>
              </div>
            </div>
          </div>
          <div className="bg-bg-tertiary p-4 rounded-lg shadow">
            <div className="flex items-center">
              <Eye className="w-8 h-8 text-yellow-500 mr-3" />
              <div>
                <p className="text-sm text-gray-600">Paper Trading</p>
                <p className="text-2xl font-bold text-text-primary">{strategyCounts.paperTrading}</p>
              </div>
            </div>
          </div>
          <div className="bg-bg-tertiary p-4 rounded-lg shadow">
            <div className="flex items-center">
              <TrendingUp className="w-8 h-8 text-green-500 mr-3" />
              <div>
                <p className="text-sm text-gray-600">Live</p>
                <p className="text-2xl font-bold text-text-primary">{strategyCounts.live}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Confidence & Risk Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ConfidenceMeter score={confidence.score} level={confidence.level} paperTrades={summary.paperTrading?.totalTrades} />
          <div className="bg-bg-tertiary p-4 rounded-lg shadow flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Risk Assessment</p>
              <RiskBadge rating={risk.rating} drawdown={risk.averageMaxDrawdown} />
            </div>
            <Shield className="w-10 h-10 text-gray-300" />
          </div>
        </div>

        {/* Live Readiness Assessment */}
        <div className={`p-5 rounded-lg shadow border ${
          liveReadiness.ready
            ? 'bg-green-50 border-green-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-start">
            {liveReadiness.ready
              ? <CheckCircle2 className="w-6 h-6 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
              : <AlertTriangle className="w-6 h-6 text-amber-600 mr-3 mt-0.5 flex-shrink-0" />
            }
            <div>
              <h3 className={`font-semibold ${liveReadiness.ready ? 'text-green-800' : 'text-amber-800'}`}>
                {liveReadiness.ready ? 'Ready for Live Trading' : 'Not Yet Ready for Live Trading'}
              </h3>
              <ul className="mt-2 space-y-1">
                {liveReadiness.reasons.map((reason, i) => (
                  <li key={i} className={`text-sm flex items-start ${
                    liveReadiness.ready ? 'text-green-700' : 'text-amber-700'
                  }`}>
                    {liveReadiness.ready
                      ? <CheckCircle2 className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                      : <XCircle className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                    }
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Recent Strategy Events */}
        {summary.recentEvents.length > 0 && (
          <div className="bg-bg-tertiary p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium mb-4 flex items-center">
              <Clock className="w-5 h-5 mr-2 text-gray-500" />
              Recent Strategy Activity
            </h3>
            <div className="space-y-3">
              {summary.recentEvents.slice(0, 5).map((event, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-bg-secondary rounded-md">
                  <div className="flex items-center space-x-3">
                    <StatusBadge status={event.status} />
                    <div>
                      <p className="text-sm font-medium text-text-primary">{event.strategyName}</p>
                      <p className="text-xs text-text-muted">{event.symbol}</p>
                    </div>
                  </div>
                  <span className="text-xs text-text-muted">
                    {new Date(event.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Strategies Tab ─────────────────────────────────────────────────────────
  const renderStrategiesTab = () => {
    const strategies = summary?.strategyBreakdown || [];

    if (strategies.length === 0) {
      return (
        <div className="bg-bg-tertiary p-8 rounded-lg shadow text-center">
          <Zap className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Strategies Yet</h3>
          <p className="text-gray-600 mb-4">
            The autonomous agent has not generated any strategies yet.
            Start the agent to begin automated strategy development and backtesting.
          </p>
          <Link
            to="/autonomous-agent"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Zap className="w-4 h-4 mr-2" />
            Go to Autonomous Agent
          </Link>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="bg-bg-tertiary p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-2">Agent-Generated Strategies</h3>
          <p className="text-sm text-text-muted mb-4">
            These strategies were automatically developed, backtested, and validated by the autonomous trading agent.
          </p>
        </div>

        {strategies.map((strategy) => {
          const isExpanded = expandedStrategy === strategy.id;
          const matchingResult = pipelineResults.find(r => r.strategyId === strategy.id);

          return (
            <div
              key={strategy.id}
              className="bg-bg-tertiary rounded-lg shadow overflow-hidden"
            >
              <button
                onClick={() => setExpandedStrategy(isExpanded ? null : strategy.id)}
                className="w-full p-4 flex items-center justify-between hover:bg-bg-secondary transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <StatusBadge status={strategy.status} />
                  <div className="text-left">
                    <p className="font-medium text-text-primary">{strategy.name}</p>
                    <p className="text-xs text-text-muted">{strategy.symbol} · {strategy.timeframe}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  {strategy.performance.winRate != null && (
                    <span className="text-sm text-text-secondary">
                      WR: {(strategy.performance.winRate * 100).toFixed(1)}%
                    </span>
                  )}
                  {matchingResult && (
                    <span className={`text-sm font-medium ${
                      matchingResult.recommendation === 'deploy' ? 'text-green-600' :
                      matchingResult.recommendation === 'optimize' ? 'text-yellow-600' :
                      'text-red-600'
                    }`}>
                      {matchingResult.recommendation}
                    </span>
                  )}
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-border-subtle">
                  <div className="pt-4 space-y-4">
                    {/* Lifecycle */}
                    <div>
                      <p className="text-xs text-text-muted mb-2 font-medium">LIFECYCLE</p>
                      <LifecycleStage current={strategy.status} />
                    </div>

                    {/* Performance */}
                    {strategy.performance && (
                      Object.values(strategy.performance).some(v => v != null)
                    ) && (
                      <div>
                        <p className="text-xs text-text-muted mb-2 font-medium">BACKTEST PERFORMANCE</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {strategy.performance.winRate != null && (
                            <div className="bg-bg-secondary p-3 rounded">
                              <p className="text-xs text-text-muted">Win Rate</p>
                              <p className="text-sm font-bold">{((strategy.performance.winRate || 0) * 100).toFixed(1)}%</p>
                            </div>
                          )}
                          {strategy.performance.profitFactor != null && (
                            <div className="bg-bg-secondary p-3 rounded">
                              <p className="text-xs text-text-muted">Profit Factor</p>
                              <p className="text-sm font-bold">{(strategy.performance.profitFactor || 0).toFixed(2)}</p>
                            </div>
                          )}
                          {strategy.performance.totalTrades != null && (
                            <div className="bg-bg-secondary p-3 rounded">
                              <p className="text-xs text-text-muted">Total Trades</p>
                              <p className="text-sm font-bold">{strategy.performance.totalTrades || 0}</p>
                            </div>
                          )}
                          {strategy.performance.totalReturn != null && (
                            <div className="bg-bg-secondary p-3 rounded">
                              <p className="text-xs text-text-muted">Total Return</p>
                              <p className={`text-sm font-bold ${
                                (strategy.performance.totalReturn || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {((strategy.performance.totalReturn || 0) * 100).toFixed(2)}%
                              </p>
                            </div>
                          )}
                          {strategy.performance.sharpeRatio != null && (
                            <div className="bg-bg-secondary p-3 rounded">
                              <p className="text-xs text-text-muted">Sharpe Ratio</p>
                              <p className={`text-sm font-bold ${
                                (strategy.performance.sharpeRatio || 0) >= 1 ? 'text-green-600' :
                                (strategy.performance.sharpeRatio || 0) >= 0 ? 'text-yellow-600' : 'text-red-600'
                              }`}>
                                {(strategy.performance.sharpeRatio || 0).toFixed(2)}
                              </p>
                            </div>
                          )}
                          {strategy.performance.maxDrawdown != null && (
                            <div className="bg-bg-secondary p-3 rounded">
                              <p className="text-xs text-text-muted">Max Drawdown</p>
                              <p className="text-sm font-bold text-red-600">
                                {(strategy.performance.maxDrawdown || 0).toFixed(2)}%
                              </p>
                            </div>
                          )}
                        </div>
                        {Object.values(strategy.performance).every(v => v == null) && (
                          <p className="text-xs text-text-muted py-2">No performance metrics available yet.</p>
                        )}
                      </div>
                    )}

                    {/* Pipeline Result */}
                    {matchingResult && (
                      <div>
                        <p className="text-xs text-text-muted mb-2 font-medium">PIPELINE ASSESSMENT</p>
                        <ConfidenceMeter score={matchingResult.confidence.score} level={matchingResult.confidence.level} />
                        <div className={`mt-3 p-3 rounded-lg text-sm ${
                          matchingResult.recommendation === 'deploy' ? 'bg-green-50 text-green-800' :
                          matchingResult.recommendation === 'optimize' ? 'bg-yellow-50 text-yellow-800' :
                          'bg-red-50 text-red-800'
                        }`}>
                          <p className="font-medium mb-1">
                            Recommendation: {matchingResult.recommendation.toUpperCase()}
                          </p>
                          <p className="text-xs">{matchingResult.reasoning}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ─── Paper Trading Tab ──────────────────────────────────────────────────────
  const renderPaperTradingTab = () => {
    const paper = summary?.paperTrading;

    if (!paper) {
      return (
        <div className="bg-bg-tertiary p-8 rounded-lg shadow text-center">
          <Eye className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Paper Trading Data</h3>
          <p className="text-gray-600 mb-4">
            Paper trading validates strategies with simulated trades using your actual available balance
            before risking real funds.
          </p>
          <p className="text-sm text-text-muted">
            Strategies that pass backtesting are automatically promoted to paper trading by the agent.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Paper Trading Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-bg-tertiary p-4 rounded-lg shadow">
            <p className="text-sm text-gray-600">Active Sessions</p>
            <p className="text-2xl font-bold text-text-primary">{paper.activeSessions}</p>
            <p className="text-xs text-text-muted">of {paper.totalSessions} total</p>
          </div>
          <div className="bg-bg-tertiary p-4 rounded-lg shadow">
            <p className="text-sm text-gray-600">Realized P&L</p>
            <p className={`text-2xl font-bold ${paper.totalRealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {paper.totalRealizedPnl >= 0 ? '+' : ''}${paper.totalRealizedPnl.toFixed(2)}
            </p>
          </div>
          <div className="bg-bg-tertiary p-4 rounded-lg shadow">
            <p className="text-sm text-gray-600">Win Rate</p>
            <p className="text-2xl font-bold text-text-primary">{paper.winRate.toFixed(1)}%</p>
            <p className="text-xs text-text-muted">
              {paper.winningTrades}W / {paper.totalTrades - paper.winningTrades}L
            </p>
          </div>
          <div className="bg-bg-tertiary p-4 rounded-lg shadow">
            <p className="text-sm text-gray-600">Avg Return</p>
            <p className={`text-2xl font-bold ${paper.averageReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {paper.averageReturnPct >= 0 ? '+' : ''}{paper.averageReturnPct.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Unrealized P&L */}
        <div className="bg-bg-tertiary p-5 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-3 flex items-center">
            <Activity className="w-5 h-5 mr-2 text-blue-500" />
            Paper Trading Performance
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3 bg-bg-secondary rounded">
              <p className="text-sm text-text-muted">Total Trades</p>
              <p className="text-lg font-bold">{paper.totalTrades}</p>
            </div>
            <div className="p-3 bg-bg-secondary rounded">
              <p className="text-sm text-text-muted">Unrealized P&L</p>
              <p className={`text-lg font-bold ${paper.totalUnrealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {paper.totalUnrealizedPnl >= 0 ? '+' : ''}${paper.totalUnrealizedPnl.toFixed(2)}
              </p>
            </div>
            <div className="p-3 bg-bg-secondary rounded">
              <p className="text-sm text-text-muted">Combined P&L</p>
              <p className={`text-lg font-bold ${
                (paper.totalRealizedPnl + paper.totalUnrealizedPnl) >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {(paper.totalRealizedPnl + paper.totalUnrealizedPnl) >= 0 ? '+' : ''}
                ${(paper.totalRealizedPnl + paper.totalUnrealizedPnl).toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Simulation Balance Context */}
        {simulationBalance > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center">
              <Target className="w-5 h-5 text-blue-600 mr-3" />
              <div>
                <p className="text-sm text-blue-800">
                  Paper trading simulations are calibrated to your available balance of{' '}
                  <span className="font-semibold">
                    ${simulationBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </span>
                  , providing realistic results for when you switch to live mode.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Readiness Tab ──────────────────────────────────────────────────────────
  const renderReadinessTab = () => {
    if (!summary) {
      return (
        <div className="bg-bg-tertiary p-8 rounded-lg shadow text-center">
          <Shield className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">Live Readiness Assessment</h3>
          <p className="text-gray-600">
            Once the agent generates and validates strategies, a comprehensive readiness assessment will appear here.
          </p>
        </div>
      );
    }

    const { confidence, risk, liveReadiness, paperTrading } = summary;

    return (
      <div className="space-y-6">
        {/* Readiness Verdict */}
        <div className={`p-6 rounded-lg shadow-lg border-2 ${
          liveReadiness.ready
            ? 'bg-green-50 border-green-300'
            : 'bg-amber-50 border-amber-300'
        }`}>
          <div className="flex items-center mb-4">
            {liveReadiness.ready
              ? <CheckCircle2 className="w-8 h-8 text-green-600 mr-3" />
              : <AlertTriangle className="w-8 h-8 text-amber-600 mr-3" />
            }
            <div>
              <h2 className={`text-xl font-bold ${liveReadiness.ready ? 'text-green-800' : 'text-amber-800'}`}>
                {liveReadiness.ready
                  ? 'Your strategies are ready for live trading'
                  : 'Additional validation needed before live trading'}
              </h2>
            </div>
          </div>
          <ul className="space-y-2 ml-11">
            {liveReadiness.reasons.map((reason, i) => (
              <li key={i} className={`text-sm flex items-start ${
                liveReadiness.ready ? 'text-green-700' : 'text-amber-700'
              }`}>
                {liveReadiness.ready
                  ? <CheckCircle2 className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                  : <XCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                }
                {reason}
              </li>
            ))}
          </ul>
        </div>

        {/* Detailed Assessment Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Confidence Assessment */}
          <div className="bg-bg-tertiary p-5 rounded-lg shadow">
            <h3 className="text-base font-semibold mb-3 flex items-center">
              <Brain className="w-5 h-5 mr-2 text-purple-500" />
              Strategy Confidence
            </h3>
            <ConfidenceMeter score={confidence.score} level={confidence.level} paperTrades={summary.paperTrading?.totalTrades} />
            <p className="text-xs text-text-muted mt-3">
              Based on backtesting performance across all agent-generated strategies.
              A score above 60 is considered sufficient for live deployment.
            </p>
          </div>

          {/* Risk Assessment */}
          <div className="bg-bg-tertiary p-5 rounded-lg shadow">
            <h3 className="text-base font-semibold mb-3 flex items-center">
              <Shield className="w-5 h-5 mr-2 text-orange-500" />
              Risk Profile
            </h3>
            <div className="mb-3">
              <RiskBadge rating={risk.rating} drawdown={risk.averageMaxDrawdown} />
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Avg Max Drawdown</span>
                <span className="font-medium">{risk.averageMaxDrawdown.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Risk Rating</span>
                <span className="font-medium capitalize">{risk.rating.replace('_', ' ')}</span>
              </div>
            </div>
            <p className="text-xs text-text-muted mt-3">
              A lower max drawdown indicates more consistent performance.
              Strategies with drawdown above 20% are flagged as high risk.
            </p>
          </div>
        </div>

        {/* Paper Trading Validation */}
        <div className="bg-bg-tertiary p-5 rounded-lg shadow">
          <h3 className="text-base font-semibold mb-3 flex items-center">
            <Eye className="w-5 h-5 mr-2 text-yellow-500" />
            Paper Trading Validation
          </h3>
          {paperTrading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-bg-secondary rounded text-center">
                <p className="text-xs text-text-muted">Sessions</p>
                <p className="text-lg font-bold">{paperTrading.totalSessions}</p>
              </div>
              <div className="p-3 bg-bg-secondary rounded text-center">
                <p className="text-xs text-text-muted">Win Rate</p>
                <p className={`text-lg font-bold ${paperTrading.winRate >= 55 ? 'text-green-600' : 'text-orange-600'}`}>
                  {paperTrading.winRate.toFixed(1)}%
                </p>
              </div>
              <div className="p-3 bg-bg-secondary rounded text-center">
                <p className="text-xs text-text-muted">Realized P&L</p>
                <p className={`text-lg font-bold ${paperTrading.totalRealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${paperTrading.totalRealizedPnl.toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-bg-secondary rounded text-center">
                <p className="text-xs text-text-muted">Avg Return</p>
                <p className={`text-lg font-bold ${paperTrading.averageReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {paperTrading.averageReturnPct.toFixed(2)}%
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-text-muted">
                No paper trading data available yet. Strategies that pass backtesting will be automatically promoted to paper trading.
              </p>
            </div>
          )}
        </div>

        {/* Simulation Balance */}
        {simulationBalance > 0 && (
          <div className="bg-bg-tertiary p-5 rounded-lg shadow">
            <h3 className="text-base font-semibold mb-3 flex items-center">
              <Target className="w-5 h-5 mr-2 text-blue-500" />
              Balance-Based Simulation
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              All backtesting and paper trading simulations use your actual available balance as the baseline,
              ensuring realistic performance projections for live trading.
            </p>
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-blue-800">Available for Live Trading</span>
                <span className="text-xl font-bold text-blue-900">
                  ${simulationBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-text-primary flex items-center">
            <Zap className="w-8 h-8 mr-3 text-brand-cyan" />
            Automated Backtesting Pipeline
          </h1>
          <p className="mt-2 text-gray-600">
            Agent-driven strategy development, backtesting, paper trading validation, and live-readiness assessment
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-xs text-text-muted">
              Updated {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refreshData}
            disabled={loading}
            className="flex items-center px-3 py-2 bg-bg-tertiary border border-border-subtle rounded-md hover:bg-bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {fetchError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-800 font-medium">{fetchError}</p>
            <p className="text-xs text-red-600 mt-1">Auto-refreshing every 30 seconds</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6">
        <div className="border-b border-border-subtle">
          <nav className="-mb-px flex space-x-8">
            {([
              { id: 'overview' as const, label: 'Overview', icon: BarChart3 },
              { id: 'strategies' as const, label: 'Strategies', icon: Brain },
              { id: 'paper' as const, label: 'Paper Trading', icon: Eye },
              { id: 'readiness' as const, label: 'Live Readiness', icon: Shield }
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                  activeTab === id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border-moderate'
                }`}
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && renderOverviewTab()}
      {activeTab === 'strategies' && renderStrategiesTab()}
      {activeTab === 'paper' && renderPaperTradingTab()}
      {activeTab === 'readiness' && renderReadinessTab()}
    </div>
  );
};

export default Backtesting;
