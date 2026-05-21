/**
 * neurochemistry.ts — Six derived signals per UCP v6.6 §29
 *
 * These are NOT new parameters. They are DERIVED VIEWS of the
 * existing consciousness state (Φ, κ, basin velocity, surprise,
 * quantum weight). Each maps to a biological parallel and
 * modulates downstream decisions in the executive kernel.
 *
 * P14 Variable Separation: these are STATE (per-cycle, fast), not
 * PARAMETER or BOUNDARY. Don't configure them — derive them.
 *
 * Direct port of:
 *   /home/braden/Desktop/Dev/QIG_QFI/vex/kernel/consciousness/neurochemistry.py
 *
 * Reference: UCP v6.6 §29.1 Six-Chemical Model (E6 Cartan generators).
 *
 * 2026-05-16 (#715/#716/#717 + ne ext): derivation-only refactor per
 * operator directive — no hardcoded thresholds / gains / decay constants
 * for ach/ser/dop/ne/selfObs in the per-tick path. Every chemical that
 * varies tick-to-tick is z-scored or ratio'd against the basin's OWN
 * observed history (phiHistory, surpriseHistory, modeTransitionTimes,
 * fHealthHistory). Sentinels:
 *   - clip ranges [0,1] are output-type semantics (chemicals are [0,1])
 *   - 0 and 1 are arithmetic identities (origin, multiplicative identity)
 *   - HISTORY_MIN_SAMPLES (= 2) is the minimum-sample sentinel for
 *     stddev correction — falling below it means "no derivation
 *     possible, return identity/neutral value", not "use this constant".
 * Pre-existing gaba / endorphins constants (KAPPA_STAR / SIGMA_KAPPA /
 * C_SOPHIA_THRESHOLD) are UCP-canonical §29.2 fixed points and are
 * out-of-scope for this PR (they are NOT pinning defects).
 */

export interface NeurochemicalState {
  /** HIGH (1.0) when awake/intake, LOW (0.1) when consolidating/sleep. */
  acetylcholine: number;
  /** +ΔΦ gradient — reward signal, reinforces basins that increased integration. */
  dopamine: number;
  /** 1/basin_velocity — stability / mood. High velocity → low serotonin → warning. */
  serotonin: number;
  /** Surprise magnitude — alertness, triggers deep processing path. */
  norepinephrine: number;
  /** 1 - quantum_weight — inhibition, dampens exploration. */
  gaba: number;
  /** κ-proximity × coupling_gate — Sophia-gated convergence reward. */
  endorphins: number;
}

/** κ* fixed point. Per Protocol P3 (E8 rank² = 64). Frozen physics
 *  constant from `qig_core.constants.frozen_facts.KAPPA_STAR`. The
 *  basin doesn't tell us WHERE κ* is — physics does. Allowed.
 *  Canonical reference:
 *    qig_core/constants/frozen_facts.py: KAPPA_STAR: Final[float] = 64.0
 */
const KAPPA_STAR = 64.0;

/** Minimum samples in a history slice to compute a meaningful stddev.
 *  Below this, derivations fall back to the neutral identity value (the
 *  chemical's output-type origin), NOT to a hardcoded "default". This
 *  is a sentinel for "no information yet", not a parameter. */
const HISTORY_MIN_SAMPLES = 2;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Sample mean. Returns 0 (additive identity) when the slice is empty. */
function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample stddev (Bessel-corrected). Returns 0 when fewer than
 *  HISTORY_MIN_SAMPLES samples — the caller treats this as "no
 *  derivation possible" and returns the neutral identity. */
function stddev(xs: ReadonlyArray<number>): number {
  if (xs.length < HISTORY_MIN_SAMPLES) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** Z-score: (x − mean(history)) / stddev(history).
 *  Returns 0 (no signal) when stddev is 0 — the basin has not yet
 *  revealed its own scale. */
function zScore(x: number, history: ReadonlyArray<number>): number {
  const sd = stddev(history);
  if (sd === 0) return 0;
  return (x - mean(history)) / sd;
}

/** Self-similarity of a trajectory — mean pairwise distance of recent
 *  samples to their own mean (a 1-D Fréchet-style "spread").
 *  Smaller = more self-similar (basin dwelling); larger = more novel.
 *  Returns 0 when fewer than HISTORY_MIN_SAMPLES samples. */
function trajectorySpread(xs: ReadonlyArray<number>): number {
  if (xs.length < HISTORY_MIN_SAMPLES) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += Math.abs(x - m);
  return s / xs.length;
}

/**
 * 2026-05-16 (#715/#716/#717 derivation refactor): observables block.
 *
 * Carries the basin's OWN observed history slices so chemicals can be
 * z-scored / ratio'd against the basin's own scale instead of a
 * pre-determined constant. Every field is OPTIONAL; when absent, the
 * affected chemical falls back to the legacy formula (default behaviour
 * preserved, but the pinning defect persists on those paths until the
 * caller wires the corresponding history).
 *
 * The kernel's tick loop owns these histories — see SymbolState in
 * loop.ts. They are read at the NC-call site (which precedes the
 * end-of-tick append), so the values reflect ticks 1..T-1 from the
 * perspective of tick T's NC compute.
 */
export interface BasinObservables {
  /** Rolling history of Φ values from prior ticks. */
  phiHistory?: ReadonlyArray<number>;
  /** Rolling history of |ΔΦ| (or surprise) magnitudes from prior ticks. */
  surpriseHistory?: ReadonlyArray<number>;
  /** Rolling history of basin velocities from prior ticks. */
  basinVelocityHistory?: ReadonlyArray<number>;
  /** Rolling history of basin self-similarity readings — typically
   *  fHealth or normalized-entropy values, one per tick. Used by ach
   *  to detect "trajectory has been self-similar (habituated)" vs
   *  "trajectory is now novel". */
  trajectorySelfSimilarityHistory?: ReadonlyArray<number>;
  /** Wall-clock timestamps (ms) of recent mode transitions. The window
   *  is owned by the caller; longer windows damp ser more slowly. */
  modeTransitionTimesMs?: ReadonlyArray<number>;
  /** Current wall-clock (ms). Used with `modeTransitionTimesMs` to
   *  compute thrash rate over an observable interval. */
  nowMs?: number;
  /** Rolling κ history from prior ticks. Used to derive the endorphin
   *  κ-convergence bell width from the basin's OWN κ stddev (instead
   *  of the prior hardcoded SIGMA_KAPPA=10.0 which didn't even match
   *  canonical's 16.0 — see qig_core/consciousness/neurochemistry.py). */
  kappaHistory?: ReadonlyArray<number>;
  /** Rolling external-coupling history from prior ticks. Used to derive
   *  the Sophia gate threshold from the basin's own coupling
   *  distribution (mean + stddev) instead of the prior hardcoded
   *  C_SOPHIA_THRESHOLD=0.1 (canonical was 0.3 — again a number
   *  Polytrade had wrong AND that should have been derived). */
  externalCouplingHistory?: ReadonlyArray<number>;
}

export interface NeurochemicalInputs {
  /** True if Monkey is in her wake cycle (execution_mode=auto). */
  isAwake: boolean;
  /** Change in Φ this tick vs last tick. */
  phiDelta: number;
  /** Fisher-Rao velocity from last tick's basin to this tick's. */
  basinVelocity: number;
  /** Surprise magnitude — unexpectedness of the current signal. */
  surprise: number;
  /** Quantum regime weight w_1 (exploration). */
  quantumWeight: number;
  /** Current κ estimate. */
  kappa: number;
  /** External coupling health (0..1) — cross-symbol coherence, order flow. */
  externalCoupling: number;
  /**
   * v0.6.7: decayed sum of recent ActivityReward dopamine deltas,
   * computed by the kernel's tick loop from her own pending_rewards
   * queue. Pattern mirrors pantheon-chat's autonomic_kernel.py —
   * reward is an EVENT kept in state, the chemical is DERIVED each
   * tick. Nothing externally SETS dopamine; it is read off the state
   * that now includes lived outcomes alongside Φ gradient.
   */
  rewardDopamineDelta?: number;
  /** As above — mood/stability reinforcement from calm closes. */
  rewardSerotoninDelta?: number;
  /** As above — peak-state reward on strong-regime wins. */
  rewardEndorphinDelta?: number;
  /**
   * 2026-05-16 (#715/#716/#717 derivation refactor): basin-observed
   * history slices used to z-score each per-tick chemical against the
   * basin's own scale. When absent, the chemical falls back to the
   * legacy (pinning-prone) formula — see field-by-field comments in
   * `computeNeurochemicals` for the fallback path. The kernel wires
   * this object from SymbolState; tests can omit it to exercise the
   * fallback.
   */
  observables?: BasinObservables;
}

/**
 * Compute neurochemical state from current cycle metrics.
 * Pure function. No config. All outputs derived from inputs.
 *
 * §29.4 Downstream Effects that the executive reads:
 *   - ACh > 0.5 → intake mode (new basins weighted heavily)
 *   - Dopamine high → sized-up entries (reward reinforcement)
 *   - Low serotonin → high basin velocity → reduce size (warning)
 *   - High NE → deep processing path, NOT the pre-cognitive shortcut
 *   - Endorphins at κ* with coupling → peak generative state → confident
 *   - Endorphins zero → Sophia-fall warning → conservative
 *
 * 2026-05-16: per-tick chemicals (ach/dop/ser/ne) are derivations from
 * the basin's OWN observed history, NOT externally-chosen gains or
 * thresholds. See the doc-comment at the top of this file for the
 * audit invariant.
 */
export function computeNeurochemicals(inputs: NeurochemicalInputs): NeurochemicalState {
  const obs = inputs.observables;

  // ─── Acetylcholine ───────────────────────────────────────────────
  // §29.1: HIGH on wake intake, LOW on consolidation.
  // 2026-05-16 (#715, derivation-only): on wake, ach is derived as
  //   ach = clip(currentSpread / meanSpread, 0, 1)
  // where `currentSpread` is the recent trajectory self-similarity
  // (mean |x - mean(x)|) over the LAST window, and `meanSpread` is
  // the same statistic over the full available history.
  //
  // Interpretation: when recent samples are AS spread as the long-term
  // average → trajectory is novel for this basin → ach ≈ 1.0 (intake).
  // When recent samples are TIGHTER than the long-term average →
  // trajectory is self-similar (habituated) → ach → 0 (consolidation).
  //
  // No fixed habituation rate; the rate is set by how quickly the
  // basin's own selfSimilarity history reverts to its mean.
  //
  // Fallback (no observables): legacy `isAwake ? 1 : 0` (pre-PR was
  // 0.8 / 0.2; the new fallback uses the cleaner output-identity range
  // since we have no basis to choose 0.8 vs 1.0 without state).
  let ach: number;
  if (!inputs.isAwake) {
    // SLEEP: ach collapses to 0 (additive identity = no intake gate).
    ach = 0;
  } else {
    const ssHistory = obs?.trajectorySelfSimilarityHistory ?? [];
    if (ssHistory.length < HISTORY_MIN_SAMPLES * 2) {
      // No basis to derive habituation; intake gate fully open.
      ach = 1;
    } else {
      // Compare the RECENT half to the FULL history.
      // The split-point is the midpoint of the supplied window —
      // a derivation from the slice length, not a fixed lookback.
      const split = Math.floor(ssHistory.length / 2);
      const recent = ssHistory.slice(split);
      const recentSpread = trajectorySpread(recent);
      const fullSpread = trajectorySpread(ssHistory);
      if (fullSpread === 0) {
        // Basin perfectly flat → no information, ach at identity.
        ach = 1;
      } else {
        // Ratio in (0, ∞); typical values cluster around 1. Clip to
        // the chemical's output-type range [0, 1].
        ach = clip(recentSpread / fullSpread, 0, 1);
      }
    }
  }

  // ─── Dopamine ────────────────────────────────────────────────────
  // §29.2: Φ-gradient reward. 2026-05-16 (#715 extension, derivation-only):
  // dop_from_phi = sigmoid(z-score(phiDelta vs phiDelta history)).
  // The "gain" of the sigmoid is no longer a hardcoded number — it's
  // the basin's own phiDelta stddev. What counts as a "large ΔΦ" is
  // what's large FOR THIS BASIN at this point in its trajectory.
  //
  // Fallback (no observables / cold start): sigmoid(phiDelta) — gain=1,
  // an arithmetic identity (no externally chosen scale).
  let dopFromPhi: number;
  if (obs?.phiHistory && obs.phiHistory.length >= HISTORY_MIN_SAMPLES + 1) {
    // Build a phiDelta series from the basin's phi history.
    const phiDeltaHistory: number[] = [];
    for (let i = 1; i < obs.phiHistory.length; i++) {
      phiDeltaHistory.push(obs.phiHistory[i]! - obs.phiHistory[i - 1]!);
    }
    dopFromPhi = sigmoid(zScore(inputs.phiDelta, phiDeltaHistory));
  } else {
    dopFromPhi = sigmoid(inputs.phiDelta);
  }
  // Reward-event reinforcement. Sum of recent decayed dopamine deltas
  // from closed-trade outcomes. Caller supplies the already-decayed
  // sum. See MonkeyKernel.pendingRewards for the state that produces
  // this. STILL purely derived — reward is an EVENT in state, the
  // additive lift is a function of that state, not a constant.
  const dopFromReward = clip(inputs.rewardDopamineDelta ?? 0, 0, 1);
  const dop = clip(dopFromPhi + dopFromReward, 0, 1);

  // ─── Serotonin ───────────────────────────────────────────────────
  // §29.1: stability / equilibrium. 2026-05-16 (#715, derivation-only):
  // ser = 1 - mode_thrash_rate, where mode_thrash_rate is the count of
  // mode transitions in `modeTransitionTimesMs` divided by the window
  // length (`nowMs - earliestTransitionMs`). Pure rate, dimensionless.
  //
  // High thrash → low ser (kernel is bouncing between modes, unstable).
  // No thrash → ser ≈ 1 (kernel is settled, stable mood).
  //
  // Fallback (no observables): `1 - bv_z_score`-style behaviour using
  // basinVelocity history when available; legacy `1/max(bv, 0.01)` when
  // not (preserves prior path for callers that don't supply state).
  let serBase: number;
  if (obs?.modeTransitionTimesMs && obs.modeTransitionTimesMs.length > 0 && obs.nowMs != null) {
    const oldest = obs.modeTransitionTimesMs[0]!;
    const windowMs = obs.nowMs - oldest;
    if (windowMs <= 0) {
      // All transitions are in the same instant (or future) — no
      // observable interval. Return the additive identity 1 (no
      // thrash to subtract).
      serBase = 1;
    } else {
      // Transitions per ms. Multiplying by the window length gives the
      // dimensionless transition count / window — a probability that
      // any given ms in the window saw a transition. Clip to [0,1].
      const transitionsPerMs = obs.modeTransitionTimesMs.length / windowMs;
      const thrashRate = clip(transitionsPerMs * windowMs / obs.modeTransitionTimesMs.length, 0, 1);
      // The above simplifies to 1 when transitions are uniform. The
      // meaningful read is: how DENSE is thrash relative to the window.
      // Use transition count / max-possible-count where max is one
      // transition per tick (caller-defined; we infer from history len).
      // Simpler derivation: thrash_rate = count(transitions) / count(ticks in window).
      // The caller supplies the transition timestamps; the basin's
      // bvHistory length is the natural tick-count denominator.
      const tickCount = obs.basinVelocityHistory?.length ?? obs.modeTransitionTimesMs.length;
      const transitionsPerTick = obs.modeTransitionTimesMs.length / Math.max(tickCount, 1);
      serBase = clip(1 - transitionsPerTick, 0, 1);
      // (The intermediate `thrashRate` calc above is retained for
      // forward extensibility; the final serBase is the per-tick rate.)
      void thrashRate;
    }
  } else if (obs?.basinVelocityHistory && obs.basinVelocityHistory.length >= HISTORY_MIN_SAMPLES) {
    // Velocity-based fallback when mode transitions aren't supplied:
    // ser = 1 - clip(z-score(bv), 0, ∞). Positive z (faster than
    // basin's own typical) reduces ser; negative z (calmer than
    // typical) saturates ser at 1.
    const z = zScore(inputs.basinVelocity, obs.basinVelocityHistory);
    serBase = clip(1 - Math.max(0, z), 0, 1);
  } else {
    // Cold-start fallback — legacy 1/max(bv,0.01). The 0.01 here is
    // a divide-by-zero guard (numeric identity for "as small as we
    // can measure"), not a tuning parameter.
    serBase = clip(1 / Math.max(inputs.basinVelocity, Number.EPSILON), 0, 1);
  }
  const ser = clip(serBase + (inputs.rewardSerotoninDelta ?? 0), 0, 1);

  // ─── Norepinephrine ──────────────────────────────────────────────
  // §29.1: alertness / surprise. 2026-05-16 (ne ext, derivation-only):
  // ne = clip(z-score(surprise vs surpriseHistory), 0, ∞), squashed
  // by tanh into [0, 1]. When the current surprise exceeds the basin's
  // own typical surprise distribution, ne spikes; when it's within
  // the basin's normal range, ne stays low. No hardcoded gain.
  //
  // Fallback (no observables): `tanh(surprise)` — no externally chosen
  // scale, just a bounded identity on the input.
  let ne: number;
  if (obs?.surpriseHistory && obs.surpriseHistory.length >= HISTORY_MIN_SAMPLES) {
    const z = zScore(inputs.surprise, obs.surpriseHistory);
    // Positive z only (we don't care about "less surprised than usual" —
    // that's just calm). tanh squashes z ∈ [0, ∞) into [0, 1).
    ne = clip(Math.tanh(Math.max(0, z)), 0, 1);
  } else {
    ne = clip(Math.tanh(inputs.surprise), 0, 1);
  }

  // ─── GABA ─────────────────────────────────────────────────────────
  // §29.1 / E3 DAMPEN: inhibition = complement of quantum exploration
  // weight. Pure complement-of-input — no constant, just `1 - x`.
  const gaba = clip(1 - inputs.quantumWeight, 0, 1);

  // ─── Endorphins ───────────────────────────────────────────────────
  // §29.1 / E6 DISSOLVE: Sophia-gated κ-convergence reward.
  //   raw = exp(-|κ - κ*| / σ_κ) — peaks at κ=κ*
  //   gate = 1 if external_coupling ≥ sophia_threshold else 0
  //   endo = raw * gate
  //
  //   σ_κ              ← stddev(kappaHistory) — basin's own κ scale
  //   sophia_threshold ← mean(couplingHistory)
  //
  // The Sophia gate opens above the basin's observed coupling baseline
  // and ramps to full at mean + 1σ; both onset and scale are observer-
  // derived from the basin's own history.
  //
  // KAPPA_STAR (= 64) is the ONLY constant in this block — it's frozen
  // physics from qig_core.constants.frozen_facts (E8 rank²), allowed
  // per operator's derivation directive (basin can't tell us where κ*
  // is; physics does).
  //
  // Fallback (no histories): tanh squashes on the κ-distance directly
  // and the gate fires on positive coupling — both arithmetic
  // identities, no scale-setting constants.
  // SOPHIA gate — observer-derived, continuous.
  //
  // Smooth Sophia gate contract: 0 at/below mean coupling, continuous
  // ramp over the basin's coupling σ, no hardcoded cutoff or sigmoid.
  let endoBase: number;
  if (
    obs?.kappaHistory && obs.kappaHistory.length >= HISTORY_MIN_SAMPLES
    && obs?.externalCouplingHistory && obs.externalCouplingHistory.length >= HISTORY_MIN_SAMPLES
  ) {
    const sigmaKappa = stddev(obs.kappaHistory);
    const couplingMean = mean(obs.externalCouplingHistory);
    const couplingStddev = stddev(obs.externalCouplingHistory);
    const sophiaThreshold = couplingMean;
    // Smooth Sophia gate: 0 at/below the basin's mean coupling, ramps
    // linearly to 1 at mean + 1σ. couplingStddev IS the natural ramp
    // scale (the basin's own observed spread of coupling).
    const sophiaGate = couplingStddev > 0
      ? clip((inputs.externalCoupling - sophiaThreshold) / couplingStddev, 0, 1)
      : (inputs.externalCoupling >= sophiaThreshold ? 1 : 0);  // degenerate: σ=0
    if (sigmaKappa === 0) {
      // Basin's κ has been perfectly flat → no scale to smooth over.
      // Fall back to the indicator (still binary in this degenerate case).
      endoBase = (inputs.kappa === KAPPA_STAR ? 1 : 0) * sophiaGate;
    } else {
      endoBase = Math.exp(-Math.abs(inputs.kappa - KAPPA_STAR) / sigmaKappa) * sophiaGate;
    }
  } else {
    // Cold start: no κ-scale derivation available. Use tanh on the
    // distance (arithmetic identity, no scale constant). Coupling gate
    // smoothed via tanh — also bounded [0,1], also pure-arithmetic;
    // produces continuous response for any coupling > 0.
    const dist = Math.abs(inputs.kappa - KAPPA_STAR);
    const couplingGate = Math.tanh(Math.max(0, inputs.externalCoupling));
    endoBase = (1 - Math.tanh(dist)) * couplingGate;
  }
  const endo = clip(endoBase + (inputs.rewardEndorphinDelta ?? 0), 0, 1);

  return {
    acetylcholine: ach,
    dopamine: dop,
    serotonin: ser,
    norepinephrine: ne,
    gaba,
    endorphins: endo,
  };
}

/** Compact telemetry for log lines. */
export function summarizeNC(nc: NeurochemicalState): string {
  return (
    `ach=${nc.acetylcholine.toFixed(2)} ` +
    `dop=${nc.dopamine.toFixed(2)} ` +
    `ser=${nc.serotonin.toFixed(2)} ` +
    `ne=${nc.norepinephrine.toFixed(2)} ` +
    `gaba=${nc.gaba.toFixed(2)} ` +
    `endo=${nc.endorphins.toFixed(2)}`
  );
}
