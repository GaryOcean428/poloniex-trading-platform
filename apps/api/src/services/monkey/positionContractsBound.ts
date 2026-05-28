/**
 * positionContractsBound.ts — per-(agent, symbol, lane) hard cap on
 * cumulative open contracts.
 *
 * Why this exists:
 *
 * Poloniex v3 rejects single orders > 10,000 contracts with code 21010.
 * The closeChunker (closeChunker.ts) splits an oversized close into chunks
 * — necessary defense, but it treats the symptom. The disease is the
 * kernel letting positions grow that large in the first place. Live tape
 * 2026-05-06 02:08-12hr: Agent T (Turtle pyramid on Donchian breakouts)
 * accumulated 9 BTC swing/trend rows over 12 hours, cumulative quantity
 * far exceeded 10,000 contracts. Stale_bleed correctly fired but every
 * close was rejected. User had to manually flatten on Poloniex UI.
 *
 * The cap below is set well under the exchange limit (8,000 vs 10,000)
 * so the kernel always retains headroom for partial closes / chunked
 * exits. It bounds CUMULATIVE quantity per (agent, symbol, lane),
 * not per-order — so DCA adds, T pyramids, and consecutive M entries
 * all funnel into the same envelope.
 *
 * Independence preserved: K, M, T each get their own cap (the cap is
 * scoped per agent label). One agent maxing out doesn't suppress the
 * others. Mirrors the agentEquityBound discipline (PR #636).
 */

/**
 * Venue-derived structural ceiling. Poloniex v3 hard-rejects single
 * orders > 10,000 contracts (code 21010). The 2,000-contract buffer
 * below that leaves room for one-shot full closes without chunking.
 * 8,000 = 10,000 venue cap − 2,000 chunker buffer. Both numbers are
 * structural (venue-fact + chunker-arithmetic), not operator knobs.
 */
export const VENUE_CONTRACTS_CEILING = 8000;

/**
 * Phase 9 (2026-05-27) — kernel-derived per-position contract cap.
 *
 * MONKEY_MAX_CONTRACTS_PER_POSITION removed. Operator-prescribed
 * fractions between the kernel and the venue wall were the anti-
 * pattern. Now the kernel computes its own cap from observables:
 *
 *   risk_fraction = max(0.1, dopamine × phi × (1 - gaba))
 *   kernel_cap    = floor((equity × risk_fraction × leverage) /
 *                         (mark_price × contract_size))
 *   final_cap     = min(VENUE_CONTRACTS_CEILING, kernel_cap)
 *
 * Risk-fraction observables:
 * - dopamine (reward expectation) — high → kernel willing to expose more
 * - phi (basin integration) — high → kernel trusts its own perception
 * - (1 - gaba) (inverse inhibition) — low gaba → kernel less anxious
 *
 * The 0.1 floor ensures the kernel always retains *some* exposure
 * envelope even when chemistry is bleak (otherwise stressed kernel
 * can't trade its way out). 0.1 is the same SAFETY_BOUND floor as
 * the DISSOLVER cell size multiplier (#946) — same structural rationale.
 *
 * The venue ceiling stays as a structural wall (10,000 contracts is
 * a venue-imposed fact; 2,000 chunker buffer is arithmetic). What's
 * gone is the operator-imposed fraction between the kernel and the wall.
 */
export interface ContractCapObservers {
  availableEquityUsdt: number;
  markPrice: number;
  contractSize: number;
  leverage: number;
  dopamine: number;
  phi: number;
  gaba: number;
}

export function kernelDerivedContractCap(o: ContractCapObservers): number {
  const safeDop = Math.max(0, Math.min(1, o.dopamine));
  const safePhi = Math.max(0, Math.min(1, o.phi));
  const safeGaba = Math.max(0, Math.min(1, o.gaba));
  const riskFraction = Math.max(0.1, safeDop * safePhi * (1 - safeGaba));

  const denom = Math.max(o.markPrice * o.contractSize, 1e-9);
  const equityHeadroom = Math.max(0, o.availableEquityUsdt);
  const leverageMultiplier = Math.max(1, o.leverage);
  const kernelCap = Math.floor(
    (equityHeadroom * riskFraction * leverageMultiplier) / denom,
  );
  return Math.min(VENUE_CONTRACTS_CEILING, Math.max(0, kernelCap));
}

/**
 * Commit 8 — Fix B: Kelly-primary cap (operator brief 2026-05-28).
 *
 * Replaces the structurally-collapsing `max(0.1, dop × phi × (1-gaba))`
 * with Kelly-from-own-outcomes as the primary risk fraction, and a
 * bounded chemistry modulator (∈ [0.5, 1.5]) that shapes but cannot
 * collapse it.
 *
 *   risk_fraction = kelly_frac × modulator
 *
 * The old formula could collapse to its 0.1 floor whenever any of
 * dop / phi / (1-gaba) was extreme. With chemistry depressed
 * (dop=0.37, phi=0.60, gaba=0.45) it sits at exactly that floor —
 * the kernel cannot size up regardless of its actual edge.
 *
 * Fix B's formulation: Kelly fraction from the kernel's OWN observed
 * winRate × avgWin × avgLoss says how much risk the kernel has
 * EARNED. Chemistry then modulates that within ±50% — never zeros it,
 * never multiplies it beyond 1.5×. Phi is dropped from the formula
 * (perception coherence ≠ directional sizing signal).
 *
 * Caller passes `kellyFraction` from computeKellyFraction(ringStats)
 * and `chemistryModulator` from chemistryBoundedModulator(dop, gaba).
 * When `kellyFraction <= 0` (negative edge OR insufficient ring data),
 * caller MUST fall back to the legacy `kernelDerivedContractCap`
 * which the chemistry-only formula still serves correctly for
 * cold-start.
 *
 * Pure observer derivation: Kelly is from own outcomes, modulator is
 * from own chemistry. No operator knob. The 0.5/1.5 bounds on the
 * modulator come from the doctrinal constraint "chemistry must
 * never zero out a Kelly-justified position" — a structural choice,
 * not a tunable.
 */
export interface KellyPrimaryCapObservers {
  availableEquityUsdt: number;
  markPrice: number;
  contractSize: number;
  leverage: number;
  /** From computeKellyFraction(outcomeRingStats). 0 when stats
   *  unavailable or edge non-positive → caller falls through to
   *  legacy chemistry formula. */
  kellyFraction: number;
  /** From chemistryBoundedModulator(dop, gaba). Bounded [0.5, 1.5]. */
  chemistryModulator: number;
}

export function kellyPrimaryContractCap(o: KellyPrimaryCapObservers): number {
  if (o.kellyFraction <= 0) return 0;
  const safeMod = Math.max(0.5, Math.min(1.5, o.chemistryModulator));
  const riskFraction = Math.max(0, Math.min(1.0, o.kellyFraction * safeMod));

  const denom = Math.max(o.markPrice * o.contractSize, 1e-9);
  const equityHeadroom = Math.max(0, o.availableEquityUsdt);
  const leverageMultiplier = Math.max(1, o.leverage);
  const kernelCap = Math.floor(
    (equityHeadroom * riskFraction * leverageMultiplier) / denom,
  );
  return Math.min(VENUE_CONTRACTS_CEILING, Math.max(0, kernelCap));
}

/**
 * Compute the maximum new contracts that can be added without exceeding
 * the per-position cap. Returns 0 when the position is already at-cap.
 *
 * Pure function — caller queries the DB for ``currentContracts``, then
 * uses this to decide whether to clamp or skip the entry.
 */
export function headroomContracts(
  currentContracts: number,
  maxCap: number,
): number {
  if (!Number.isFinite(currentContracts) || currentContracts < 0) return maxCap;
  if (!Number.isFinite(maxCap) || maxCap <= 0) return 0;
  return Math.max(0, maxCap - currentContracts);
}

/**
 * Clamp a desired new entry's contracts to the available headroom.
 * Returns 0 when the headroom is exhausted (caller should suppress
 * the entry rather than place a 0-contract order).
 */
export function clampNewContractsToCap(
  desiredContracts: number,
  currentContracts: number,
  maxCap: number,
): number {
  if (!Number.isFinite(desiredContracts) || desiredContracts <= 0) return 0;
  const headroom = headroomContracts(currentContracts, maxCap);
  return Math.min(desiredContracts, headroom);
}
