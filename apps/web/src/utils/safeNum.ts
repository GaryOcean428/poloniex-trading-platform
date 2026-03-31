/**
 * Safely convert any value to a finite number.
 * Returns 0 for undefined, null, NaN, or non-numeric inputs.
 * Prevents ".toFixed() of undefined" crashes throughout the dashboard.
 */
export function safeNum(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
