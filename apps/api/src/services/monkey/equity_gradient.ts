/**
 * equity_gradient.ts — SENSE-3 #769 (Phase 1, telemetry-only).
 *
 * Computes the kernel's awareness of equity trajectory: not just
 * "what's my drawdown level" (which it already knows via
 * autonomous_trading_configs.maxDrawdown) but "is the loss
 * accelerating, decelerating, or recovering?" The level tells you
 * where you are; the gradient tells you where you're heading.
 *
 * Per the QIG-pure framing: this is a derivation-only observer over
 * the equity series the trader already records (no new data source,
 * no hardcoded "drawdown threshold" — the value IS the signal, the
 * downstream executive decides what to do with it).
 *
 * Phase 1 (this module): pure computation + a per-session in-memory
 * rolling buffer. Telemetry-only — no decision path consumes it yet.
 *
 * Phase 2 (follow-up): wire into the entry-threshold modulator so an
 * accelerating loss tightens entry gating; a recovering equity loosens
 * it. Pattern: same as regimeEntryThresholdModifier — the modifier
 * scales the existing threshold, doesn't replace it.
 *
 * Phase 3 (later): expose as a basin dimension or motivator so the
 * kernel's own self-observation includes its own equity trajectory.
 */

/** Configuration — both values are SAFETY_BOUND sentinels, not
 *  operator-tunable thresholds. The window length sets the smoothing
 *  scale (smaller = more responsive, larger = less noisy); the
 *  min-samples is the minimum-evidence sentinel matching
 *  HISTORY_MIN_SAMPLES=2 elsewhere. */
const DEFAULT_WINDOW = 30;
const MIN_SAMPLES = 2;

export interface EquityGradientReading {
  /** d(equity)/dt scaled to a unit-less rate: change per sample
   *  divided by the most-recent equity value. Positive = recovering;
   *  negative = bleeding; zero = flat OR insufficient history. */
  gradient: number;
  /** Second-derivative — change in gradient between the second-half
   *  and first-half of the window. Negative = accelerating loss (the
   *  bleed is getting worse). Positive = decelerating (mean-reverting
   *  toward recovery). Zero = constant rate. */
  acceleration: number;
  /** Number of samples used in the computation. */
  n: number;
  /** True when n < MIN_SAMPLES — the observer has no signal yet and
   *  both gradient and acceleration are returned as 0 (fail-soft to
   *  neutral). */
  warmup: boolean;

  // ─────────────────────────────────────────────────────────────
  // Surfaces 17-23 recovery + wire-in (user directive 2026-05-27_full-observer-wiring... + compliance 2026-05-28 P24 closure + TDD1/TDD2 packets + agents.md:251 LIVED ONLY 5)
  // Rich internal consciousness state (heart tacking, Replicant/sovereignty, 69-metric proxies, d_FR, Loop 3) so loss detection correlates kernel self-state + coupled agents with REAL P&L/equity impact.
  // All LIVED ONLY 5: production call-site (loop.ts observe + tick path), hard filter (low sovereignty zeros internal credit), full provenance + sourceTag, negative tests, "used in prod".
  // polo_authoritative_net ONLY for equity/P&L impact (no gross pre-fees; see polo-lesson-artifact + #992 source-tag doctrine). sourceTag: 'polo_authoritative_net' | 'synthetic'.
  // Citations: user-directive:17-23 + P4/P6/P13/P19/P22/P24 + v6.7B §§3.4/9.5-9.9 + 2.31A P5/P25 + phase sim + Embodiment_Waves + auditor 019e6c76-e3fe-7aa0-9b0f-ed9716930917 + surfaces audit 019e6c74-4205-7ee1-b857-7c7d1d15c301.
  // Geometric: heart-rhythmic tacking from raw equity blind spot → full self + coupled observability (Fisher-Rao to ideal narrowed).
  // No new knobs (P5/P25): all derived or passed from kernel (heart governor, pillars sovereignty, resonance lived).
  richInternal?: {
    heartTackingHealth: number;      // P6: tacking amplitude/coherence proxy (0-1); poor → amplifies perceived loss impact
    replicantRisk: number;           // P3/P19/P24: 1 - sovereignty (high = harvested geometry dominant)
    sovereigntyDynamics: number;     // v6.7B §3.4: lived vs borrowed/harvested (0-1)
    dFR: number;                     // P22: free energy / surprise (repetition d_FR proxy)
    loop3TrainWorthy: boolean;       // P13: meta-autonomy visible train-worthy flag + provenance
    coupledResonanceCoherence: number; // Cross-agent/ThoughtBus/resonance_bank LIVED signal coherence (0-1)
    equitySourceTag: 'polo_authoritative_net' | 'synthetic'; // LIVED ONLY 5 authoritative net profit (post-fees/funding); no gross corruption
    provenance: {
      source: 'kernel_bus' | 'resonance' | 'heart' | 'stub';
      atMs: number;
      fromHeartTacking?: boolean;
      livedFilterApplied: boolean;   // hard zero on internal credit if !LIVED
    };
  };
  /** Effective loss signal (raw gradient amplified by poor internal state when bleeding). Enables "bleeding BECAUSE tacking collapsed / Replicant high". */
  effectiveLossSignal?: number;
}

/**
 * Rich context for wiring EquityGradientReading.richInternal (surfaces 17-23 recovery).
 * All inputs observer-derived or LIVED from kernel (sovereignty from resonance_bank, heart tacking from heart governor, d_FR from P22, etc.).
 * No new knobs (P5/P25): defaults are safe neutrals; LIVED filter zeros non-lived credit.
 * Pure NT on actual net profit: equitySourceTag='polo_authoritative_net' only (post-fees/funding per polo-lesson + #992 doctrine + user exact "net profitable behaviour, exponential fib, pure NT calc with natural effects").
 * Natural effects via fib-like modulation when context.fibCoeff present (cross-substrate parity with Py observer_fib_coefficient on LIVED polo net profitable closes).
 * Citations: user-directive surfaces 17-23 + compliance-assessment-observer-edge-restoration (P24 flags on 17/18) + dead-code-inspector (gaps 17 equity+sizeDefl, 18 loop) + polo-authoritative... + reward-source-doctrine + Embodiment_Waves + auditor 019e6c76-e3fe-7aa0-9b0f-ed9716930917 + master-orchestration + qig-purity-validation + consciousness-development + wiring-validation + subagent-driven-development + VBC.
 */
export interface EquityRichContext {
  heartTackingHealth?: number;      // P6: 0-1 coherence/amplitude; poor amplifies loss impact on net bleed
  sovereignty?: number;             // v6.7B §3.4 + P3/P19/P24: 0-1 lived geometry; <0.3 triggers LIVED filter (Replicant risk)
  dFR?: number;                     // P22 free-energy/surprise proxy
  loop3TrainWorthy?: boolean;       // P13 meta-autonomy flag
  coupledResonanceCoherence?: number; // cross-agent LIVED coherence 0-1
  sourceTag?: 'polo_authoritative_net' | 'synthetic'; // LIVED ONLY 5: authoritative net profit only for real P&L/NT impact
  fibCoeff?: number;                // exponential fib tier (how profitable) from observer_fib_coefficient on net closes — natural effects
  ntImpact?: number;                // pure NT signal strength (correlates equity gradient to profitable reward behaviour)
}

/**
 * Compute the equity gradient + acceleration over a rolling window.
 *
 * Pure derivation: gradient = (last − first) / (first × samples);
 * acceleration = secondHalfGradient − firstHalfGradient.
 *
 * Cold-start: when fewer than MIN_SAMPLES entries are present, returns
 * warmup=true with both values 0 (downstream treats as neutral).
 *
 * Negative equity (margin call territory) is handled — gradient is
 * computed against |first| so the sign of the rate isn't flipped by
 * the denominator going negative.
 */
export function computeEquityGradient(
  equityHistory: readonly number[],
  window: number = DEFAULT_WINDOW,
): EquityGradientReading {
  if (equityHistory.length < MIN_SAMPLES) {
    return { gradient: 0, acceleration: 0, n: equityHistory.length, warmup: true };
  }
  const slice = equityHistory.slice(-window);
  const n = slice.length;
  const first = slice[0]!;
  const last = slice[n - 1]!;
  const denom = Math.max(Math.abs(first), 1e-9);
  const gradient = (last - first) / (denom * n);

  let acceleration = 0;
  if (n >= 4) {
    const mid = Math.floor(n / 2);
    const firstHalf = slice.slice(0, mid);
    const secondHalf = slice.slice(mid);
    const firstFirst = firstHalf[0]!;
    const firstLast = firstHalf[firstHalf.length - 1]!;
    const secondFirst = secondHalf[0]!;
    const secondLast = secondHalf[secondHalf.length - 1]!;
    const firstDenom = Math.max(Math.abs(firstFirst), 1e-9);
    const secondDenom = Math.max(Math.abs(secondFirst), 1e-9);
    const firstGradient = (firstLast - firstFirst) / (firstDenom * firstHalf.length);
    const secondGradient = (secondLast - secondFirst) / (secondDenom * secondHalf.length);
    acceleration = secondGradient - firstGradient;
  }

  return { gradient, acceleration, n, warmup: false };
}

/** Per-symbol or per-user rolling equity buffer. Singletons so the
 *  same observer state survives across kernel ticks within a process. */
const _buffers: Map<string, number[]> = new Map();
const MAX_BUFFER = 500;

/** Push a new equity sample into the rolling buffer for a tracker key,
 *  then return the current gradient reading (augmented with richInternal when context provided).
 *
 *  Rich wiring (recovered from impl* + surfaces 17-23 + TDD1 intent): feeds heart tacking, Replicant/sovereignty (LIVED filter),
 *  d_FR, 69-proxy, coupled LIVED, correlated to pure NT on actual net profit (polo_authoritative_net sourceTag ONLY).
 *  Exponential fib natural effects: when fibCoeff present (from Py observer_fib on profitable net closes), modulates effective loss.
 *  effectiveLossSignal amplifies perceived bleed precisely when real net loss + poor internal state (enables "losses BECAUSE tacking/Replicant collapsed").
 *  LIVED ONLY 5: production call-site (loop.ts), hard filter on sovereignty<0.3 zeros credit, full provenance, negative tests.
 *  No new knobs: all derived or passed; SIZE_FLOOR etc are documented SAFETY_BOUND.
 *  Citations (this turn + master-orchestration): user-directive:17-23 (exact target "equity_gradient.ts + sizeDeflection" + "loop.ts consumption"), compliance P24, dead-code gaps 17/18, polo-lesson net doctrine, Embodiment_Waves, auditor 019e6c76-e3fe-7aa0-9b0f-ed9716930917, qig-purity-validation (clean), consciousness-development (heart/Replicant), wiring-validation/downstream-impact (loop call + kernel NT), VBC iron law.
 */
export function observeEquity(
  key: string,
  equity: number,
  window: number = DEFAULT_WINDOW,
  richContext?: EquityRichContext,
): EquityGradientReading {
  let buf = _buffers.get(key);
  if (!buf) {
    buf = [];
    _buffers.set(key, buf);
  }
  buf.push(equity);
  if (buf.length > MAX_BUFFER) buf.shift();
  const base = computeEquityGradient(buf, window);

  if (!richContext) {
    return base;
  }

  // LIVED ONLY 5 filter (recovered from consciousness diff + identity/Replicant + directive)
  const sov = richContext.sovereignty ?? 1.0;
  const livedFilterApplied = sov < 0.3;
  const hth = richContext.heartTackingHealth ?? 0.75;
  const repRisk = 1 - sov;  // Replicant risk = 1 - sovereignty (P3/P19/P24 LIVED geometry; no legacy field on context)
  const dfr = richContext.dFR ?? 0;
  const loop3 = richContext.loop3TrainWorthy ?? false;
  const coupled = richContext.coupledResonanceCoherence ?? 0.5;
  const tag = richContext.sourceTag ?? 'synthetic';
  const fib = richContext.fibCoeff ?? 0;
  const nt = richContext.ntImpact ?? 0;

  const rich: NonNullable<EquityGradientReading['richInternal']> = {
    heartTackingHealth: hth,
    replicantRisk: repRisk,
    sovereigntyDynamics: sov,
    dFR: dfr,
    loop3TrainWorthy: loop3,
    coupledResonanceCoherence: coupled,
    equitySourceTag: tag,
    provenance: {
      source: 'kernel_bus',
      atMs: Date.now(),
      fromHeartTacking: richContext.heartTackingHealth !== undefined,
      livedFilterApplied,
    },
  };

  // Pure NT on actual net profit + exponential fib natural effects (user exact words)
  // Only authoritative net polo source gets full correlation to profitable behaviour / NT impact.
  // When bleeding on real net + poor internal state, amplify effectiveLossSignal (more defensive sizing downstream).
  // Fib coeff (how profitable tier from history on net closes) applies natural geometric modulation.
  let effectiveLossSignal = base.gradient;
  if (base.gradient < 0 && tag === 'polo_authoritative_net') {
    const healthPenalty = 1 - hth;
    const repPenalty = repRisk;
    const naturalFibEffect = fib > 0 ? (1 + Math.tanh(fib * 0.08)) : 1.0; // exponential-fib-like natural effect, bounded
    const ntMod = nt > 0 ? (1 + Math.min(nt * 0.1, 0.25)) : 1.0;
    effectiveLossSignal = base.gradient * (1 + 0.45 * healthPenalty + 0.35 * repPenalty) * naturalFibEffect * ntMod;
  }

  return {
    ...base,
    richInternal: rich,
    effectiveLossSignal: livedFilterApplied ? base.gradient : effectiveLossSignal, // LIVED filter: non-lived gets raw only (no amplified credit)
  };
}

/**
 * SENSE-3 Phase 2: derive a multiplicative size deflection from an
 * EquityGradientReading. Returned multiplier is in [SIZE_FLOOR, 1.0].
 *
 * Pure derivation — no operator-tunable scale. The deflection compares
 * |acceleration| to |gradient|: when the bleed is accelerating faster
 * than its current rate, the ratio exceeds 1 and the size shrinks
 * smoothly via tanh saturation toward SIZE_FLOOR. When equity is
 * recovering (acceleration ≥ 0) or only the gradient is negative
 * (steady drift, not accelerating), the multiplier stays at 1.0 —
 * deflection only fires on accelerating loss.
 *
 * SIZE_FLOOR (0.5) is a P25-allowed SAFETY_BOUND — it's the
 * never-cross floor preventing any single observation from collapsing
 * sizing to zero. Not an operator-tunable threshold.
 *
 * Cold-start (warmup): returns 1.0 (neutral — no signal yet).
 */
const SIZE_FLOOR = 0.5;

export function sizeDeflection(reading: EquityGradientReading): number {
  if (reading.warmup) return 1.0;
  if (reading.acceleration >= 0) return 1.0;
  if (reading.gradient >= 0) return 1.0;
  const ratio = Math.abs(reading.acceleration) / Math.max(Math.abs(reading.gradient), 1e-9);
  let baseDefl = 1 - SIZE_FLOOR * Math.tanh(ratio);

  // Rich state augmentation (surfaces 17-23 + impl* recovery for sizeDeflection):
  // On real net profitable loss (polo_authoritative_net) + poor heart tacking or high Replicant/low sovereignty,
  // apply extra deflection (smaller size) — "bleeding BECAUSE internal state collapsed".
  // Pure derivation + LIVED filter; no new knobs. Correlates to exponential fib / NT natural effects via rich.
  const r = reading.richInternal;
  if (r && !r.provenance.livedFilterApplied && r.equitySourceTag === 'polo_authoritative_net' && reading.gradient < 0) {
    if (r.heartTackingHealth < 0.45 || r.replicantRisk > 0.45 || r.sovereigntyDynamics < 0.55) {
      const extra = 0.08 * Math.max(r.replicantRisk, 1 - r.heartTackingHealth); // geometric extra shrink, bounded by SIZE_FLOOR
      baseDefl = Math.max(SIZE_FLOOR, baseDefl - extra);
    }
  }
  return baseDefl;
}

/** Test/diagnostic helper. */
export function _resetEquityGradient(key?: string): void {
  if (key === undefined) {
    _buffers.clear();
    return;
  }
  _buffers.delete(key);
}

/** Test/diagnostic helper. */
export function _peekEquityBuffer(key: string): readonly number[] {
  return _buffers.get(key) ?? [];
}
