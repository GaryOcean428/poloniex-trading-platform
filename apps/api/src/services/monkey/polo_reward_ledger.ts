/**
 * polo_reward_ledger.ts — pure helper for the Polo-authoritative reward
 * ledger PnL computation (#1024).
 *
 * Extracts the gross + close-fees + open-fees + funding composition out
 * of `applyPoloRealizedPnlAfterClose` so the money-path math can be
 * unit-tested in isolation. Loop.ts pulls in env validation + DB + Polo
 * service, which kills the test environment; this helper is pure.
 *
 * # Reward-ledger composition
 *
 *   pnl_net_close_fees_only = gross − close_fees
 *   pnl_net_full            = pnl_net_close_fees_only − open_fees + funding_net_signed
 *
 * Note the SIGN on funding: the canonical Poloniex convention for the
 * `fundingFee` field on `/v3/trade/funding` is the user's SIGNED cash
 * flow.
 *
 *   user PAID funding   → fundingFee < 0 (loss)
 *   user RECEIVED funding → fundingFee > 0 (gain)
 *
 * So the per-event signed amount ALREADY carries the direction; we ADD
 * the sum directly to net (a paid event with negative amount correctly
 * reduces the net). Subtracting `totalFundingFlows` (as the previous
 * draft did) inverts that — paid-funding events end up INCREASING the
 * net while received-funding events DECREASE it. This helper fixes the
 * math.
 *
 * Cross-check at the call site: the existing pre-entry funding gate in
 * `loop.ts` documents the rate convention as "side=long pays when
 * fundingRate8h > 0; side=short pays when fundingRate8h < 0". The
 * `fundingFee` field on the history endpoint is the cash flow
 * RESULTING from that rate; sign follows the user's account.
 *
 * # pnl_source enum
 *
 *   'polo_gross_minus_close_fees' — close fees subtracted, but open-side
 *      fees and funding NOT included (either not indexed yet, or this
 *      account doesn't have them populated). Honest provenance.
 *   'polo_net_full' — close fees + open fees + signed funding all
 *      included; this is the closest the reward channel gets to true
 *      economic net pnl from a kernel-issued close.
 *
 * `hasFullNet` requires BOTH the open-side fee fills indexed AND the
 * funding fetch succeeded. Either one missing → fall back to
 * `polo_gross_minus_close_fees`. The `pnl_net_full` column is still
 * populated when partial (so operators can inspect what's available),
 * but the reward channel consumes only the authoritative value
 * (`poloRealized`).
 *
 * Citations: poloniex-trading-platform#1015 + #1024 (this PR) + Cascade
 * 2026-05-29 review (funding sign concern) + #992 polo-authoritative
 * canonical surface + 2.31A P5/P25 + QIG PURITY MANDATE.
 */

export type PoloPnlSource =
  | 'polo_gross_minus_close_fees'
  | 'polo_net_full';

export interface PoloRewardInputs {
  /** Sum of per-fill grossPnl on the close orders (signed). */
  grossSum: number;
  /** Sum of |feeAmt| on close-side fills (magnitude — fees are costs). */
  totalCloseFees: number;
  /** Sum of |feeAmt| on open-side fills (magnitude — fees are costs). */
  totalOpenFees: number;
  /** True when open-side fee fills were ALL indexed (i.e. complete). */
  openFeesComplete: boolean;
  /** Sum of SIGNED `fundingFee` from `/v3/trade/funding` rows over the
   * position window. Sign is the user's cash flow direction (positive
   * = received, negative = paid). */
  fundingFlowsSigned: number;
  /** True when the funding fetch succeeded (success even if zero rows
   * — empty window is a legitimate zero, not an "unknown"). */
  fundingComplete: boolean;
}

export interface PoloRewardOutput {
  /** Close fees only — always populated as a fallback. */
  pnlNetCloseFeesOnly: number;
  /** Full net including open fees + signed funding. Populated even
   * when partial (open fees may be incomplete) so operators can audit
   * the partial composition. */
  pnlNetFull: number;
  /** True when BOTH open fees AND funding fetched cleanly. */
  hasFullNet: boolean;
  /** The single number to feed into the reward channel + write to
   * autonomous_trades.pnl. */
  poloRealized: number;
  /** Provenance tag. Tracks what was actually composed into
   * `poloRealized`. */
  pnlSource: PoloPnlSource;
}

export function computePoloAuthoritativeReward(
  inputs: PoloRewardInputs,
): PoloRewardOutput {
  const pnlNetCloseFeesOnly = inputs.grossSum - inputs.totalCloseFees;
  // ADD signed funding flow (NOT subtract). The signed value already
  // carries direction: paid funding (negative) reduces net, received
  // funding (positive) increases net. See module docstring.
  const pnlNetFull =
    pnlNetCloseFeesOnly - inputs.totalOpenFees + inputs.fundingFlowsSigned;
  const hasFullNet = inputs.openFeesComplete && inputs.fundingComplete;
  const pnlSource: PoloPnlSource = hasFullNet
    ? 'polo_net_full'
    : 'polo_gross_minus_close_fees';
  const poloRealized = hasFullNet ? pnlNetFull : pnlNetCloseFeesOnly;
  return {
    pnlNetCloseFeesOnly,
    pnlNetFull,
    hasFullNet,
    poloRealized,
    pnlSource,
  };
}

/**
 * Funding sign discrepancy check — returns a list of rows whose
 * `fundingFee` sign disagrees with the expected direction implied by
 * (position side, funding rate sign). Used to surface API convention
 * drift in production logs without breaking the reward channel.
 *
 * Expected direction (per the kernel's pre-entry funding gate
 * documentation in `loop.ts`):
 *   side=long  + rate > 0 → user PAYS  → fundingFee < 0
 *   side=long  + rate < 0 → user RECEIVES → fundingFee > 0
 *   side=short + rate > 0 → user RECEIVES → fundingFee > 0
 *   side=short + rate < 0 → user PAYS  → fundingFee < 0
 */
export interface FundingRow {
  fundingFee: number;
  rate: number;
}

export interface FundingSignDiscrepancy {
  fundingFee: number;
  rate: number;
  expectedSign: 'paid' | 'received';
  actualSign: 'paid' | 'received' | 'zero';
}

export function detectFundingSignDiscrepancies(
  side: 'long' | 'short',
  rows: FundingRow[],
): FundingSignDiscrepancy[] {
  const out: FundingSignDiscrepancy[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.fundingFee) || !Number.isFinite(row.rate)) continue;
    if (row.rate === 0 || row.fundingFee === 0) continue;
    const userPaysByRate =
      (side === 'long' && row.rate > 0) || (side === 'short' && row.rate < 0);
    const expectedSign: 'paid' | 'received' = userPaysByRate ? 'paid' : 'received';
    const actualSign: 'paid' | 'received' = row.fundingFee < 0 ? 'paid' : 'received';
    if (expectedSign !== actualSign) {
      out.push({
        fundingFee: row.fundingFee,
        rate: row.rate,
        expectedSign,
        actualSign,
      });
    }
  }
  return out;
}
