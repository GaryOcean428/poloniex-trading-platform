/**
 * kernel_client.ts — parity-telemetry helper for the TS↔Py autonomic
 *                    consensus path.
 *
 * Historically this module also held a large HTTP client surface for an
 * abandoned "Python-authoritative executive" cutover (executive/decide,
 * mode/detect, risk/evaluate, live/decide, live/exit-decide, live/reconcile
 * and the issue #710 k-shadow parity fanout). That cutover never went live —
 * the in-process TS executive in loop.ts remained authoritative throughout —
 * and all of those clients had zero callers. They were removed (PR: strip
 * dead cutover scaffolding) so the only surviving export is the parity-diff
 * logger used by the MONKEY_KERNEL_PY_SHADOW autonomic-parity block.
 */

import { logger } from '../../utils/logger.js';

/**
 * Compare two decisions and log if they diverge significantly. Called
 * opportunistically when MONKEY_KERNEL_PY_SHADOW=true while the TS path is
 * authoritative — gives parity telemetry on the autonomic neurochemistry
 * surface (see loop.ts).
 */
export function logParityDiff(
  kind: string,
  tsValue: number | boolean,
  pyValue: number | boolean,
  tolerance: number = 0.01,
): void {
  if (typeof tsValue === 'boolean' || typeof pyValue === 'boolean') {
    if (tsValue !== pyValue) {
      logger.warn('[kernel_client] parity diff (boolean)', {
        kind,
        ts: tsValue,
        py: pyValue,
      });
    }
    return;
  }
  const diff = Math.abs(tsValue - pyValue);
  if (diff > tolerance) {
    logger.warn('[kernel_client] parity diff (numeric)', {
      kind,
      ts: tsValue,
      py: pyValue,
      diff,
      tolerance,
    });
  }
}
