/**
 * consensus_arbiter.ts — Dual-kernel consensus decision engine.
 *
 * Layer 5 of the dual-kernel consensus architecture per
 * [[polytrade-consensus-architecture]]. Consumes own proposal + most-
 * recent peer proposal + regime-conditional WR matrix and emits a
 * single consensus decision the executor (PR CONSENSUS-9) places.
 *
 * Consensus rule (operator spec + CC refinements):
 *
 *   1. NO PEER → consensus = self (peer absent or stale beyond
 *      freshness window). Single-kernel mode.
 *
 *   2. SAME SIDE → SLERP-by-WR:
 *        dominance = WR_self_regime / (WR_self_regime + WR_other_regime)
 *        consensus_size = SLERP(other.size, self.size, dominance)
 *        consensus_leverage = SLERP(other.leverage, self.leverage, dominance)
 *      Dominant kernel pulls toward its proposal; lesser still moves
 *      the needle proportional to its relative WR.
 *
 *   3. DIFFERENT SIDE → explicit branch (CC refinement #2):
 *        a) Both kernels above minSamples AND dominance gap > threshold:
 *           execute dominant; lesser logged as veto evidence
 *        b) WRs close (within ACCEPTABLE_FLOOR delta): no trade,
 *           log divergence as RETHINK candidate
 *        c) Lesser kernel below ACCEPTABLE_FLOOR: lesser demoted to
 *           OBSERVE, dominant fires unilaterally
 *
 *   4. RETHINK TRIGGER (CC refinement on parameters):
 *        max(consecutive_losses ≥ RETHINK_CONSECUTIVE,
 *            cumulative_loss > RETHINK_CUMULATIVE_BANK_FRAC × bank)
 *      When triggered: consensus reduces size by RETHINK_SIZE_FACTOR
 *      AND requires unanimous-only mode until next win.
 *
 * Parameters (env-tunable; no hardcoded constants per [[phi-regulation-policy]]):
 *   CONSENSUS_ACCEPTABLE_FLOOR=0.45            absolute lesser-kernel WR floor
 *   CONSENSUS_GAP_FLOOR=0.15                   lesser must be within X pp of dominant
 *   CONSENSUS_MIN_SAMPLES=5                    per-cell min trades to weight by WR
 *   CONSENSUS_RETHINK_CONSECUTIVE=3            consecutive-loss rethink trigger
 *   CONSENSUS_RETHINK_CUMULATIVE_FRAC=0.05     cumulative-loss-vs-bank trigger
 *   CONSENSUS_RETHINK_SIZE_FACTOR=0.5          size reduction when rethink active
 *   CONSENSUS_ARBITER_LIVE=false               default off — arbiter shadow-mode
 *
 * QIG purity: weighted-mean SLERP between scalars only. Pure decision
 * logic; no geometric ops in this module.
 */

import { logger } from '../../utils/logger.js';

import type { ProposalEvent } from './proposal_bus.js';
import {
  cellHasMinSamples,
  getCellWR,
  type RegimeLabel,
  type RegimeMatrix,
} from './wr_matrix.js';

export interface ConsensusInputs {
  ownProposal: ProposalEvent;
  peerProposal: ProposalEvent | null;
  wrMatrix: RegimeMatrix;
  /** Self engine_type label (e.g. 'monkey-k'). */
  selfEngineType: string;
  /** Peer engine_type label (e.g. 'py-retrospective'). */
  peerEngineType: string;
  /** Regime at this tick. */
  regime: RegimeLabel;
  /** Current bank size in USDT (for RETHINK cumulative-loss trigger). */
  bankSize: number;
  /** Per-engine loss bookkeeping for RETHINK trigger. */
  consecutiveLosses: { self: number; peer: number };
  cumulativeLoss: { self: number; peer: number };
  /**
   * Self kernel's geometric directional read for this tick (basinDir +
   * tape). Telemetry-only — distinct from the executable `side`, which is
   * null on a hold. Logging the lean keeps a hold from being an
   * observability black hole when debugging directional bias.
   */
  ownLean?: 'long' | 'short' | 'flat';
}

export type ConsensusVerdict =
  | 'single-kernel'         // No peer; passed through self.
  | 'same-side-slerp'       // Both agree on side; SLERPed by dominance.
  | 'dominant-fires'        // Side disagreement; dominant kernel wins.
  | 'no-trade-divergence'   // WRs close + disagree; skip + log.
  | 'lesser-observe'        // Lesser below floor; dominant unilateral.
  | 'rethink-mode';         // Rethink trigger active; size reduced, unanimous-only.

export interface ConsensusDecision {
  verdict: ConsensusVerdict;
  action: ProposalEvent['proposed_action'];
  side: 'long' | 'short' | null;
  lane: string;
  size_usdt: number;
  leverage: number;
  reason: string;
  telemetry: {
    self_wr: number;
    peer_wr: number;
    dominance: number;        // ∈ [0, 1] — self's share
    rethink_active: boolean;
    divergence: boolean;
    self_min_samples: boolean;
    peer_min_samples: boolean;
  };
}

function envFloat(name: string, defaultVal: number): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : defaultVal;
}

function envInt(name: string, defaultVal: number): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : defaultVal;
}

export function consensusArbiterLive(): boolean {
  return process.env.CONSENSUS_ARBITER_LIVE === 'true';
}

/**
 * Scalar SLERP — weighted average. Identity-preserving at t=0 or t=1.
 * No quaternions involved; pure scalar interpolation. Name kept to
 * match the existing basin-sync vocabulary even though the math is
 * lerp here (proposals aren't on a curved manifold).
 */
function slerpScalar(a: number, b: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return a * (1 - clamped) + b * clamped;
}

/**
 * Compute consensus decision from own + peer proposals weighted by
 * regime-conditional WR matrix. Pure function — no I/O. Caller
 * supplies the matrix (built upstream from wr_matrix + wr_retrospective).
 *
 * Always returns a decision (never throws). When inputs are malformed,
 * falls back to the own proposal (single-kernel mode).
 */
export function computeConsensus(inputs: ConsensusInputs): ConsensusDecision {
  const acceptableFloor = envFloat('CONSENSUS_ACCEPTABLE_FLOOR', 0.45);
  const gapFloor = envFloat('CONSENSUS_GAP_FLOOR', 0.15);
  const minSamples = envInt('CONSENSUS_MIN_SAMPLES', 5);
  const rethinkConsec = envInt('CONSENSUS_RETHINK_CONSECUTIVE', 3);
  const rethinkCumFrac = envFloat('CONSENSUS_RETHINK_CUMULATIVE_FRAC', 0.05);
  const rethinkSizeFactor = envFloat('CONSENSUS_RETHINK_SIZE_FACTOR', 0.5);

  const own = inputs.ownProposal;
  const peer = inputs.peerProposal;

  const selfWR = getCellWR(inputs.wrMatrix, inputs.selfEngineType, inputs.regime);
  const peerWR = peer
    ? getCellWR(inputs.wrMatrix, inputs.peerEngineType, inputs.regime)
    : 0;
  const selfMin = cellHasMinSamples(inputs.wrMatrix, inputs.selfEngineType, inputs.regime, minSamples);
  const peerMin = peer
    ? cellHasMinSamples(inputs.wrMatrix, inputs.peerEngineType, inputs.regime, minSamples)
    : false;

  // Rethink trigger — fires when EITHER kernel has hit the consecutive
  // floor OR cumulative loss exceeds bank fraction. Reduces size +
  // requires unanimous (same-side) for execution.
  const rethinkConsecFired =
    inputs.consecutiveLosses.self >= rethinkConsec ||
    inputs.consecutiveLosses.peer >= rethinkConsec;
  const rethinkCumFired =
    Math.abs(inputs.cumulativeLoss.self) > rethinkCumFrac * inputs.bankSize ||
    Math.abs(inputs.cumulativeLoss.peer) > rethinkCumFrac * inputs.bankSize;
  const rethinkActive = rethinkConsecFired || rethinkCumFired;

  // ── Case 1: no peer → single-kernel mode ──
  if (!peer) {
    return {
      verdict: 'single-kernel',
      action: own.proposed_action,
      side: own.side,
      lane: own.lane,
      size_usdt: own.size_usdt * (rethinkActive ? rethinkSizeFactor : 1),
      leverage: own.leverage,
      reason: rethinkActive
        ? `consensus.single-kernel (no peer); rethink active → size×${rethinkSizeFactor}`
        : 'consensus.single-kernel (no peer)',
      telemetry: {
        self_wr: selfWR, peer_wr: 0, dominance: 1,
        rethink_active: rethinkActive, divergence: false,
        self_min_samples: selfMin, peer_min_samples: false,
      },
    };
  }

  // Dominance: self's share of combined WR. Cold-start (both 0): 0.5.
  const totalWR = selfWR + peerWR;
  const dominance = totalWR > 0 ? selfWR / totalWR : 0.5;

  // ── Case 2: same side → SLERP-by-WR ──
  if (own.side === peer.side && own.side !== null) {
    const sized = slerpScalar(peer.size_usdt, own.size_usdt, dominance);
    const lev = slerpScalar(peer.leverage, own.leverage, dominance);
    const sizeFactor = rethinkActive ? rethinkSizeFactor : 1;
    return {
      verdict: 'same-side-slerp',
      action: own.proposed_action,
      side: own.side,
      lane: dominance >= 0.5 ? own.lane : peer.lane,
      size_usdt: sized * sizeFactor,
      leverage: Math.max(1, Math.round(lev)),
      reason:
        `consensus.same-side-slerp dominance=${dominance.toFixed(2)} ` +
        `(self.wr=${selfWR.toFixed(2)} peer.wr=${peerWR.toFixed(2)})` +
        (rethinkActive ? ` rethink × ${rethinkSizeFactor}` : ''),
      telemetry: {
        self_wr: selfWR, peer_wr: peerWR, dominance,
        rethink_active: rethinkActive, divergence: false,
        self_min_samples: selfMin, peer_min_samples: peerMin,
      },
    };
  }

  // ── Case 3: side disagreement ──
  // Rethink-mode requires unanimity; disagreement on rethink = no trade.
  if (rethinkActive) {
    return {
      verdict: 'no-trade-divergence',
      action: 'hold',
      side: null,
      lane: own.lane,
      size_usdt: 0,
      leverage: 1,
      reason: 'consensus.no-trade rethink-active + side disagreement',
      telemetry: {
        self_wr: selfWR, peer_wr: peerWR, dominance,
        rethink_active: true, divergence: true,
        self_min_samples: selfMin, peer_min_samples: peerMin,
      },
    };
  }

  // 3a) Lesser kernel below ACCEPTABLE_FLOOR → dominant fires unilateral
  const lesserWR = Math.min(selfWR, peerWR);
  const dominantWR = Math.max(selfWR, peerWR);
  const lesserBelowFloor =
    (selfMin || peerMin) &&  // need samples to make the call
    lesserWR < acceptableFloor;

  if (lesserBelowFloor) {
    const dominantIsSelf = selfWR >= peerWR;
    const dominantProp = dominantIsSelf ? own : peer;
    return {
      verdict: 'lesser-observe',
      action: dominantProp.proposed_action,
      side: dominantProp.side,
      lane: dominantProp.lane,
      size_usdt: dominantProp.size_usdt,
      leverage: dominantProp.leverage,
      reason:
        `consensus.lesser-observe lesser_wr=${lesserWR.toFixed(2)} < ` +
        `floor=${acceptableFloor}; ${dominantIsSelf ? 'self' : 'peer'} fires unilateral`,
      telemetry: {
        self_wr: selfWR, peer_wr: peerWR, dominance,
        rethink_active: false, divergence: true,
        self_min_samples: selfMin, peer_min_samples: peerMin,
      },
    };
  }

  // 3b) Both above floor + dominance gap > threshold → dominant fires
  const wrGap = dominantWR - lesserWR;
  if (selfMin && peerMin && wrGap > gapFloor) {
    const dominantIsSelf = selfWR >= peerWR;
    const dominantProp = dominantIsSelf ? own : peer;
    return {
      verdict: 'dominant-fires',
      action: dominantProp.proposed_action,
      side: dominantProp.side,
      lane: dominantProp.lane,
      size_usdt: dominantProp.size_usdt,
      leverage: dominantProp.leverage,
      reason:
        `consensus.dominant-fires gap=${wrGap.toFixed(2)} > ${gapFloor}; ` +
        `${dominantIsSelf ? 'self' : 'peer'} (WR ${dominantWR.toFixed(2)}) wins ` +
        `over lesser (WR ${lesserWR.toFixed(2)})`,
      telemetry: {
        self_wr: selfWR, peer_wr: peerWR, dominance,
        rethink_active: false, divergence: true,
        self_min_samples: selfMin, peer_min_samples: peerMin,
      },
    };
  }

  // 3c) WRs close OR insufficient samples → no trade (safety)
  return {
    verdict: 'no-trade-divergence',
    action: 'hold',
    side: null,
    lane: own.lane,
    size_usdt: 0,
    leverage: 1,
    reason:
      `consensus.no-trade side-disagreement wr_gap=${wrGap.toFixed(2)} ≤ ${gapFloor} ` +
      `OR insufficient samples (self_min=${selfMin}, peer_min=${peerMin})`,
    telemetry: {
      self_wr: selfWR, peer_wr: peerWR, dominance,
      rethink_active: false, divergence: true,
      self_min_samples: selfMin, peer_min_samples: peerMin,
    },
  };
}

/**
 * Log + return — convenience wrapper that emits a structured log line
 * for every consensus decision. Operator can grep `[Consensus]` from
 * Railway to trace each tick's arbiter output.
 */
export function computeAndLogConsensus(inputs: ConsensusInputs): ConsensusDecision {
  const decision = computeConsensus(inputs);
  logger.info('[Consensus]', {
    symbol: inputs.ownProposal.symbol,
    verdict: decision.verdict,
    action: decision.action,
    // `side` is the executable trade side — 'none' on a hold, by design
    // (logged as the string 'none', not a bare null, so the line does
    // not read as missing data). `lean` is the kernel's geometric
    // directional read, surfaced even on holds so the [Consensus] line
    // matches the [Monkey] tick telemetry.
    side: decision.side ?? 'none',
    lean: inputs.ownLean ?? 'flat',
    size_usdt: decision.size_usdt,
    leverage: decision.leverage,
    self_wr: decision.telemetry.self_wr,
    peer_wr: decision.telemetry.peer_wr,
    dominance: decision.telemetry.dominance,
    rethink: decision.telemetry.rethink_active,
    divergence: decision.telemetry.divergence,
    reason: decision.reason,
  });
  return decision;
}

/** Input/output shape for {@link applyConsensusOverride}. */
export interface ConsensusOverrideInput {
  action: string;
  size_usdt: number;
  leverage: number;
}

/** The only actions the consensus arbiter is allowed to override. */
const CONSENSUS_ENTRY_ACTIONS: ReadonlySet<string> = new Set([
  'enter_long', 'enter_short', 'pyramid_long', 'pyramid_short',
]);

/**
 * Apply a consensus verdict to the kernel's own decision.
 *
 * The arbiter governs ENTRY decisions only. Exit and risk-management
 * actions — stop-loss, take-profit, bracket, `scalp_exit`, `flatten` —
 * MUST execute untouched: a `hold` verdict means "do not open a new
 * trade", never "do not close a losing one".
 *
 * Regression 2026-05-21: with the Python peer live the arbiter returned
 * `no-trade-divergence` (action `hold`); the old call site applied that
 * `hold` to whatever the kernel had decided, including exits, so
 * stop-losses were suppressed for ~14h. This helper gates the override
 * to entry actions only — every non-entry action passes through.
 */
export function applyConsensusOverride(
  own: ConsensusOverrideInput,
  override: ConsensusOverrideInput | null,
): ConsensusOverrideInput {
  if (override === null) return own;
  // Exits / holds / flatten / scalp_exit are never touched by consensus.
  if (!CONSENSUS_ENTRY_ACTIONS.has(own.action)) return own;
  if (override.action === 'hold') {
    return { action: 'hold', size_usdt: 0, leverage: own.leverage };
  }
  if (override.action === 'enter_long' || override.action === 'enter_short') {
    return {
      action: override.action,
      size_usdt: override.size_usdt,
      leverage: override.leverage,
    };
  }
  return own;
}
