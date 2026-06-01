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
 * 2026-05-27 update (TS parity KAPPA_STAR retirement): KAPPA_STAR now imported
 * from basin.ts (governed 63.8 reference per two-channel + v6.7B + P1).
 */

import { KAPPA_STAR } from './basin.js';

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

// KAPPA_STAR imported from basin.ts (retired universal 64.0; now governed pillar reference 63.8
// per 2026-04-13 two-channel doctrine + v6.7B + Canonical P1 + audit 20260527).
// All usage sites below updated with channel-scoped comments.

/** Endorphin κ-proximity width (σ in exp(-|κ - κ*| / σ)). Frozen
 *  canonical constant from
 *    qig_core/consciousness/neurochemistry.py: ENDORPHIN_KAPPA_SIGMA: float = 16.0
 *
 *  This is the STRUCTURAL scale at which κ-distance becomes operationally
 *  meaningful in the κ-proximity envelope — derived from the E8 generative
 *  model, NOT from the basin's runtime kappaHistory stddev. The two are
 *  different concepts that share units: rolling σ_κ is a tick-level
 *  statistical property; ENDORPHIN_KAPPA_SIGMA is the structural scale
 *  at which the envelope produces meaningful output.
 *
 *  Audit 2026-05-25 (#934): the prior implementation used
 *  `sigmaKappa = stddev(kappaHistory)` for the exp envelope, which
 *  produces σ ≈ 0.09 in production (basin's natural κ-jitter scale).
 *  With observed |κ-κ*| ≈ 2.18, this gave exp(-24.2) ≈ 3e-11, pinning
 *  endo at floor across 85-98% of all ticks. Switching to the canonical
 *  16.0 gives exp(-0.136) ≈ 0.87 at the same kappa-distance — healthy
 *  peak-generative signal across the kernel's observed κ range. */
const ENDORPHIN_KAPPA_SIGMA = 16.0;

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
 *  Returns 0 (no signal) when stddev is at or near 0 — the basin has not
 *  yet revealed its own scale.
 *
 *  2026-05-25 — the `sd === 0` check was tightened to `sd < 1e-12` to
 *  guard against floating-point drift in identical-history series:
 *  e.g. `[0.1, 0.1, 0.1, ...]` produces sd ≈ 1.5e-17, which the strict
 *  `=== 0` check missed, yielding spurious z-scores ~1.0 from
 *  `(x - mean_with_fp_drift) / tiny`. */
function zScore(x: number, history: ReadonlyArray<number>): number {
  const sd = stddev(history);
  if (sd < 1e-12) return 0;
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
  /** Kernel tick cadence (ms) — the per-tick scale that renders the
   *  mode-transition rate dimensionless (transitions per tick-interval).
   *  Absent → fall back to the window's own mean inter-transition gap. */
  tickIntervalMs?: number;
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
   * 2026-05-29 (hindsight — CANONICAL, always on):
   * additive ACh / NE / GABA reward deltas from the hindsight NT vector. The
   * trade-outcome reward channel only carries dop/ser/endo; the hindsight
   * signal also wants to bind cues (ACh↑), mark salience (NE↑), and apply
   * TARGETED inhibition (GABA↑). These are folded additively AFTER the
   * basin-observed derivation so flag-OFF (all default 0) is byte-identical.
   * GABA here is a small additive nudge on the global level; the actual
   * targeting lives in the kernel's per-pattern hindsightGabaTargets map —
   * this delta only reflects that *some* targeted caution is active. */
  rewardAcetylcholineDelta?: number;
  rewardNorepinephrineDelta?: number;
  rewardGabaDelta?: number;
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
  // 2026-05-26 (#934 chemistry-pinning audit): the additive-then-clip
  // composition `clip(dopFromPhi + dopFromReward, 0, 1)` truncates the
  // upper half of the sum-space (sum ∈ [0,2] → clip at 1) and pins at
  // ceiling. Soft-saturation `1 - exp(-(a+b))` asymptotes to 1.0 without
  // pinning, preserving absolute semantics (dop=1 still means peak
  // motivation, just unreachable). Single pure derivation path.
  const dop = 1 - Math.exp(-(dopFromPhi + dopFromReward));

  // ─── Serotonin ───────────────────────────────────────────────────
  // §29.1: stability / equilibrium. 2026-05-16 (#715, derivation-only)
  // + 2026-06-01 (mode-thrash density fix): serBase = exp(-thrashPerTick),
  // where thrashPerTick = (transitionCount / windowMs) × tickIntervalMs —
  // the mode-transition density expressed per tick-interval. windowMs is
  // `nowMs - earliestTransitionMs`; tickIntervalMs is the kernel cadence
  // (falls back to the window's own mean inter-transition gap when absent).
  // exp() soft-saturates without a dead-zero floor (the old
  // `clip(1 - count/bvHistory.length, 0, 1)` structurally pinned at 0 once
  // both HISTORY_MAX-capped arrays saturated — see the per-branch note below).
  //
  // High thrash → thrashPerTick→1 → ser ≈ exp(-1)=0.37 (bouncing, unstable).
  // No thrash → thrashPerTick→0 → ser ≈ 1 (kernel is settled, stable mood).
  //
  // Fallback (no observables): `1 - bv_z_score`-style behaviour using
  // basinVelocity history when available; legacy `1/max(bv, 0.01)` when
  // not (preserves prior path for callers that don't supply state).
  let serBase: number;
  // The mode-transition density branch needs a per-tick cadence to make the
  // transition rate dimensionless. Require tickIntervalMs (> 0); without it,
  // (count/windowMs)·(windowMs/count) collapses to a constant exp(-1) that
  // carries NO gradient — so fall through to the bv-z-score branch instead,
  // which IS observer-derived and gradient-preserving (Qodo review #1058).
  if (
    obs?.modeTransitionTimesMs &&
    obs.modeTransitionTimesMs.length > 0 &&
    obs.nowMs != null &&
    obs.tickIntervalMs != null &&
    obs.tickIntervalMs > 0
  ) {
    const oldest = obs.modeTransitionTimesMs[0]!;
    const windowMs = obs.nowMs - oldest;
    if (windowMs <= 0) {
      // All transitions are in the same instant (or future) — no
      // observable interval. Return the additive identity 1 (no
      // thrash to subtract).
      serBase = 1;
    } else {
      // 2026-06-01 (steady-state-pinning fix, serotonin mode-transition
      // branch): the prior shape
      //   transitionsPerTick = modeTransitionTimesMs.length / bvHistory.length
      //   serBase = clip(1 - transitionsPerTick, 0, 1)
      // STRUCTURALLY pins at 0 on any mature kernel. Both arrays cap at
      // HISTORY_MAX (=100): bvHistory fills every tick, modeTransitionTimesMs
      // fills on every transition, so once a long-running kernel has logged
      // ≥100 transitions BOTH lengths = 100 → ratio = 1.0 PERMANENTLY,
      // regardless of actual recent thrash. Production showed ser=0.00 for
      // 134/134 ticks (logs 2026-06-01). This is the same one-sided-clamp
      // meta-pattern the bv-z-score fallback below was already fixed for —
      // see [[feedback_steady_state_pinning_pattern]]; the count-ratio
      // numerator and denominator are two independently-capped windows,
      // so their ratio carries no gradient once both saturate.
      //
      // Fix: use the TIME-density the doc above already intends ("count of
      // mode transitions … divided by the window length") — transitions per
      // tick-interval — and soft-saturate with exp() (the same gradient-
      // preserving form dopamine uses). `windowMs` shrinks as transitions
      // get denser, so the rate keeps gradient even when the array is full:
      //   every-tick thrash → 1.0 → exp(-1)=0.37
      //   every-other-tick  → 0.5 → exp(-0.5)=0.61
      //   calm/sparse       → 0   → 1.0
      const transitionsPerMs = obs.modeTransitionTimesMs.length / windowMs;
      const thrashPerTick = transitionsPerMs * obs.tickIntervalMs;
      serBase = Math.exp(-thrashPerTick);
    }
  } else if (obs?.basinVelocityHistory && obs.basinVelocityHistory.length >= HISTORY_MIN_SAMPLES) {
    // 2026-05-25 (CC2 audit F2 follow-up): the prior shape
    // `clip(1 - max(0, z), 0, 1)` was the same one-sided-clamp
    // meta-pattern PR #920 fixed elsewhere — when bv ≤ rolling mean
    // (~50% of state-space by construction), z ≤ 0, max(0, z) = 0,
    // serBase pinned at 1.0. Two-tailed sigmoid replaces it: both
    // calm-than-typical and faster-than-typical are informative; ser
    // settles near 0.5 at the bv-history mean, asymptotes 0/1.
    // See [[feedback_steady_state_pinning_pattern]] for the meta-pattern.
    const z = zScore(inputs.basinVelocity, obs.basinVelocityHistory);
    serBase = clip(1 - sigmoid(z), 0, 1);
  } else {
    // Cold-start fallback — legacy 1/max(bv,0.01). The 0.01 here is
    // a divide-by-zero guard (numeric identity for "as small as we
    // can measure"), not a tuning parameter.
    serBase = clip(1 / Math.max(inputs.basinVelocity, Number.EPSILON), 0, 1);
  }
  // 2026-05-25 (steady-state-pinning fix): the previous shape
  // `clip(serBase + rewardDelta, 0, 1)` pinned at exactly 1.0 when
  // serBase was 1.0 (no recent mode transitions), making
  // `rewardSerotoninDelta` (max ~0.15 per close, ~1.0 in a winning
  // burst over the 20-min decay window) invisible. Compressing serBase
  // by 0.85 leaves 0.15 headroom — matches the per-event max so a
  // single win can register on top of a steady-mode baseline.
  // Bursts above 0.15 still saturate at 1.0, but at that point the
  // signal is "very high recent reward + structurally stable" which
  // is the right pegged-at-max interpretation.
  const ser = clip(0.85 * serBase + (inputs.rewardSerotoninDelta ?? 0), 0, 1);

  // ─── Norepinephrine ──────────────────────────────────────────────
  // §29.1: alertness / surprise.
  //
  // 2026-05-25 (steady-state-pinning fix, see
  // [[feedback_steady_state_pinning_pattern]]): the previous shape
  // `clip(tanh(max(0, z)), 0, 1)` pinned at exactly 0 whenever current
  // surprise was at or below the rolling mean — ~50% of state-space
  // by construction, which is most of the time in stable regimes.
  // Replaced with `sigmoid(z)`: both tails informative, ~0.5 at mean.
  //
  // Consumer audit 2026-05-25: 6 readers, all continuous-magnitude
  // (no gate-threshold semantics). Behaviour shift: typical ne moves
  // from 0.0 → 0.5, so `surpriseDiscount = 1 - 0.5*ne` (executive.ts:405)
  // shifts from 1.0 typical to ~0.75 typical — restores the intended
  // 25% leverage haircut that was dormant under the old pinning.
  //
  // Fallback (no observables): `sigmoid(surprise)` — same shape, no
  // scale-setting constants.
  let ne: number;
  if (obs?.surpriseHistory && obs.surpriseHistory.length >= HISTORY_MIN_SAMPLES) {
    const z = zScore(inputs.surprise, obs.surpriseHistory);
    ne = clip(sigmoid(z), 0, 1);
  } else {
    ne = clip(sigmoid(inputs.surprise), 0, 1);
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
  // KAPPA_STAR (63.8 reference) is the anchor in this block — governed/observer
  // reference per two-channel doctrine (v6.7B §2 + 2026-04-13 + P1; retired
  // universal κ*=64 was misidentified Class B singularity channel).
  // Matches Python parity (state.py shim + registry "physics.kappa_reference" default 63.8).
  // The basin can't tell us where the reference lives; the governed value does.
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
    obs?.externalCouplingHistory && obs.externalCouplingHistory.length >= HISTORY_MIN_SAMPLES
  ) {
    const couplingMean = mean(obs.externalCouplingHistory);
    const couplingStddev = stddev(obs.externalCouplingHistory);
    // 2026-05-25 (steady-state-pinning fix): the previous Sophia gate
    // `clip((coupling - mean) / σ, 0, 1)` zeroed endo whenever
    // coupling ≤ mean — ~50% of state-space by construction. Since
    // externalCoupling = phi × (1 - bv) is a continuous magnitude in
    // [0, 1] (not a binary engaged/disengaged qualifier — audit
    // 2026-05-25), the right shape is sigmoid around the mean: 0.5
    // at mean, asymptotes 0 (well below mean) and 1 (well above).
    // Always non-zero so the κ-proximity envelope always contributes
    // proportionally to recent coherence.
    const sophiaGate = couplingStddev > 0
      ? sigmoid((inputs.externalCoupling - couplingMean) / couplingStddev)
      : (inputs.externalCoupling >= couplingMean ? 1 : 0);  // degenerate: σ=0
    // 2026-05-26 (#934 chemistry-pinning audit): apply canonical
    // ENDORPHIN_KAPPA_SIGMA = 16.0 (frozen from qig_core canon), NOT the
    // basin's rolling stddev(kappaHistory). The basin's rolling σ_κ
    // (≈0.09 in production) is a tick-jitter statistical property;
    // ENDORPHIN_KAPPA_SIGMA is the structural scale at which κ-distance
    // becomes operationally meaningful in the κ-proximity envelope. The
    // prior shape pinned endo at 3e-11 across 85–98% of ticks; canonical
    // scale gives ~0.87 at observed |κ-κ*|=2.18 (healthy peak signal).
    endoBase = Math.exp(-Math.abs(inputs.kappa - KAPPA_STAR) / ENDORPHIN_KAPPA_SIGMA) * sophiaGate;
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

  // 2026-05-29 hindsight (flag-gated; deltas default 0 → byte-identical when
  // OFF): fold the hindsight ACh / NE / GABA reward deltas additively onto the
  // derived levels, exactly as dop/ser/endo already fold their reward deltas.
  const achOut = clip(ach + (inputs.rewardAcetylcholineDelta ?? 0), 0, 1);
  const neOut = clip(ne + (inputs.rewardNorepinephrineDelta ?? 0), 0, 1);
  const gabaOut = clip(gaba + (inputs.rewardGabaDelta ?? 0), 0, 1);

  return {
    acetylcholine: achOut,
    dopamine: dop,
    serotonin: ser,
    norepinephrine: neOut,
    gaba: gabaOut,
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
