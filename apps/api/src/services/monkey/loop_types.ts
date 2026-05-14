/**
 * loop_types.ts — type definitions for the Monkey kernel loop.
 * Extracted from loop.ts (2026-05-14 modularization). Pure type
 * declarations — erased at runtime, zero behavioural change.
 */
import type { Basin } from './basin.js';
import type { WorkingMemory } from './working_memory.js';
import type { MonkeyMode } from './modes.js';
import type { PerAgentState } from './per_agent_state.js';
import type { AgentLabel } from './per_agent_bus.js';

/**
 * ActivityReward (v0.6.7) — pantheon-chat autonomic pattern port.
 *
 * When a trade closes with realized P&L, the kernel PUSHES one of these
 * onto its pendingRewards queue — it does NOT set dopamine directly.
 * Each tick, the tick loop sums recent rewards with exponential decay
 * and passes the result to computeNeurochemicals as an INPUT. The
 * chemical is still derived, just from a richer state.
 *
 * Preserves P5 Autonomy + P14 Variable Separation: rewards are STATE
 * events; neurotransmitters are derived VIEWS; nothing externally
 * writes the chemical levels.
 */
export interface ActivityReward {
  source: string;           // 'trade_close' | 'witnessed_liveSignal' | ...
  symbol?: string;
  dopamineDelta: number;    // reward magnitude for dopamine boost
  serotoninDelta: number;   // mood/stability boost (calm-close reward)
  endorphinDelta: number;   // peak-state reward (win-in-high-coupling regime)
  realizedPnlUsdt: number;  // source P&L (for audit)
  pnlFraction: number;      // P&L / margin, signed
  atMs: number;             // when the event landed
}

/**
 * Per-kernel configuration (v0.6b). Different sub-Monkeys differ in
 * timeframe, cadence, instance identity, and how they size relative to
 * their cap share. All share the underlying basin/executive/NC math.
 */
export interface MonkeyKernelConfig {
  /** Unique kernel identifier — written as `kernel=<id>` in trade reason and to monkey_basin_sync. */
  instanceId: string;
  /** Candle timeframe she perceives on. '5m' | '15m' | '1m' etc. */
  timeframe: string;
  /** Base tick cadence (ms) — mode profiles still adapt within this. */
  tickMs: number;
  /** Optional symbol override; defaults to DEFAULT_SYMBOLS. */
  symbols?: string[];
  /** Human label for logs. */
  label?: string;
  /** Fraction-of-margin cap. Two parallel kernels at 0.5 each stay under
   *  the risk-kernel per-symbol 5× exposure cap when both are open. */
  sizeFraction?: number;
}

export interface SymbolState {
  lastBasin: Basin;
  /** Identity basin — starts uniform, crystallizes after N lived trades per §3.4 */
  identityBasin: Basin;
  /** Rolling Φ history for delta computation. */
  phiHistory: number[];
  /** Rolling f_health for auto-flatten trend check. */
  fHealthHistory: number[];
  /** Rolling identity-drift history (Fisher-Rao) for mode detection. */
  driftHistory: number[];
  /** Basin trajectory for repetition detection (Loop 1). */
  basinHistory: Basin[];
  /** Working memory (qig-cache) for recent bubbles. */
  wm: WorkingMemory;
  /** Kappa estimate — adaptive from basin velocity × coupling. */
  kappa: number;
  /** Active bubble id for the currently open position (if any). */
  openBubbleId: string | null;
  sessionTicks: number;
  /** Last mode (for transition logging). */
  lastMode: MonkeyMode | null;
  /** Mode-specific tickMs last applied — used by adaptive-tick governor. */
  currentTickMs: number;
  /** v0.6.1: high-water-mark unrealized PnL on the currently-held trade.
   *  Reset to null on close. Survives kernel restarts? No — will re-peak
   *  as ticks come in, which is safer than over-claiming. */
  peakPnlUsdt: number | null;
  /** Trade id of the position currently being peak-tracked. If the open
   *  trade id changes (new position), peak resets. */
  peakTrackedTradeId: string | null;
  /** v0.6.2: most recent entry time for this position (initial or DCA add).
   *  Used for DCA cooldown gating. Null when flat. */
  lastEntryAtMs: number | null;
  /** v0.6.2: count of DCA adds on current position (0 = only initial entry). */
  dcaAddCount: number;
  /** Proposal #9: SL defer counter. When a hammer/inverted-hammer is
   *  detected against a long position about to SL, set this to N
   *  (default 2). Each tick decrements it. While > 0, scalp_exit
   *  with exitTypeBit === -1 (stop loss) is suppressed.
   *
   *  Heuristic gate; impurity scoped to the SL-defer path only. */
  slDeferRemainingTicks: number;
  /** Proposal #4: sustained tape-flip streak counter. Increments
   *  each tick where ``alignmentNow <= -0.25`` (bearish vs the held
   *  side); resets when alignment recovers. ``shouldProfitHarvest``
   *  consumes this — trend-flip harvest fires only when streak >= 3
   *  so a single noise tick can't trigger an exit. */
  tapeFlipStreak: number;
  /** Proposal #10 — per-lane bookkeeping. Each lane independently
   *  tracks its peak unrealized PnL, the trade id it's peak-tracking,
   *  and its tape-flip streak so a swing-long's history never bleeds
   *  into a scalp-short on the same symbol. Lanes that never held
   *  state stay absent from these maps; reads default to the legacy
   *  scalar values for back-compat. */
  peakPnlUsdtByLane: Record<string, number | null>;
  peakTrackedTradeIdByLane: Record<string, string | null>;
  tapeFlipStreakByLane: Record<string, number>;
  /** Held-position re-justification anchors — per-lane (regime, Φ)
   *  snapshots taken at the moment a position opens. The kernel uses
   *  these as the geometric anchor for "is current state still
   *  consonant with entry?". Cleared on position close in that lane.
   *  Same per-lane shape as peakPnlUsdtByLane above so future multi-lane
   *  positions keep independent rejustification anchors. */
  regimeAtOpenByLane: Record<string, string>;
  phiAtOpenByLane: Record<string, number>;
  /** Basin coordinate at entry — per-lane snapshot for the regime
   *  hysteresis basin-distance gate (mirrors Python PR #631). Without
   *  this anchor the regime gate falls back to streak-only. */
  basinAtOpenByLane: Record<string, Basin>;
  /** Consecutive ticks where regimeNow has differed from regimeAtOpen
   *  for the lane. Driven by the rejustification call site — increments
   *  on divergent tick, resets to 0 when regime returns to anchor. */
  regimeChangeStreakByLane: Record<string, number>;
  /** Wall-clock entry timestamp (ms) per lane. Used by the stale-bleed
   *  gate: positions held longer than STALE_BLEED_MIN_DURATION_S at
   *  worse than STALE_BLEED_ROI_THRESHOLD ROI exit. Cleared on close. */
  entryTimeMsByLane: Record<string, number>;
  /** Rolling (Φ, I_Q) history for the Integration motivator's CV
   *  computation. Capped to 20 entries by computeMotivators's default
   *  integrationWindow; we keep a wider buffer here for forward
   *  extensibility. < 2 entries → integration motivator = 0. */
  integrationHistory: Array<[number, number]>;
  /** v0.8.7e: latest computed basinDir + tapeTrend from processSymbol, with
   *  timestamp. Exposed via getLatestBasinSnapshot() for LiveSignal's
   *  inter-engine agreement gate. Null until the first tick completes. */
  latestBasinSnapshot: {
    basinDir: number;
    tapeTrend: number;
    computedAtMs: number;
  } | null;
  /** v0.8.8 per-agent reactive cognition state. Each of K/M/T/L gets
   *  its own emotion stack, neurochemistry, decision/outcome rings, and
   *  bus event cursor. Outcome-driven (not basin-geometry-driven) —
   *  each agent learns from its OWN PnL track record on this symbol.
   *
   *  Used to:
   *    - Modulate per-agent sizing/conviction via riskModulator (dopamine
   *      on wins boosts size; frustration on losses dampens)
   *    - Power foresight + cross-agent observation hooks
   *    - Surface per-agent self-observation (winRate, alignmentRate)
   *
   *  See per_agent_state.ts for the canonical update transforms. */
  agentStates: Record<AgentLabel, PerAgentState>;
  /** Recent bus events for cross-agent observation context. Bounded
   *  ring; older events drop. Each agent reads from this on its tick. */
  recentBusEvents: import('./kernel_bus.js').BusEvent[];
  /** 2026-05-11 — wall-clock ms of the last force-harvest by side. Used
   *  to give L one tick of "wiggle room" after a sweep so the next
   *  entry sees a market that has actually moved, rather than re-entering
   *  at a price within fractions of the close. Window is governed by
   *  MONKEY_AGENT_L_HARVEST_COOLDOWN_MS (default 60 s — one tick).
   *  Fees are not a concern (user has fee-free subscription); this is
   *  about market-microstructure breathing room. */
  lForceHarvestAtMsBySide: { long: number | null; short: number | null };
  /** 2026-05-11 — ring of last N=5 L force-harvest PnLs on this symbol.
   *  Consumed by the adaptive harvest threshold: when L is on a hot
   *  streak (all 5 positive AND dopamine high), threshold widens from
   *  0.3% to 0.6% to let winners run. Oldest entry drops on push. */
  recentLHarvestPnls: number[];
  /** 2026-05-13 — horizon-bounded exit per Change B.
   *
   *  Tracks the wall-clock ms of the most recent L decision that
   *  confirmed (or proposed) the side. The L classifier's prediction
   *  has a forward horizon (default 120 ticks = 60 min on 30s); once
   *  that horizon elapses without L re-confirming, the position is
   *  past its forecast window and must exit unless extended.
   *
   *  Updated whenever L decides enter_long/enter_short on this side
   *  (regardless of whether the entry executes — gate/veto outcomes
   *  don't affect the underlying L conviction). Cleared on harvest
   *  so the next entry starts a fresh horizon clock.
   */
  lLastConfirmedAtMsBySide: { long: number | null; short: number | null };
  /** 2026-05-13 — trailing regime stop anchor.
   *
   *  Mode at L's most recent confirmation per side. A high-leverage
   *  scalp opened in EXPLORATION should exit if the kernel transitions
   *  to INTEGRATION (slow trend regime) because the 50× leverage was
   *  justified by the flat-tape thesis that no longer holds. Mirror
   *  applies for a slow trend position entering EXPLORATION (less
   *  catastrophic but the sizing/horizon assumptions are now wrong).
   *
   *  Cleared on harvest. */
  lModeAtConfirmedBySide: { long: string | null; short: string | null };
  /** 2026-05-13 — Multi-timeframe L state.
   *
   *  Per-timeframe down-sampled basin histories + agreement clocks.
   *  Sampled on every tick (cheap conditional appends); mtfDecide
   *  runs per tick once warm. Phase 1 shipped observation-only;
   *  Phase 2 wires entry gating + size multiplier + longest-agreeing
   *  horizon exit.
   *
   *  See mtfLClassifier.ts. */
  mtfState: import('./mtfLClassifier.js').MTFState;
  /** 2026-05-13 MTF Phase 2 — longest-agreeing timeframe label at
   *  position open, per side. Used by the longest-horizon exit
   *  policy: position must exit when this timeframe's horizon
   *  expires without re-confirmation. */
  mtfLongestAgreeingBySide: {
    long: import('./mtfLClassifier.js').TimeframeLabel | null;
    short: import('./mtfLClassifier.js').TimeframeLabel | null;
  };
  /** 2026-05-13 — continuous regime score r ∈ [0,1] from
   *  regimeSizing.regimeScore(). 1=flat, 0=trending. Recomputed each
   *  tick. Consumed by:
   *    - trailing regime DRIFT stop (per-side rAtEntry snapshot;
   *      fires when |rNow - rAtEntry| exceeds threshold even within
   *      the same discrete mode)
   *    - sanity bounds on mode-derived leverage and headroom
   *  Null until first compute (insufficient history).  */
  rScoreCurrent: number | null;
  /** Per-side snapshot of r at the most recent L entry confirmation.
   *  Trailing regime drift fires via regimeSizing.trailingRegimeStop().
   *  Cleared on harvest. */
  rScoreAtEntryBySide: { long: number | null; short: number | null };
}
