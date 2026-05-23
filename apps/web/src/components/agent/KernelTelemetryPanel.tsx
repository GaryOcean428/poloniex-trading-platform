import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Brain, Moon, RefreshCw, Scale } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';
import { safeNum } from '@/utils/safeNum';
import GovernanceStatusPanel from './GovernanceStatusPanel';

const API_BASE_URL = getBackendUrl();
const POLL_INTERVAL_MS = 30_000;

interface KConsciousnessRow {
  symbol?: string;
  symbol_timestamp?: string;
  created_at?: string;
  ts_phi?: number | null;
  ts_kappa?: number | null;
  ts_M?: number | null;
  ts_Gamma?: number | null;
  ts_R?: number | null;
  ts_regime?: string | null;
  ts_action?: string | null;
  ts_c?: number | null;
  py_phi?: number | null;
  py_kappa?: number | null;
  py_M?: number | null;
  py_Gamma?: number | null;
  py_R?: number | null;
  py_regime?: string | null;
  py_action?: string | null;
  py_c?: number | null;
}

interface KConsciousnessResponse {
  rows?: KConsciousnessRow[];
}

interface KParityRow {
  id: string | number;
  symbol?: string;
  created_at?: string;
  ts_action?: string | null;
  ts_side?: string | null;
  py_action?: string | null;
  py_side?: string | null;
  agree_action?: boolean | null;
  agree_side?: boolean | null;
  delta_phi?: number | null;
  delta_kappa?: number | null;
  py_error?: string | null;
}

interface KParityResponse {
  summary?: {
    total_count?: number;
    agree_action_count?: number;
    disagree_action_count?: number;
    py_error_count?: number;
    agree_side_count?: number;
  };
  rows?: KParityRow[];
}

interface SleepStateResponse {
  agent?: string;
  source?: string;
  sleep_state?: {
    phase?: string | null;
    sleep_count?: number | null;
    drift_streak?: number | null;
    phase_started_at_ms?: number | null;
  } | null;
  last_consolidation_ts?: number | null;
  dream_packet_size_bytes?: number;
  consolidation_summary?: string | null;
}

type SleepAgent = 'K' | 'monkey-swing';

const SLEEP_AGENTS: Array<{ key: SleepAgent; label: string }> = [
  { key: 'K', label: 'Position Kernel Ocean' },
  { key: 'monkey-swing', label: 'Swing Kernel Ocean' },
];

function formatMetric(value: number | null | undefined, digits = 3): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return safeNum(value).toFixed(digits);
}

function formatTimestamp(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—';
}

function getAuthHeaders() {
  const token = getAccessToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

export default function KernelTelemetryPanel() {
  const [consciousness, setConsciousness] = useState<KConsciousnessRow[]>([]);
  const [paritySummary, setParitySummary] = useState<KParityResponse['summary'] | null>(null);
  const [parityRows, setParityRows] = useState<KParityRow[]>([]);
  const [sleepStates, setSleepStates] = useState<Record<string, SleepStateResponse>>({});
  const [loading, setLoading] = useState(Boolean(0));
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchTelemetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
      const [consciousnessRes, parityRes, ...sleepRes] = await Promise.all([
        axios.get<KConsciousnessResponse>(`${API_BASE_URL}/api/governance/k-consciousness?kernel=both&limit=120`, { headers, timeout: 8000 }),
        axios.get<KParityResponse>(`${API_BASE_URL}/api/governance/k-parity?limit=50`, { headers, timeout: 8000 }),
        ...SLEEP_AGENTS.map(({ key }) =>
          axios.get<SleepStateResponse>(`${API_BASE_URL}/api/governance/sleep-state/${key}`, { headers, timeout: 8000 }),
        ),
      ]);

      setConsciousness(consciousnessRes.data.rows ?? []);
      setParitySummary(parityRes.data.summary ?? null);
      setParityRows(parityRes.data.rows ?? []);
      setSleepStates(
        SLEEP_AGENTS.reduce<Record<string, SleepStateResponse>>((acc, agent, index) => {
          acc[agent.key] = sleepRes[index]?.data ?? {};
          return acc;
        }, {}),
      );
      setLastFetched(new Date());
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message || err.response?.data?.error || err.message
        : err instanceof Error
          ? err.message
          : String(err);
      setError(String(message));
    } finally {
      setLoading(Boolean(0));
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const id = setInterval(fetchTelemetry, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const chartData = useMemo(() => (
    consciousness.map((row, index) => ({
      index,
      label: new Date(row.symbol_timestamp ?? row.created_at ?? Date.now()).toLocaleTimeString(),
      ts_c: row.ts_c === null || row.ts_c === undefined ? null : safeNum(row.ts_c),
      py_c: row.py_c === null || row.py_c === undefined ? null : safeNum(row.py_c),
    }))
  ), [consciousness]);

  const latestConsciousness = consciousness[consciousness.length - 1];
  const disagreementRows = parityRows.filter((row) => row.agree_action === Boolean(0) || row.py_error);

  return (
    <div className="space-y-6">
      <GovernanceStatusPanel />

      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-cyan-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Kernel Consciousness</h2>
              <p className="text-sm text-gray-500">Live TS-vs-Py Φ/κ composite from parity-log telemetry.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {lastFetched && <span>Updated {lastFetched.toLocaleTimeString()}</span>}
            <button
              onClick={fetchTelemetry}
              disabled={loading}
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-50"
              aria-label="Refresh kernel telemetry"
              title="Refresh now"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            Failed to fetch telemetry: {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="space-y-4">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500 mb-1">TS Φ / κ / C</div>
                <div className="font-mono text-sm text-gray-900">
                  {formatMetric(latestConsciousness?.ts_phi)} / {formatMetric(latestConsciousness?.ts_kappa, 2)} / {formatMetric(latestConsciousness?.ts_c)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500 mb-1">Py Φ / κ / C</div>
                <div className="font-mono text-sm text-gray-900">
                  {formatMetric(latestConsciousness?.py_phi)} / {formatMetric(latestConsciousness?.py_kappa, 2)} / {formatMetric(latestConsciousness?.py_c)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500 mb-1">TS regime / action</div>
                <div className="font-mono text-sm text-gray-900">
                  {latestConsciousness?.ts_regime ?? '—'} / {latestConsciousness?.ts_action ?? '—'}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500 mb-1">Py regime / action</div>
                <div className="font-mono text-sm text-gray-900">
                  {latestConsciousness?.py_regime ?? '—'} / {latestConsciousness?.py_action ?? '—'}
                </div>
              </div>
            </div>

            {chartData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" minTickGap={32} tick={{ fontSize: 12 }} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="ts_c" name="TS C" stroke="#0891b2" strokeWidth={2} dot={Boolean(0)} connectNulls />
                    <Line type="monotone" dataKey="py_c" name="Py C" stroke="#7c3aed" strokeWidth={2} dot={Boolean(0)} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No consciousness samples yet.</p>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-violet-600" />
              <h3 className="text-sm font-semibold text-gray-900">K Parity</h3>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500 mb-1">Agreement</div>
                <div className="text-lg font-semibold text-gray-900">
                  {paritySummary?.agree_action_count ?? 0}/{paritySummary?.total_count ?? 0}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500 mb-1">Disagreements</div>
                <div className="text-lg font-semibold text-amber-700">{paritySummary?.disagree_action_count ?? 0}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500 mb-1">Side matches</div>
                <div className="text-lg font-semibold text-gray-900">{paritySummary?.agree_side_count ?? 0}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500 mb-1">Py errors</div>
                <div className="text-lg font-semibold text-red-700">{paritySummary?.py_error_count ?? 0}</div>
              </div>
            </div>

            {disagreementRows.length > 0 ? (
              <div className="space-y-2">
                {disagreementRows.slice(-6).reverse().map((row) => (
                  <div key={row.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-sm text-gray-900">{row.symbol ?? '—'}</span>
                      <span className="text-xs text-gray-500">{formatTimestamp(row.created_at)}</span>
                    </div>
                    <div className="text-sm text-gray-800">
                      TS {row.ts_action ?? '—'} {row.ts_side ?? '—'} vs Py {row.py_action ?? '—'} {row.py_side ?? '—'}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 font-mono">
                      Δφ {formatMetric(row.delta_phi)} · Δκ {formatMetric(row.delta_kappa, 2)}
                    </div>
                    {row.py_error && (
                      <div className="mt-1 text-xs text-red-700">{row.py_error}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : parityRows.length > 0 ? (
              <p className="text-sm text-green-700">No recent TS-vs-Py disagreements.</p>
            ) : (
              <p className="text-sm text-gray-500">No parity rows yet.</p>
            )}
          </section>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Moon className="w-5 h-5 text-indigo-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ocean Sleep State</h2>
            <p className="text-sm text-gray-500">Redis-backed sleep/consolidation telemetry for each kernel instance.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {SLEEP_AGENTS.map(({ key, label }) => {
            const state = sleepStates[key];
            return (
              <div key={key} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{label}</h3>
                    <p className="text-xs text-gray-500 font-mono">{key}</p>
                  </div>
                  <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">
                    {state?.sleep_state?.phase ?? state?.source ?? 'unknown'}
                  </span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Sleep count</span>
                    <span className="font-mono text-gray-900">{state?.sleep_state?.sleep_count ?? '—'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Drift streak</span>
                    <span className="font-mono text-gray-900">{state?.sleep_state?.drift_streak ?? '—'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Phase started</span>
                    <span className="font-mono text-gray-900">{formatTimestamp(state?.sleep_state?.phase_started_at_ms)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Last consolidation</span>
                    <span className="font-mono text-gray-900">{formatTimestamp(state?.last_consolidation_ts)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Dream packet size</span>
                    <span className="font-mono text-gray-900">{state?.dream_packet_size_bytes ?? 0} B</span>
                  </div>
                  <div className="pt-2 border-t border-gray-100">
                    <div className="text-gray-500 text-xs mb-1">Consolidation summary</div>
                    <div className="text-xs text-gray-800 break-words">
                      {state?.consolidation_summary ?? 'No consolidation summary yet.'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
