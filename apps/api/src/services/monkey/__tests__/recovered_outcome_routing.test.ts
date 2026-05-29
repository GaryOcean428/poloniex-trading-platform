import { describe, expect, it } from 'vitest';

import {
  extractKernelInstanceIdFromReason,
  recoveredOutcomeMatchesInstance,
} from '../recovered_outcome_routing.js';

describe('recovered outcome routing', () => {
  it('extracts the owning kernel instance from monkey trade reasons', () => {
    expect(
      extractKernelInstanceIdFromReason(
        'monkey|kernel=monkey-swing|agent=K|lane=scalp|src=v0.10',
      ),
    ).toBe('monkey-swing');
  });

  it('leaves legacy non-kernel reasons untargeted', () => {
    expect(extractKernelInstanceIdFromReason('kernel_adopted|exchange_pid=abc')).toBeNull();
    expect(extractKernelInstanceIdFromReason(null)).toBeNull();
  });

  it('routes targeted reconciler outcomes only to the owning instance', () => {
    const payload = { instanceId: 'monkey-position' };
    expect(recoveredOutcomeMatchesInstance(payload, 'monkey-position')).toBe(true);
    expect(recoveredOutcomeMatchesInstance(payload, 'monkey-swing')).not.toBe(true);
  });

  it('keeps legacy untargeted outcome events backward-compatible', () => {
    expect(recoveredOutcomeMatchesInstance({ pnl: -1 }, 'monkey-swing')).toBe(true);
  });
});
