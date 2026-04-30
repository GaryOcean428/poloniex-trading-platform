import { describe, it, expect } from 'vitest';
import {
  detectBearishEngulfing,
  detectBullishEngulfing,
  detectDoji,
  detectEveningStar,
  detectHammer,
  detectHangingMan,
  detectInvertedHammer,
  detectMorningStar,
  detectShootingStar,
  detectStrongest,
  hammerAgainstLongSl,
  patternSignalScalar,
  type OHLCVRow,
} from '../candlePatterns.js';

function candle(o: number, h: number, l: number, c: number, v = 1.0): OHLCVRow {
  return { open: o, high: h, low: l, close: c, volume: v };
}

function downtrend(n = 5, start = 100, step = 1): OHLCVRow[] {
  const out: OHLCVRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push(candle(start - i * step + 0.4, start - i * step + 0.6,
                    start - i * step - 0.2, start - i * step));
  }
  return out;
}

function uptrend(n = 5, start = 100, step = 1): OHLCVRow[] {
  const out: OHLCVRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push(candle(start + i * step - 0.4, start + i * step + 0.2,
                    start + i * step - 0.6, start + i * step));
  }
  return out;
}

describe('candle patterns — hammer', () => {
  it('textbook hammer after downtrend', () => {
    const ctx = downtrend();
    ctx.push(candle(99.0, 99.3, 98.0, 99.2));
    const r = detectHammer(ctx);
    expect(r.patternName).toBe('hammer');
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(1);
  });

  it('no hammer when body too large', () => {
    const c = candle(99.0, 100.0, 98.5, 99.95);
    expect(detectHammer([c]).strength).toBe(0);
  });

  it('handles zero range', () => {
    const c = candle(100, 100, 100, 100);
    expect(detectHammer([c]).strength).toBe(0);
  });
});

describe('candle patterns — inverted hammer', () => {
  it('textbook inverted hammer after downtrend', () => {
    const ctx = downtrend();
    ctx.push(candle(99.0, 100.5, 98.95, 99.1));
    const r = detectInvertedHammer(ctx);
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(1);
  });
});

describe('candle patterns — shooting star', () => {
  it('textbook shooting star after uptrend', () => {
    const ctx = uptrend();
    ctx.push(candle(100.5, 102.0, 100.45, 100.6));
    const r = detectShootingStar(ctx);
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(-1);
  });

  it('no shooting star without prior uptrend', () => {
    const ctx = downtrend();
    ctx.push(candle(100.5, 102.0, 100.45, 100.6));
    expect(detectShootingStar(ctx).strength).toBe(0);
  });
});

describe('candle patterns — hanging man', () => {
  it('textbook hanging man after uptrend', () => {
    const ctx = uptrend();
    ctx.push(candle(100.5, 100.6, 99.0, 100.4));
    const r = detectHangingMan(ctx);
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(-1);
  });

  it('no hanging man without prior uptrend', () => {
    const ctx = downtrend();
    ctx.push(candle(100.5, 100.6, 99.0, 100.4));
    expect(detectHangingMan(ctx).strength).toBe(0);
  });
});

describe('candle patterns — doji', () => {
  it('textbook doji', () => {
    const c = candle(100, 101, 99, 100);
    const r = detectDoji([c]);
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(0);
  });

  it('strength shrinks as body grows', () => {
    const ra = detectDoji([candle(100, 101, 99, 100.05)]);
    const rb = detectDoji([candle(100, 101, 99, 100.0)]);
    expect(rb.strength).toBeGreaterThan(ra.strength);
  });

  it('no doji on large body', () => {
    expect(detectDoji([candle(100, 101, 99, 100.5)]).strength).toBe(0);
  });
});

describe('candle patterns — bullish engulfing', () => {
  it('textbook', () => {
    const prev = candle(100, 100.5, 99, 99.5);
    const curr = candle(99.4, 101, 99.3, 100.7);
    const r = detectBullishEngulfing([prev, curr]);
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(1);
  });

  it('no engulf when curr is bearish', () => {
    const prev = candle(100, 100.5, 99, 99.5);
    const curr = candle(99.4, 100, 98.5, 98.7);
    expect(detectBullishEngulfing([prev, curr]).strength).toBe(0);
  });

  it('no engulf with short input', () => {
    expect(detectBullishEngulfing([candle(100, 101, 99, 100)]).strength).toBe(0);
  });
});

describe('candle patterns — bearish engulfing', () => {
  it('textbook', () => {
    const prev = candle(99.5, 100.5, 99, 100);
    const curr = candle(100.2, 100.5, 98.5, 99);
    const r = detectBearishEngulfing([prev, curr]);
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(-1);
  });
});

describe('candle patterns — morning star', () => {
  it('textbook', () => {
    const a = candle(100, 100.5, 98, 98.5);
    const b = candle(98.4, 98.6, 98.2, 98.5);
    const c = candle(98.5, 99.7, 98.4, 99.5);
    const r = detectMorningStar([a, b, c]);
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(1);
  });
});

describe('candle patterns — evening star', () => {
  it('textbook', () => {
    const a = candle(98, 100.5, 97.5, 100);
    const b = candle(100.1, 100.3, 99.9, 100);
    const c = candle(100, 100.1, 98, 98.5);
    const r = detectEveningStar([a, b, c]);
    expect(r.strength).toBeGreaterThan(0);
    expect(r.direction).toBe(-1);
  });
});

describe('candle patterns — detectStrongest aggregator', () => {
  it('returns no_pattern on empty input', () => {
    const r = detectStrongest([]);
    expect(r.strength).toBe(0);
    expect(r.patternName).toBe('none');
  });

  it('picks the strongest fire', () => {
    const ctx = downtrend();
    ctx.push(candle(99.0, 99.3, 98.0, 99.2));
    const r = detectStrongest(ctx);
    expect(r.patternName).toBe('hammer');
  });

  it('returns near-zero on neutral candles', () => {
    const r = detectStrongest([candle(100, 100.5, 99.5, 100.1)]);
    expect(r.strength).toBeLessThan(0.01);
  });
});

describe('candle patterns — integration helpers', () => {
  it('patternSignalScalar bullish', () => {
    expect(patternSignalScalar({ patternName: 'hammer', strength: 0.8, direction: 1 })).toBeCloseTo(0.8);
  });

  it('patternSignalScalar bearish', () => {
    expect(patternSignalScalar({ patternName: 'evening_star', strength: 0.6, direction: -1 })).toBeCloseTo(-0.6);
  });

  it('patternSignalScalar neutral', () => {
    expect(patternSignalScalar({ patternName: 'doji', strength: 0.5, direction: 0 })).toBeCloseTo(0);
  });

  it('hammerAgainstLongSl fires on strong hammer', () => {
    const ctx = downtrend();
    ctx.push(candle(99.5, 99.7, 97.5, 99.6));
    expect(hammerAgainstLongSl(ctx)).toBe(true);
  });

  it('hammerAgainstLongSl does not fire on random', () => {
    const ctx: OHLCVRow[] = [];
    for (let i = 0; i < 6; i++) ctx.push(candle(100, 100.5, 99.5, 100.1));
    expect(hammerAgainstLongSl(ctx)).toBe(false);
  });
});

describe('candle patterns — robustness', () => {
  it('strength always in [0,1] for synthetic candles', () => {
    let seed = 12;
    function rng() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    for (let i = 0; i < 60; i++) {
      const o = 100 + (rng() - 0.5) * 4;
      const h = Math.max(o, 100 + rng() * 5);
      const l = Math.min(o, 100 - rng() * 5);
      const c = o + (rng() - 0.5) * 4;
      const cand = candle(o, h, l, c);
      for (const det of [detectHammer, detectInvertedHammer, detectDoji]) {
        const r = det([cand]);
        expect(r.strength).toBeGreaterThanOrEqual(0);
        expect(r.strength).toBeLessThanOrEqual(1);
        expect([-1, 0, 1]).toContain(r.direction);
      }
    }
  });
});
