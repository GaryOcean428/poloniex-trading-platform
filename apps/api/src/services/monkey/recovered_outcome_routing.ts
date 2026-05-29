/**
 * Helpers for routing reconciler-recovered outcomes back to the owning
 * MonkeyKernel instance.
 */

export function extractKernelInstanceIdFromReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const match = reason.match(/(?:^|\|)kernel=([^|]+)/);
  return match?.[1] ?? null;
}

export function recoveredOutcomeMatchesInstance(
  payload: Record<string, unknown> | undefined,
  instanceId: string,
): boolean {
  const target = payload?.instanceId;
  if (typeof target !== 'string' || target.length === 0) return true;
  return target === instanceId;
}
