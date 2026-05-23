import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Brain, TrendingUp, Shield } from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '@/utils/auth';
import { usePersistedState } from '@/hooks/usePersistedState';
import { getBackendUrl } from '@/utils/environment';
import ActiveStrategiesPanel from './ActiveStrategiesPanel';
import KernelTelemetryPanel from './KernelTelemetryPanel';
import LiveTradingActivityFeed from './LiveTradingActivityFeed';
import PerformanceAnalytics from './PerformanceAnalytics';
import StateOfTheBotCard from './StateOfTheBotCard';
import { safeNum } from '@/utils/safeNum';

const API_BASE_URL = getBackendUrl();

/**
 * AutonomousAgentDashboard — kernel-OBSERVATION panel for /autonomous-agent.
 *
 * The Monkey kernel is the sole autonomous trader (the multi-engine
 * FAT/LiveSignal/Persistent/agentScheduler era was deleted in PR #878).
 * The operator's objective is fixed — "as profitable, as fast as
 * possible" — and the kernel observes and sets ALL of its own
 * parameters per the P1 / observer-pattern principle: there is no
 * operator risk-appetite, trading-style, leverage or strategy-interval
 * knob. The kernel trades every lane (scalp/swing/trend) and picks the
 * best per-trade.
 *
 * This page therefore OBSERVES the kernel; it does not configure it.
 * The only genuine operator-MANDATE control kept is the execution-mode
 * pause/kill switch. The audited leverage cap is shown READ-ONLY.
 */

interface AgentStatus {
  id: string;
  userId: string;
  /** Legacy enum — 'running' ⇔ kernelStatus 'active', 'stopped' ⇔ 'idle'. */
  status: 'running' | 'stopped' | 'paused';
  /** PR6 — precise kernel-trading state. Prefer this for the badge. */
  kernelStatus?: 'active' | 'idle' | 'paused';
  openLivePositions?: number;
  executionMode?: 'auto' | 'paper_only' | 'pause' | null;
  liveTradesExecuted: number;
  openPositions: number;
  totalPnl: number;
}

interface AgentEvent {
  id: string;
  event_type: string;
  execution_mode: string;
  description: string;
  explanation: string;
  confidence_score: number;
  created_at: string;
}

/** Read-only leverage cap surfaced from the risk_settings table. */
interface LeverageCap {
  maxLeverage: number;
  riskLevel: string;
}

const AutonomousAgentDashboard: React.FC = () => {
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'polling'>('polling');
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [eventFilter, setEventFilter] = useState<'all' | 'trade_decision' | 'state_change' | 'risk_action' | 'health_alert' | 'error'>('all');
  const [leverageCap, setLeverageCap] = useState<LeverageCap | null>(null);

  // Execution Mode is the ONLY operator-MANDATE control on this page —
  // a SAFETY OVERRIDE enforced by the server-side risk kernel. The UI
  // fetches the authoritative value on mount and pushes updates via PUT;
  // the localStorage cache is just an optimistic value so the buttons
  // feel responsive before the PUT completes.
  //
  // 'auto'        — kernel trades live
  // 'paper_only'  — kernel blocks all live orders; paper continues
  // 'pause'       — kernel blocks ALL new orders (kill switch)
  //
  // Legacy localStorage values ('paper' | 'backtest' | 'live') coerce to
  // the nearest valid server-side mode.
  const [executionModeRaw, setExecutionModeRaw] = usePersistedState<'auto' | 'paper_only' | 'pause' | 'backtest' | 'paper' | 'live'>('agent_execution_mode', 'auto');
  const executionMode: 'auto' | 'paper_only' | 'pause' =
    executionModeRaw === 'paper' || executionModeRaw === 'paper_only'
      ? 'paper_only'
      : executionModeRaw === 'pause'
        ? 'pause'
        : 'auto';
  const [executionModeUpdating, setExecutionModeUpdating] = useState(false);

  /** PUT the new mode to the server and reflect the returned value. */
  const setExecutionMode = useCallback(async (v: 'auto' | 'paper_only' | 'pause') => {
    setExecutionModeRaw(v);
    setExecutionModeUpdating(true);
    try {
      const token = getAccessToken();
      const response = await axios.put(
        `${API_BASE_URL}/api/agent/execution-mode`,
        { mode: v, reason: 'ui_toggle' },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.data?.success && response.data?.mode) {
        setExecutionModeRaw(response.data.mode);
      }
    } catch (err) {
      console.error('Failed to update execution mode', err);
      // Best-effort refetch of the authoritative value.
      try {
        const token = getAccessToken();
        const response = await axios.get(`${API_BASE_URL}/api/agent/execution-mode`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.data?.mode) setExecutionModeRaw(response.data.mode);
      } catch {
        // swallow; UI will show the last good value
      }
    } finally {
      setExecutionModeUpdating(false);
    }
  }, [setExecutionModeRaw]);

  /** Pull server-authoritative mode on mount so UI matches reality. */
  useEffect(() => {
    (async () => {
      try {
        const token = getAccessToken();
        const response = await axios.get(`${API_BASE_URL}/api/agent/execution-mode`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.data?.mode) setExecutionModeRaw(response.data.mode);
      } catch {
        // Endpoint may be missing in older backends; keep localStorage value.
      }
    })();
  }, [setExecutionModeRaw]);

  const getAuthHeaders = useCallback(() => {
    const token = getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }, []);

  const fetchAgentStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/agent/status`, {
        headers: getAuthHeaders(),
      });
      if (response.data.success) {
        setAgentStatus(response.data.status);
      }
      setLastPolled(new Date());
    } catch {
      setLastPolled(new Date());
    }
  }, [getAuthHeaders]);

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (eventFilter !== 'all') params.set('type', eventFilter);
      const response = await axios.get(`${API_BASE_URL}/api/agent/events?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (response.data.success) {
        setAgentEvents(response.data.events);
      }
    } catch {
      // Events are non-critical
    }
  }, [eventFilter, getAuthHeaders]);

  /**
   * Read the audited leverage cap from the risk_settings table. This is
   * the one risk number this page DISPLAYS — read-only. The kernel
   * clamps to this ceiling regardless; the operator does not soak-and-
   * dial it from here. Mutating it lives on the dedicated Risk Settings
   * surface, not this observation panel.
   */
  const fetchLeverageCap = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/risk/settings`, {
        headers: getAuthHeaders(),
      });
      if (response.data?.success && response.data?.settings) {
        setLeverageCap({
          maxLeverage: Number(response.data.settings.maxLeverage) || 0,
          riskLevel: String(response.data.settings.riskLevel ?? 'moderate'),
        });
      }
    } catch {
      // Non-critical — leave the cap display hidden.
    }
  }, [getAuthHeaders]);

  // Initial fetch + WebSocket setup (runs once).
  useEffect(() => {
    fetchAgentStatus();
    fetchEvents();
    fetchLeverageCap();

    let socket: { on: (event: string, cb: (data: unknown) => void) => void; disconnect: () => void } | null = null;
    import('socket.io-client').then(({ io }) => {
      const s = io(API_BASE_URL, { transports: ['websocket', 'polling'] });
      socket = s as unknown as typeof socket;
      s.on('connect', () => setConnectionStatus('connected'));
      s.on('disconnect', () => setConnectionStatus('polling'));
      s.on('agent:activity', () => {
        // Any kernel activity — refresh the observed status counters.
        fetchAgentStatus();
      });
    }).catch(() => {
      setConnectionStatus('polling');
    });

    return () => {
      if (socket) socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch the event timeline when the filter pill changes.
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Polling — the kernel runs continuously, so the page polls on a
  // steady 15s heartbeat regardless of the on/off badge.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAgentStatus();
      fetchEvents();
      fetchLeverageCap();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchAgentStatus, fetchEvents, fetchLeverageCap]);

  // The kernel-trading badge. Prefer the precise kernelStatus; fall back
  // to the legacy enum for older backends.
  const kernelStatus: 'active' | 'idle' | 'paused' =
    agentStatus?.kernelStatus
      ?? (agentStatus?.status === 'running'
        ? 'active'
        : agentStatus?.status === 'paused'
          ? 'paused'
          : 'idle');

  const kernelAgentStatus = kernelStatus === 'active' ? 'running' : kernelStatus;

  const badgeStyle: Record<'active' | 'idle' | 'paused', { label: string; dot: string; text: string }> = {
    active: { label: 'Trading', dot: 'bg-green-500 animate-pulse', text: 'text-green-700' },
    idle: { label: 'Idle', dot: 'bg-gray-400', text: 'text-gray-600' },
    paused: { label: 'Paused', dot: 'bg-amber-500', text: 'text-amber-700' },
  };
  const badge = badgeStyle[kernelStatus];

  return (
    <div className="p-6 space-y-6">
      {/* Gradient Header — kernel on/off badge lives here. There is no
          start/stop button: the kernel runs autonomously. The only
          operator control is the execution-mode pause/kill below. */}
      <div className="bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg p-8 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Brain className="w-8 h-8" />
              Autonomous Trading Kernel
            </h1>
            <p className="mt-2 opacity-90">
              The Monkey kernel observes the market and sets all of its own
              parameters — objective: as profitable, as fast as possible.
            </p>
          </div>
          <div
            className="flex items-center gap-2 bg-white/15 rounded-lg px-4 py-3"
            role="status"
            aria-label={`Kernel status: ${badge.label}`}
          >
            <span className={`inline-block w-3 h-3 rounded-full ${badge.dot}`} />
            <span className="font-semibold text-lg">{badge.label}</span>
          </div>
        </div>
      </div>

      {/* Execution Mode — the ONLY operator-MANDATE control. A safety
          override enforced server-side by the risk kernel. */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1">Execution Mode</h3>
        <p className="text-sm text-gray-500 mb-4">
          Operator safety override. The kernel decides everything else —
          this is the one control you hold.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([
            { value: 'auto', label: 'Auto', desc: 'Kernel trades live', icon: '🤖', bgClass: 'border-green-500 bg-green-50' },
            { value: 'paper_only', label: 'Paper-Only', desc: 'Block all live orders', icon: '📝', bgClass: 'border-blue-500 bg-blue-50' },
            { value: 'pause', label: 'Pause', desc: 'Kill switch — no new orders', icon: '⏸️', bgClass: 'border-amber-500 bg-amber-50' },
          ] as const).map(opt => (
            <button
              key={opt.value}
              onClick={() => setExecutionMode(opt.value)}
              disabled={executionModeUpdating}
              className={`p-3 rounded-lg border-2 text-left transition-all disabled:opacity-50 ${
                executionMode === opt.value ? opt.bgClass : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="font-semibold text-sm text-gray-900">{opt.icon} {opt.label}</p>
              <p className="text-xs text-gray-500 mt-1">{opt.desc}</p>
            </button>
          ))}
        </div>
        {executionMode === 'auto' && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm font-medium">⚠️ Auto Mode — the kernel is placing real-capital orders</p>
            <p className="text-red-600 text-xs mt-1">Switch to Pause to halt all new orders immediately.</p>
          </div>
        )}
        {/* Audited leverage cap — READ-ONLY. The kernel observes and sets
            its own per-trade leverage; this is the audited ceiling it
            clamps to, shown for transparency. Mutating it lives on the
            dedicated Risk Settings surface, not this observation panel. */}
        {leverageCap && (
          <div className="mt-4 flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <Shield className="w-5 h-5 text-gray-500 flex-shrink-0" />
            <div className="text-sm">
              <span className="text-gray-600">Audited leverage cap:</span>{' '}
              <span className="font-semibold text-gray-900">{leverageCap.maxLeverage}x</span>
              <span className="text-gray-400"> · risk tier {leverageCap.riskLevel} · read-only</span>
            </div>
          </div>
        )}
      </div>

      {/* Emergency kill switch — surfaced while the kernel is trading
          live and the execution mode still permits live orders. */}
      {kernelStatus === 'active' && executionMode === 'auto' && (
        <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-red-600" />
            <div>
              <p className="font-semibold text-red-800">Live Trading Active</p>
              <p className="text-sm text-red-600">Kill switch — immediately halts all new live orders</p>
            </div>
          </div>
          <button
            onClick={() => setExecutionMode('pause')}
            disabled={executionModeUpdating}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors shadow-lg hover:shadow-xl animate-pulse disabled:opacity-50"
          >
            🛑 KILL SWITCH
          </button>
        </div>
      )}

      {/* Connection & last-poll status bar */}
      <div className="bg-white rounded-lg shadow p-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' :
            connectionStatus === 'polling' ? 'bg-yellow-500' :
            'bg-red-500'
          }`} />
          <span className="text-gray-600">
            {connectionStatus === 'connected' ? 'Live WebSocket' :
             connectionStatus === 'polling' ? 'Polling' :
             'Disconnected'}
          </span>
        </div>
        {lastPolled && (
          <span className="text-gray-400 text-xs">
            Last checked: {lastPolled.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/*
        State-of-the-Bot card: the single-source-of-truth "what is the
        kernel doing right now and is it making money?" headline —
        phase, real LIVE realized P&L, open positions, leverage in use,
        win rate, exchange-vs-DB sync.
      */}
      <StateOfTheBotCard />

      {/* Live realized-PnL / position summary cards. totalPnl is the
          LIVE engine's realized PnL only (engine_type='live' filter). */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className="bg-white rounded-lg p-6 shadow-lg"
          role="status"
          aria-label={`Kernel status: ${badge.label}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Kernel</span>
            <Activity className={`w-5 h-5 ${badge.text}`} />
          </div>
          <p className={`text-2xl font-bold ${badge.text}`}>{badge.label}</p>
        </div>

        <div
          className="bg-white rounded-lg p-6 shadow-lg"
          role="status"
          aria-label={`Open positions: ${agentStatus?.openPositions ?? 0}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Open Positions</span>
            <Shield className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{agentStatus?.openPositions ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">
            {agentStatus?.liveTradesExecuted ?? 0} live trades all-time
          </p>
        </div>

        <div
          className="bg-white rounded-lg p-6 shadow-lg"
          role="status"
          aria-label={`Live realized P&L: $${safeNum(agentStatus?.totalPnl ?? 0).toFixed(2)}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600 text-sm font-medium">Live Realized P&L</span>
            <TrendingUp className={`w-5 h-5 ${(agentStatus?.totalPnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`} />
          </div>
          <p className={`text-2xl font-bold ${(agentStatus?.totalPnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${safeNum(agentStatus?.totalPnl ?? 0).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Active strategies / lanes the kernel is running. */}
      <ActiveStrategiesPanel agentStatus={kernelAgentStatus} />

      {/* Performance analytics — live realized performance. */}
      <PerformanceAnalytics agentStatus={kernelAgentStatus} performanceMode="live" />

      <KernelTelemetryPanel />

      {/* Live trading activity feed. */}
      <LiveTradingActivityFeed agentStatus={kernelAgentStatus} />

      {/* Agent event timeline — kernel decisions, state changes, risk. */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-600" />
              Kernel Event Timeline
            </h2>
            <div className="flex gap-1">
              {(['all', 'trade_decision', 'state_change', 'risk_action', 'health_alert', 'error'] as const).map(filter => (
                <button key={filter}
                  onClick={() => setEventFilter(filter)}
                  className={`px-3 py-1 text-xs rounded-full transition-colors ${
                    eventFilter === filter
                      ? 'bg-cyan-100 text-cyan-700 font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}>
                  {filter === 'all' ? 'All' : filter.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="p-6 max-h-96 overflow-y-auto">
          {agentEvents.length > 0 ? (
            <div className="space-y-3">
              {agentEvents.map((event) => (
                <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors border-l-4 border-l-cyan-400">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        event.event_type === 'trade_decision' ? 'bg-green-100 text-green-700' :
                        event.event_type === 'risk_action' ? 'bg-red-100 text-red-700' :
                        event.event_type === 'state_change' ? 'bg-blue-100 text-blue-700' :
                        event.event_type === 'health_alert' ? 'bg-orange-100 text-orange-700' :
                        event.event_type === 'error' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>{event.event_type?.replace(/_/g, ' ') || 'event'}</span>
                      {event.execution_mode && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          event.execution_mode === 'live' ? 'bg-red-100 text-red-700' :
                          event.execution_mode === 'paper' ? 'bg-blue-100 text-blue-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>{event.execution_mode}</span>
                      )}
                      {event.confidence_score !== null && (
                        <span className="text-xs text-gray-500">Confidence: {safeNum(event.confidence_score).toFixed(1)}%</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900">{event.description}</p>
                    {event.explanation && (
                      <p className="text-xs text-gray-500 mt-1">{event.explanation}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No kernel events yet</p>
              <p className="text-gray-400 text-sm mt-1">Events appear here as the kernel makes decisions</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default AutonomousAgentDashboard;
