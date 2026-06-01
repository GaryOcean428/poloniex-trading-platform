/**
 * KernelControlsCard — operator FEATURE toggles for the Monkey kernel.
 *
 * Renders one switch per row from `GET /api/agent/feature-flags` and writes
 * changes via `PUT /api/agent/feature-flags/:key` (body `{ value }`). This is
 * the UI surface for the DB-backed control plane (monkey_feature_flags,
 * migration 068) that replaced the scatter of Railway env vars — the operator
 * now flips every feature from one pane of glass.
 *
 * Scope: ONLY operator on/off FEATURE toggles. Numeric CALIBRATION thresholds
 * are observer-derived per the P1 doctrine and are deliberately NOT exposed —
 * the kernel sets those itself from what it observes.
 *
 * Mirrors the Execution-Mode control's data pattern (axios + Bearer token,
 * optimistic update, refetch-on-error, server is authoritative).
 */
import axios from 'axios';
import { AlertTriangle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { getAccessToken } from '@/utils/auth';
import { getBackendUrl } from '@/utils/environment';

const API_BASE_URL = getBackendUrl();

interface FeatureFlag {
  key: string;
  value: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** Human-readable label, one-line description, and grouping for each flag.
 *  Unknown keys (a flag added server-side before this map is updated) fall
 *  back to a humanised key so nothing is ever hidden from the operator. */
interface FlagMeta {
  label: string;
  desc: string;
  group: string;
}

const FLAG_META: Record<string, FlagMeta> = {
  MONKEY_SHORTS_LIVE: { label: 'Short Selling', desc: 'Allow the kernel to open short positions.', group: 'Trading' },
  L_VETO_OVER_K_ENABLED: { label: 'L-Agent Veto', desc: "Let the FR-KNN L agent block K's entries on side disagreement.", group: 'Trading' },
  MONKEY_FUNDING_GATE_LIVE: { label: 'Funding-Window Gate', desc: 'Suppress new entries near funding settlement.', group: 'Trading' },

  MONKEY_BRACKET_EXIT_LIVE: { label: 'Bracket Exits', desc: 'Take-profit / stop bracket on open positions.', group: 'Exit Protection' },
  MONKEY_BRACKET_EXTEND_LIVE: { label: 'Bracket Revision', desc: 'Extend / revise the bracket as conviction evolves.', group: 'Exit Protection' },
  MONKEY_FAST_ADVERSE_LIVE: { label: 'Fast-Adverse Exit', desc: 'Quick exit when ROI turns sharply against the basin.', group: 'Exit Protection' },
  MONKEY_SLOW_BLEED_LIVE: { label: 'Slow-Bleed Exit', desc: 'Time-based exit for slowly-adverse held positions.', group: 'Exit Protection' },
  REGIME_HELD_EXIT_LIVE: { label: 'Regime-Held Exit', desc: "Exit when a held position's regime cell flips.", group: 'Exit Protection' },

  MONKEY_MAKER_CLOSE_LIVE: { label: 'Maker-Rebate Closes', desc: 'Close positions with post-only maker orders.', group: 'Order Routing' },
  SCALP_LIMIT_MAKER_LIVE: { label: 'Scalp Maker Orders', desc: 'Route scalp entries as post-only maker.', group: 'Order Routing' },
  SCALP_LIMIT_MAKER_BROAD: { label: 'Broad Maker Routing', desc: 'Extend maker routing beyond the scalp lane into CHOP.', group: 'Order Routing' },

  MONKEY_TAPE_OVERRIDE_LIVE: { label: 'Tape Override', desc: 'Let strong tape signal override basin direction.', group: 'Perception' },
  REGIME_COMPOSITIONAL_LIVE: { label: 'Compositional Regime', desc: 'Use the compositional regime cell for lane + bias.', group: 'Perception' },
  MONKEY_MARKET_INTEL_LIVE: { label: 'Market-Intel Feed', desc: 'Fold wider market-data intel into the perception basin.', group: 'Perception' },

  MONKEY_MTF_BOOTSTRAP: { label: 'Multi-Timeframe Bootstrap', desc: 'Warm the MTF classifier at startup.', group: 'Infrastructure' },
  MONKEY_WS_PRIVATE_LIVE: { label: 'WS Private Feed', desc: 'Event-driven position truth via the private websocket.', group: 'Infrastructure' },
};

const GROUP_ORDER = ['Trading', 'Exit Protection', 'Order Routing', 'Perception', 'Infrastructure', 'Other'];

/** Humanise an unknown flag key, e.g. MONKEY_FOO_LIVE → "Foo". */
function humanise(key: string): string {
  return key
    .replace(/^MONKEY_/, '')
    .replace(/_LIVE$/, '')
    .replace(/_ENABLED$/, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function metaFor(key: string): FlagMeta {
  return FLAG_META[key] ?? { label: humanise(key), desc: key, group: 'Other' };
}

export default function KernelControlsCard() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${getAccessToken()}` }), []);

  const fetchFlags = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/agent/feature-flags`, { headers: authHeaders() });
      if (res.data?.success && Array.isArray(res.data.flags)) {
        setFlags(res.data.flags as FeatureFlag[]);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    }
  }, [authHeaders]);

  useEffect(() => {
    void fetchFlags();
  }, [fetchFlags]);

  const toggle = useCallback(async (flag: FeatureFlag) => {
    const next = flag.value === 'true' ? 'false' : 'true';
    // Optimistic update so the switch feels instant.
    setFlags((prev) => prev?.map((f) => (f.key === flag.key ? { ...f, value: next } : f)) ?? prev);
    setPending((prev) => new Set(prev).add(flag.key));
    try {
      const res = await axios.put(
        `${API_BASE_URL}/api/agent/feature-flags/${encodeURIComponent(flag.key)}`,
        { value: next },
        { headers: authHeaders() },
      );
      if (res.data?.success) {
        // Reflect the server-authoritative record (value + audit meta).
        setFlags((prev) =>
          prev?.map((f) =>
            f.key === flag.key
              ? { ...f, value: res.data.value, updatedAt: res.data.updatedAt, updatedBy: res.data.updatedBy }
              : f,
          ) ?? prev,
        );
      } else {
        await fetchFlags(); // server rejected — resync to truth
      }
    } catch {
      await fetchFlags(); // network/server error — resync to truth
    } finally {
      setPending((prev) => {
        const n = new Set(prev);
        n.delete(flag.key);
        return n;
      });
    }
  }, [authHeaders, fetchFlags]);

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-gray-500" />
          Kernel Controls
        </h3>
        <button
          type="button"
          onClick={() => void fetchFlags()}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Refresh feature flags"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Operator feature toggles. Changes take effect within one tick. Numeric
        calibration is observer-derived — the kernel sets that itself.
      </p>

      {loadError && (
        <div role="alert" className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Couldn&apos;t load feature flags. <button type="button" onClick={() => void fetchFlags()} className="underline font-medium">Retry</button>
        </div>
      )}

      {!loadError && flags === null && (
        <div className="text-sm text-gray-400 py-6 text-center">Loading controls…</div>
      )}

      {!loadError && flags?.length === 0 && (
        <div className="text-sm text-gray-400 py-6 text-center">No feature flags configured.</div>
      )}

      {!loadError && flags && flags.length > 0 && (
        <div className="space-y-5">
          {GROUP_ORDER.map((group) => {
            const rows = flags.filter((f) => metaFor(f.key).group === group);
            if (rows.length === 0) return null;
            return (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{group}</p>
                <div className="space-y-2">
                  {rows.map((flag) => {
                    const meta = metaFor(flag.key);
                    const on = flag.value === 'true';
                    const busy = pending.has(flag.key);
                    return (
                      <div key={flag.key} className="flex items-center justify-between gap-4 p-3 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-gray-900">{meta.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{meta.desc}</p>
                          {flag.updatedBy && (
                            <p className="text-[11px] text-gray-300 mt-1 truncate" title={`${flag.updatedBy} · ${new Date(flag.updatedAt).toLocaleString()}`}>
                              last set by {flag.updatedBy}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${meta.label} ${on ? 'on' : 'off'}`}
                          disabled={busy}
                          onClick={() => void toggle(flag)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                            on ? 'bg-green-500' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              on ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
