import { useEffect, useState } from 'react';
import axios from 'axios';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { getBackendUrl } from '@/utils/environment';
import { safeNum } from '@/utils/safeNum';

const API_BASE_URL = getBackendUrl();
const POLL_INTERVAL_MS = 30_000;

interface ObservableGovernanceReport {
  available?: boolean;
  error?: string;
  amplitude_violations?: Array<{ type?: string; [k: string]: unknown }>;
  regime_violations?: Array<{ type?: string; regime?: string; [k: string]: unknown }>;
  signal_distribution?: { buy?: number; sell?: number; hold?: number; bias?: number };
  drift?: { mean?: number; std?: number };
  n?: number;
  tick_count_total?: number;
  recent_h_j?: { h?: number | null; J?: number | null; h_over_J?: number | null };
}

interface ForecastObserverReport {
  available?: boolean;
  error?: string;
  observer?: {
    n_per_regime?: Record<string, number>;
    amplitude_per_regime?: Record<string, number>;
    temporal_scale_per_regime_lags?: Record<string, number>;
    warmup_regimes?: string[];
  };
  regime_history_per_symbol?: Record<string, { len: number; recent: string[] }>;
}

interface GovernanceStatusResponse {
  observable_governance?: ObservableGovernanceReport;
  forecast_governance?: ForecastObserverReport;
  ml_worker_url_configured?: boolean;
  fetched_at?: string;
  error?: string;
  message?: string;
}

function pct(n: number | undefined | null, digits = 1): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `${safeNum(n * 100).toFixed(digits)}%`;
}

function fmt(n: number | undefined | null, digits = 4): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return safeNum(n).toFixed(digits);
}

export default function GovernanceStatusPanel() {
  const [data, setData] = useState<GovernanceStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('auth_token') ?? localStorage.getItem('access_token');
      const res = await axios.get<GovernanceStatusResponse>(`${API_BASE_URL}/api/governance/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 8000,
      });
      setData(res.data);
      setLastFetched(new Date());
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message || err.response?.data?.error || err.message
        : err instanceof Error ? err.message : String(err);
      setError(String(message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const og = data?.observable_governance;
  const fg = data?.forecast_governance;
  const ogAvailable = og?.available !== false && !og?.error;
  const fgAvailable = fg?.available !== false && !fg?.error;
  const amplViolations = og?.amplitude_violations ?? [];
  const regimeViolations = og?.regime_violations ?? [];
  const totalViolations = amplViolations.length + regimeViolations.length;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-cyan-600" />
          <h2 className="text-lg font-semibold text-gray-900">Governance Status</h2>
          {totalViolations > 0 ? (
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {totalViolations} {totalViolations === 1 ? 'violation' : 'violations'}
            </span>
          ) : ogAvailable && fgAvailable ? (
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              clean
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {lastFetched && <span>Updated {lastFetched.toLocaleTimeString()}</span>}
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-50"
            aria-label="Refresh governance status"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          Failed to fetch: {error}
        </div>
      )}

      {!data && !error && !loading && (
        <p className="text-sm text-gray-500">No data yet.</p>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Observable Governance</h3>
            {ogAvailable ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Ticks observed</span>
                  <span className="font-mono text-gray-900">{og?.tick_count_total ?? og?.n ?? '—'}</span>
                </div>
                {og?.signal_distribution && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Signal mix (buy / sell / hold)</span>
                    <span className="font-mono text-gray-900">
                      {og.signal_distribution.buy ?? 0} / {og.signal_distribution.sell ?? 0} / {og.signal_distribution.hold ?? 0}
                      {typeof og.signal_distribution.bias === 'number' && (
                        <span className="ml-2 text-xs text-gray-500">bias {pct(og.signal_distribution.bias)}</span>
                      )}
                    </span>
                  </div>
                )}
                {og?.drift && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Drift μ ± σ</span>
                    <span className="font-mono text-gray-900">
                      {fmt(og.drift.mean)} ± {fmt(og.drift.std)}
                    </span>
                  </div>
                )}
                {og?.recent_h_j && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Recent h / J / h-over-J</span>
                    <span className="font-mono text-gray-900">
                      {fmt(og.recent_h_j.h, 3)} / {fmt(og.recent_h_j.J, 3)} / {fmt(og.recent_h_j.h_over_J, 2)}
                    </span>
                  </div>
                )}
                {amplViolations.length > 0 && (
                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded">
                    <div className="text-xs font-medium text-amber-800 mb-1">
                      {amplViolations.length} amplitude violation{amplViolations.length === 1 ? '' : 's'}
                    </div>
                    <ul className="text-xs text-amber-900 space-y-0.5">
                      {amplViolations.slice(0, 3).map((v, i) => (
                        <li key={i} className="font-mono">{String(v.type ?? 'unknown')}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {regimeViolations.length > 0 && (
                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded">
                    <div className="text-xs font-medium text-amber-800 mb-1">
                      {regimeViolations.length} regime violation{regimeViolations.length === 1 ? '' : 's'}
                    </div>
                    <ul className="text-xs text-amber-900 space-y-0.5">
                      {regimeViolations.slice(0, 3).map((v, i) => (
                        <li key={i} className="font-mono">
                          {String(v.type ?? 'unknown')}{v.regime ? ` (${v.regime})` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {og?.error ? `Unavailable: ${og.error}` : 'Detector pool not initialised yet.'}
              </p>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Forecast Observer (CAL-4)</h3>
            {fgAvailable && fg?.observer ? (
              <div className="space-y-2 text-sm">
                {fg.observer.warmup_regimes && fg.observer.warmup_regimes.length > 0 && (
                  <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
                    <span className="font-medium">Warming up:</span>{' '}
                    {fg.observer.warmup_regimes.join(', ')}
                  </div>
                )}
                {fg.observer.n_per_regime && (
                  <div>
                    <div className="text-gray-600 mb-1">Observations per regime</div>
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                      {Object.entries(fg.observer.n_per_regime).map(([regime, n]) => (
                        <div key={regime} className="text-center">
                          <div className="text-gray-500">{regime}</div>
                          <div className="text-gray-900 font-semibold">{n}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {fg.observer.amplitude_per_regime && (
                  <div>
                    <div className="text-gray-600 mb-1">Amplitude (observer-derived)</div>
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                      {Object.entries(fg.observer.amplitude_per_regime).map(([regime, amp]) => (
                        <div key={regime} className="text-center">
                          <div className="text-gray-500">{regime}</div>
                          <div className="text-gray-900 font-semibold">{fmt(amp, 3)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {fg.observer.temporal_scale_per_regime_lags && (
                  <div>
                    <div className="text-gray-600 mb-1">Temporal scale (1/e lags)</div>
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                      {Object.entries(fg.observer.temporal_scale_per_regime_lags).map(([regime, lags]) => (
                        <div key={regime} className="text-center">
                          <div className="text-gray-500">{regime}</div>
                          <div className="text-gray-900 font-semibold">{fmt(lags, 1)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {fg.regime_history_per_symbol && Object.keys(fg.regime_history_per_symbol).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="text-gray-600 mb-1 text-xs">Recent regime per symbol</div>
                    <ul className="text-xs space-y-1">
                      {Object.entries(fg.regime_history_per_symbol).map(([sym, h]) => (
                        <li key={sym} className="flex justify-between">
                          <span className="font-mono text-gray-700">{sym}</span>
                          <span className="font-mono text-gray-900">{h.recent.slice(-3).join(' → ')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {fg?.error ? `Unavailable: ${fg.error}` : 'Observer not initialised yet.'}
              </p>
            )}
          </section>
        </div>
      )}

      {data?.ml_worker_url_configured === false && (
        <div className="mt-4 p-2 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700">
          ML worker URL not configured (<code className="font-mono">ML_WORKER_URL</code> env var unset).
        </div>
      )}
    </div>
  );
}
