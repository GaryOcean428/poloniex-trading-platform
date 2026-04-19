/**
 * Agent-strategy `performance` JSON — canonical unit conventions.
 *
 * The `agent_strategies.performance` JSONB column is the source of truth for
 * strategy metrics shown on the Backtest / agent dashboard cards. Historically
 * multiple writers populated it with inconsistent unit conventions:
 *
 *   - some wrote `totalReturn` as percent (−89.60 meaning −89.60%)
 *   - some wrote `totalReturn` as decimal (−0.006 meaning −0.6%)
 *   - same split for `maxDrawdown`
 *
 * PR #502 standardised the *consumer* side (UI strictly treats rows as
 * decimal, per apps/api/src/routes/agent.ts block comment). This module
 * standardises the *producer* and *normaliser* sides:
 *
 *   - `validateAgentStrategyPerformance` — pre-write guardrail that refuses
 *     rows outside the canonical decimal window. Any future writer to
 *     `agent_strategies.performance` MUST call this before insert/update.
 *   - `normalizeAgentStrategyPerformance` — transitional defence used on the
 *     read path (see `apps/api/src/routes/backtest.ts`). Legacy rows stored
 *     `totalReturn`/`maxDrawdown` in percent form; this coerces them to
 *     decimal on-the-fly so the UI contract holds even before the legacy
 *     rows are backfilled.
 *
 * ## Canonical units (decimal form)
 *
 *   winRate       : ratio in [0, 1]          (0.4286 = 42.86%)
 *   totalReturn   : ratio, |x| ≤ 10          (−0.006 = −0.6%)
 *   maxDrawdown   : ratio in [0, 1]          (0.05886 = 5.886%)
 *   profitFactor  : ratio in [0, 1000]       (1.55 = 1.55× gross win/loss)
 *   totalTrades   : non-negative integer     (7)
 *   totalPnl      : dollars (as-is, no scaling)
 *
 * Optional companion field: `maxDrawdownPercent` (already-multiplied, for
 * display convenience). Primary storage remains decimal. If present it is
 * validated in percent form.
 */

/** Finite-number coerce. Mirrors `safeNum` in backtestingEngine.js. */
function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export interface NormalizedAgentStrategyPerformance {
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  totalTrades: number;
  totalPnl: number;
  // Pass-through: any other field in the raw row survives unmodified.
  [key: string]: unknown;
}

/**
 * Pre-write guardrail for `agent_strategies.performance`.
 *
 * Refuses rows whose values fall outside the canonical decimal window.
 * Throws a plain `Error` on violation; callers log and skip the write.
 *
 * Mirrors `validateBacktestMetrics` in `backtestingEngine.js` but in
 * decimal form (that validator accepts `winRate` as percent 0–100 because
 * `backtest_results` rows are stored percent; this one accepts winRate as
 * decimal 0–1 because `agent_strategies.performance` is stored decimal).
 */
export function validateAgentStrategyPerformance(perf: Record<string, unknown>): void {
  if (perf == null || typeof perf !== 'object') {
    throw new Error('validateAgentStrategyPerformance: perf is not an object');
  }

  const winRate = Number(perf.winRate ?? 0);
  const totalReturn = Number(perf.totalReturn ?? 0);
  const maxDrawdown = Number(perf.maxDrawdown ?? 0);
  const profitFactor = Number(perf.profitFactor ?? 0);

  if (!Number.isFinite(winRate) || winRate < 0 || winRate > 1) {
    throw new Error(
      `Invalid winRate ${winRate}: expected decimal in [0, 1]. 0.5 = 50%.`
    );
  }
  if (!Number.isFinite(totalReturn) || Math.abs(totalReturn) > 10) {
    throw new Error(
      `Invalid totalReturn ${totalReturn}: expected decimal where 0.1 = 10% ` +
        `and |x| must be ≤ 10.`
    );
  }
  if (!Number.isFinite(maxDrawdown) || maxDrawdown < 0 || maxDrawdown > 1) {
    throw new Error(
      `Invalid maxDrawdown ${maxDrawdown}: expected decimal in [0, 1]. 0.15 = 15%.`
    );
  }
  // profitFactor of 9999.99 is the "no loss" sentinel used in the engine.
  if (
    !Number.isFinite(profitFactor) ||
    profitFactor < 0 ||
    (profitFactor > 1000 && profitFactor !== 9999.99)
  ) {
    throw new Error(
      `Invalid profitFactor ${profitFactor}: expected ratio in [0, 1000] ` +
        `(9999.99 reserved as zero-loss sentinel).`
    );
  }
}

/**
 * Transitional read-path defence for legacy `agent_strategies.performance`
 * rows.
 *
 * Legacy rows stored `totalReturn` / `maxDrawdown` as PERCENT form (−89.60,
 * 5.886). Canonical going forward is DECIMAL (−0.896, 0.05886). This
 * normaliser detects the legacy convention by magnitude and coerces to
 * decimal. New canonical rows are left untouched.
 *
 * Magnitude heuristic:
 *   - totalReturn — a *real* decimal totalReturn can be at most ~10x
 *     (+1000% return). Anything beyond that is legacy percent form.
 *   - maxDrawdown — a *real* decimal drawdown is in [0, 1]. Anything >1
 *     is legacy percent form.
 *
 * This heuristic will misclassify a truly astronomical decimal totalReturn
 * (|x| > 10). The validator above refuses such rows at write time, so
 * going forward no such row should ever be stored. Legacy rows with
 * values in the ambiguous zone (|totalReturn| ∈ (1, 10]) are assumed
 * decimal — the same assumption the validator encodes.
 *
 * @remarks This is a TRANSITIONAL defence. Once the legacy rows are
 * backfilled (out of scope for this PR), this function should become
 * an identity pass-through and eventually be removed.
 */
export function normalizeAgentStrategyPerformance(
  raw: Record<string, unknown> | null | undefined
): NormalizedAgentStrategyPerformance {
  const source = (raw ?? {}) as Record<string, unknown>;

  const rawTotalReturn = finiteNumber(source.totalReturn, 0);
  const rawMaxDrawdown = finiteNumber(source.maxDrawdown, 0);
  const winRate = finiteNumber(source.winRate, 0);
  const profitFactor = finiteNumber(source.profitFactor, 0);
  const totalTrades = finiteNumber(source.totalTrades, 0);
  const totalPnl = finiteNumber(source.totalPnl, 0);

  // Legacy rows stored totalReturn in percent. Any |x| > 10 is percent-form
  // (decimal rows are validated to |x| ≤ 10 at write time).
  const totalReturn =
    Math.abs(rawTotalReturn) > 10 ? rawTotalReturn / 100 : rawTotalReturn;

  // Legacy rows stored maxDrawdown in percent. Any |x| > 1 is percent-form.
  const maxDrawdown =
    Math.abs(rawMaxDrawdown) > 1 ? rawMaxDrawdown / 100 : rawMaxDrawdown;

  return {
    ...source,
    winRate,
    totalReturn,
    maxDrawdown,
    profitFactor,
    totalTrades,
    totalPnl,
  };
}
