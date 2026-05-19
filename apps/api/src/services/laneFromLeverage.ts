/**
 * Map operator-chosen leverage to a kernel lane.
 *
 * Operator directive 2026-05-19: "kernels should take over my trades.
 * but learn from the amount of leverage as to what I expect." Higher
 * leverage = higher operator conviction → assign to the lane with the
 * widest retreat tolerance.
 *
 * Default boundaries are tuned to the lane-typical leverage ranges in
 * `monkey/executive.ts` (LANE_PARAMETER_DEFAULTS):
 *
 *   scalp  (3%/3%)   ← lev ≤ 3   — exploration / small-conviction
 *   swing  (15%/15%) ← lev 4..10 — medium-conviction working position
 *   trend  (40%/40%) ← lev ≥ 11  — high-conviction macro ride
 *
 * Bounds are overridable via env so an operator can re-tune without a
 * code change once they have a feel for the mapping.
 *
 * Pure function. Lives in its own file (no heavy imports) so it can be
 * unit-tested without bootstrapping the API's env validator or DB
 * connection pool.
 */
export function inferLaneFromLeverage(
  lever: number,
): 'scalp' | 'swing' | 'trend' {
  const swingMin = Number(process.env.MONKEY_ADOPT_SWING_LEV_MIN) || 4;
  const trendMin = Number(process.env.MONKEY_ADOPT_TREND_LEV_MIN) || 11;
  if (lever >= trendMin) return 'trend';
  if (lever >= swingMin) return 'swing';
  return 'scalp';
}

/**
 * True iff MONKEY_RECONCILER_KERNEL_ADOPT_LIVE=true.
 *
 * Default ON — per operator directive 2026-05-19: kernel should take
 * over operator-opened positions instead of orphaning them as
 * USER/manual rows that no exit logic ever fires against. Set to
 * `false` to restore the legacy USER/manual behaviour.
 */
export function kernelAdoptLive(): boolean {
  return (process.env.MONKEY_RECONCILER_KERNEL_ADOPT_LIVE ?? 'true')
    .toLowerCase() === 'true';
}
