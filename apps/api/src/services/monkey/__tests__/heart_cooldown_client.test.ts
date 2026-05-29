import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composeCooldown } from '../cooldown_composer.js';
import {
  _resetHeartCooldownCache,
  cachedHeartCooldownMs,
  refreshHeartCooldown,
} from '../heart_cooldown_client.js';
import {
  _resetHeartState,
  noteClose,
} from '../heart_arbitrator.js';
import { _resetSafetyFloorState } from '../safety_floor.js';

const SYM = 'BTC_USDT_PERP';

describe('heart_cooldown_client — Python HEART bridge', () => {
  beforeEach(() => {
    _resetHeartCooldownCache();
    _resetHeartState();
    _resetSafetyFloorState();
    vi.restoreAllMocks();
  });

  it('posts lived close distribution to ml-worker and caches HEART-owned cooldown', async () => {
    noteClose(SYM, 1000, -1);
    noteClose(SYM, 3500, -2);

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.symbol).toBe(SYM);
      expect(body.recent_close_pnls).toEqual([-1, -2]);
      expect(body.recent_close_gaps_ms).toEqual([2500]);
      expect(body.tacking_phase).toBe('LOGIC');
      return {
        ok: true,
        json: async () => ({
          safety_floor_ms: 0,
          decoherence_floor_ms: 0,
          heart_arbitrated_ms: 4000,
          final_cooldown_ms: 4000,
          by: 'heart',
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await refreshHeartCooldown({
      symbol: SYM,
      safetyFloorMs: 0,
      decoherenceFloorMs: 0,
      heartRhythm: 1,
      tackingPhase: 'LOGIC',
    });

    expect(cachedHeartCooldownMs(SYM)).toBe(4000);
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      heartProvider: cachedHeartCooldownMs,
    });
    expect(b.heartMs).toBe(4000);
    expect(b.by).toBe('heart');
  });
});
