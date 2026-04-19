/**
 * Thompson-sampled class bandit.
 *
 * The current SLE generator is random-search with elitism — no
 * mechanism biases it toward strategy classes that are actually
 * working. This module turns the class-selection step into a
 * Beta-Bernoulli bandit so winning classes get more future variants.
 *
 * Posterior state: Beta(wins, losses) per (strategy_class × regime).
 * Rewards on update:
 *   - live PnL      → 1.0× weight  (primary signal)
 *   - paper PnL     → 0.1× weight  (useful but noisy)
 *   - backtest pass → 0.01× weight (weakest signal)
 *
 * sampleClass(regime) draws from each class's posterior and returns
 * the arg-max. The Beta-sampler is a ratio of Gamma draws, which is
 * equivalent to Beta(α, β) without requiring a math library.
 */

export type RewardKind = 'live' | 'paper' | 'backtest';

export interface BanditCounter {
  wins: number;
  losses: number;
}

/** Beta(1, 1) = uniform prior. */
export const DEFAULT_BANDIT_COUNTER: BanditCounter = Object.freeze({ wins: 1, losses: 1 });

const REWARD_WEIGHTS: Record<RewardKind, number> = {
  live: 1.0,
  paper: 0.1,
  backtest: 0.01,
};

/** Classes produced by the generator. Matches existing strategyType enum. */
export type StrategyClass =
  | 'scalping'
  | 'trend_following'
  | 'mean_reversion'
  | 'breakout'
  | 'momentum';

export const ALL_STRATEGY_CLASSES: StrategyClass[] = [
  'scalping',
  'trend_following',
  'mean_reversion',
  'breakout',
  'momentum',
];

/**
 * Leverage bucket for the third dimension of the bandit key.
 *
 * Different leverage regimes behave fundamentally differently on the
 * same (strategy_class × regime) — e.g. a 15x short in a ranging market
 * has a dramatically different win/loss distribution than a 2x short
 * in the same regime. Bucketing lets the posterior learn that distinction
 * without a per-integer-leverage combinatorial explosion.
 *
 * Buckets:
 *   low:  leverage <= 3x   (capital-preserving, scalp-style)
 *   mid:  4x <= leverage <= 10x   (default live-signal band)
 *   high: leverage >= 11x  (aggressive, only allowed where symbol max permits)
 */
export type LeverageBucket = 'low' | 'mid' | 'high';

export const ALL_LEVERAGE_BUCKETS: LeverageBucket[] = ['low', 'mid', 'high'];

export function bucketOfLeverage(leverage: number): LeverageBucket {
  if (leverage <= 3) return 'low';
  if (leverage <= 10) return 'mid';
  return 'high';
}

/**
 * Sample from Beta(α, β) using the Gamma-ratio method.
 *   x ~ Gamma(α, 1), y ~ Gamma(β, 1)  →  x/(x+y) ~ Beta(α, β)
 *
 * Uses Marsaglia & Tsang's method for Gamma sampling (valid for α ≥ 1;
 * we add a uniform shift for the α < 1 branch).
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  if (alpha <= 0 || beta <= 0) return 0.5; // degenerate; fall back to midpoint
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    // Johnk's generator for shape < 1
    const u = rng();
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  // Marsaglia & Tsang
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normalSample(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function normalSample(rng: () => number): number {
  // Box-Muller
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Apply an outcome to the counter. `signedReward` > 0 counts as a win
 * weighted by REWARD_WEIGHTS[kind]; ≤ 0 counts as a loss similarly.
 * Fractional counts accumulate — the Beta distribution is well-defined
 * for non-integer α, β.
 */
export function applyOutcome(
  counter: BanditCounter,
  kind: RewardKind,
  signedReward: number,
): BanditCounter {
  const weight = REWARD_WEIGHTS[kind];
  if (signedReward > 0) {
    return { wins: counter.wins + weight, losses: counter.losses };
  }
  return { wins: counter.wins, losses: counter.losses + weight };
}

/**
 * Sample the best-posterior class for a given regime.
 * Callers must provide the counter for every class; missing entries
 * default to the Beta(1,1) prior. Pure function — rng is injectable
 * for deterministic tests.
 */
export function sampleBestClass(
  countersByClass: Map<StrategyClass, BanditCounter>,
  rng: () => number = Math.random,
): StrategyClass {
  let bestClass: StrategyClass = ALL_STRATEGY_CLASSES[0];
  let bestSample = -1;
  for (const klass of ALL_STRATEGY_CLASSES) {
    const c = countersByClass.get(klass) ?? DEFAULT_BANDIT_COUNTER;
    const s = sampleBeta(c.wins, c.losses, rng);
    if (s > bestSample) {
      bestSample = s;
      bestClass = klass;
    }
  }
  return bestClass;
}
