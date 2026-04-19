import axios from 'axios';
import { Activity, AlertTriangle, CheckCircle2, Pause, Radio } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';

const API_BASE_URL = getBackendUrl();

/**
 * State-of-the-Bot headline card. Single source of truth for the
 * question "what is the bot doing right now, and is it making money?"
 *
 * Phase dominates the design — the literal UX bug on 2026-04-18 was
 * the old dashboard reading "Live Trading Active" for 12 straight
 * hours while the bot was silently stuck in stacking-guard-skip loops.
 * This card makes that invisible state visible in one word.
 *
 * Backend: GET /api/agent/state-of-bot
 */

type Phase = 'trading' | 'skipping' | 'paused' | 'degraded' | 'evaluating';

interface PnLBucket {
  realized: number;
  trades: number;
}

interface StateOfBot {
  phase: Phase;
  phaseReason: string;
  executionMode: 'auto' | 'paper_only' | 'pause';
  lastTickAt: string | null;
  pnl: Record<'24h' | '7d' | '30d' | 'all', PnLBucket>;
  tradesPerHour: number;
  winRateLast20: number;
  exchangeOpenPositions: number;
  dbOpenPositions: number;
  positionStateInSync: boolean;
  balance: { equity: number; currency: string };
  currentLeverage: number;
}

type PnLWindow = '24h' | '7d' | '30d' | 'all';

const PHASE_STYLE: Record<Phase, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  trading:    { label: 'TRADING',    bg: 'bg-green-100',  text: 'text-green-800',  icon: <Radio className="w-6 h-6 animate-pulse" /> },
  skipping:   { label: 'SKIPPING',   bg: 'bg-amber-100',  text: 'text-amber-800',  icon: <Activity className="w-6 h-6" /> },
  paused:     { label: 'PAUSED',     bg: 'bg-gray-100',   text: 'text-gray-700',   icon: <Pause className="w-6 h-6" /> },
  degraded:   { label: 'DEGRADED',   bg: 'bg-red-100',    text: 'text-red-800',    icon: <AlertTriangle className="w-6 h-6" /> },
  evaluating: { label: 'EVALUATING', bg: 'bg-blue-100',   text: 'text-blue-800',   icon: <Activity className="w-6 h-6" /> },
};

const formatUSD = (v: number): string => {
  const prefix = v > 0 ? '+$' : v < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(v).toFixed(2)}`;
};

const formatPct = (v: number): string => `${(v * 100).toFixed(1)}%`;

const formatAge = (iso: string | null): string => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
};

const StateOfTheBotCard: React.FC = () => {
  const [state, setState] = useState<StateOfBot | null>(null);
  const [window, setWindow] = useState<PnLWindow>('24h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const token = getAccessToken();
      const resp = await axios.get(`${API_BASE_URL}/api/agent/state-of-bot`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.data?.success) {
        setState(resp.data);
        setError(null);
      } else {
        setError(resp.data?.error || 'Failed to load state');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    // 15s poll — state-of-bot is the canonical dashboard heartbeat.
    // Anything less frequent makes "TRADING" feel delayed.
    const t = setInterval(fetchState, 15_000);
    return () => clearInterval(t);
  }, [fetchState]);

  if (loading && !state) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6 animate-pulse h-48" />
    );
  }
  if (error && !state) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6 border border-red-200">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-5 h-5" />
          <span className="font-semibold">State-of-bot unavailable</span>
        </div>
        <p className="text-sm text-red-600 mt-1">{error}</p>
      </div>
    );
  }
  if (!state) return null;

  const phaseStyle = PHASE_STYLE[state.phase];
  const bucket = state.pnl[window];

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header row: phase badge + mode + last tick */}
      <div className={`${phaseStyle.bg} px-6 py-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <span className={phaseStyle.text}>{phaseStyle.icon}</span>
          <div>
            <h2 className={`text-2xl font-black tracking-tight ${phaseStyle.text}`}>
              {phaseStyle.label}
            </h2>
            <p className={`text-sm ${phaseStyle.text} opacity-90`}>{state.phaseReason}</p>
          </div>
        </div>
        <div className={`text-right text-sm ${phaseStyle.text}`}>
          <div>Mode: <span className="font-semibold capitalize">{state.executionMode.replace('_', '-')}</span></div>
          <div className="opacity-75">Last tick: {formatAge(state.lastTickAt)}</div>
        </div>
      </div>

      {/* P&L with timeframe toggle */}
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600">Realized P&L</span>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['24h', '7d', '30d', 'all'] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  window === w
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-baseline gap-3">
          <span
            className={`text-4xl font-bold ${
              bucket.realized > 0 ? 'text-green-600' : bucket.realized < 0 ? 'text-red-600' : 'text-gray-700'
            }`}
          >
            {formatUSD(bucket.realized)}
          </span>
          <span className="text-sm text-gray-500">
            across {bucket.trades} realized trade{bucket.trades === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Activity row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 border-b border-gray-100 text-sm">
        <div>
          <div className="text-gray-500">Trades/hr (24h)</div>
          <div className="text-lg font-semibold text-gray-900">{state.tradesPerHour.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-gray-500">Win rate (last 20)</div>
          <div className="text-lg font-semibold text-gray-900">{formatPct(state.winRateLast20)}</div>
        </div>
        <div>
          <div className="text-gray-500">Balance</div>
          <div className="text-lg font-semibold text-gray-900">
            ${state.balance.equity.toFixed(2)} {state.balance.currency}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Leverage in use</div>
          <div className="text-lg font-semibold text-gray-900">
            {state.currentLeverage > 0 ? `${state.currentLeverage}x` : '—'}
          </div>
        </div>
      </div>

      {/* Exchange vs DB sync row — divergence alarms loudly */}
      <div
        className={`px-6 py-3 text-sm flex items-center gap-2 ${
          state.positionStateInSync
            ? 'bg-gray-50 text-gray-600'
            : 'bg-red-50 text-red-700 font-medium'
        }`}
      >
        {state.positionStateInSync ? (
          <CheckCircle2 className="w-4 h-4 text-green-600" />
        ) : (
          <AlertTriangle className="w-4 h-4" />
        )}
        <span>
          Exchange: {state.exchangeOpenPositions} open · DB: {state.dbOpenPositions} open
          {state.positionStateInSync ? ' · in sync' : ' · DIVERGENCE — phantom state likely'}
        </span>
      </div>
    </div>
  );
};

export default StateOfTheBotCard;
