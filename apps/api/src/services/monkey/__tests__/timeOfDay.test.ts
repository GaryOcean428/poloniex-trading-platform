import { describe, it, expect } from 'vitest';
import { observeTimeOfDay, hourCycleDistance } from '../time_of_day.js';

describe('observeTimeOfDay — pure derivation', () => {
  it('midnight UTC has hourSin=0, hourCos=1 (the 0-radian point on unit circle)', () => {
    const r = observeTimeOfDay(new Date('2026-05-17T00:00:00.000Z'));
    expect(r.hourSin).toBeCloseTo(0, 9);
    expect(r.hourCos).toBeCloseTo(1, 9);
    expect(r.hourUtc).toBeCloseTo(0, 6);
  });

  it('06:00 UTC has hourSin=1, hourCos=0 (quarter-cycle)', () => {
    const r = observeTimeOfDay(new Date('2026-05-17T06:00:00.000Z'));
    expect(r.hourSin).toBeCloseTo(1, 9);
    expect(r.hourCos).toBeCloseTo(0, 9);
  });

  it('noon UTC has hourSin=0, hourCos=-1 (half-cycle)', () => {
    const r = observeTimeOfDay(new Date('2026-05-17T12:00:00.000Z'));
    expect(r.hourSin).toBeCloseTo(0, 9);
    expect(r.hourCos).toBeCloseTo(-1, 9);
  });

  it('18:00 UTC has hourSin=-1, hourCos=0 (three-quarter-cycle)', () => {
    const r = observeTimeOfDay(new Date('2026-05-17T18:00:00.000Z'));
    expect(r.hourSin).toBeCloseTo(-1, 9);
    expect(r.hourCos).toBeCloseTo(0, 9);
  });

  it('day-of-week sine/cosine reflect ISO weekday (Mon=0, Sun=6)', () => {
    // 2026-05-17 is a Sunday → ISO day 6
    const sun = observeTimeOfDay(new Date('2026-05-17T00:00:00.000Z'));
    expect(sun.dayOfWeek).toBe(6);
    // 2026-05-18 Monday → ISO day 0 → daySin = sin(0) = 0, dayCos = cos(0) = 1
    const mon = observeTimeOfDay(new Date('2026-05-18T00:00:00.000Z'));
    expect(mon.dayOfWeek).toBe(0);
    expect(mon.daySin).toBeCloseTo(0, 9);
    expect(mon.dayCos).toBeCloseTo(1, 9);
  });

  it('values stay in [-1, +1]', () => {
    for (let h = 0; h < 24; h++) {
      const d = new Date(Date.UTC(2026, 4, 17, h, 0, 0));
      const r = observeTimeOfDay(d);
      expect(r.hourSin).toBeGreaterThanOrEqual(-1);
      expect(r.hourSin).toBeLessThanOrEqual(1);
      expect(r.hourCos).toBeGreaterThanOrEqual(-1);
      expect(r.hourCos).toBeLessThanOrEqual(1);
    }
  });
});

describe('hourCycleDistance — wraparound-safe time distance', () => {
  it('distance from self is 0', () => {
    const a = observeTimeOfDay(new Date('2026-05-17T12:00:00.000Z'));
    expect(hourCycleDistance(a, a)).toBeCloseTo(0, 6);
  });

  it('distance from opposite times is 1.0 (full π apart)', () => {
    const midnight = observeTimeOfDay(new Date('2026-05-17T00:00:00.000Z'));
    const noon = observeTimeOfDay(new Date('2026-05-17T12:00:00.000Z'));
    expect(hourCycleDistance(midnight, noon)).toBeCloseTo(1, 6);
  });

  it('23:59 and 00:01 are ADJACENT despite raw-hour values being far apart', () => {
    // Naive raw-hour encoding: |23.98 − 0.02| = 23.97 (looks maximally distant)
    // Sin/cos cycle encoding: ~0.001 cycle distance (correct: they're 2 min apart)
    const lateA = observeTimeOfDay(new Date('2026-05-17T23:59:00.000Z'));
    const earlyB = observeTimeOfDay(new Date('2026-05-18T00:01:00.000Z'));
    expect(hourCycleDistance(lateA, earlyB)).toBeLessThan(0.01);
  });

  it('quarter-cycle distance is 0.5', () => {
    const midnight = observeTimeOfDay(new Date('2026-05-17T00:00:00.000Z'));
    const six = observeTimeOfDay(new Date('2026-05-17T06:00:00.000Z'));
    expect(hourCycleDistance(midnight, six)).toBeCloseTo(0.5, 6);
  });
});
