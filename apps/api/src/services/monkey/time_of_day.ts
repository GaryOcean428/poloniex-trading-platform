/**
 * time_of_day.ts — SENSE-2c (telemetry-only).
 *
 * Markets aren't time-stationary. Asian, EU, and US sessions have
 * different liquidity, volatility, and participant composition. The
 * kernel currently has no temporal sensation — every tick looks like
 * every other tick from the substrate's point of view.
 *
 * Per the audit's QIG-pure framing: encode time as a continuous,
 * rotationally-continuous pair (sine, cosine) of UTC hour-of-day and
 * day-of-week. Session bucketing (Asian/EU/US) is DOWNSTREAM of these
 * continuous values — the executive decides what to do with the
 * (sin, cos) pair; this module just surfaces the observation.
 *
 * Why sine/cosine (not raw hour): the encoding is rotationally
 * continuous. Midnight (h=0) and 23:59 (h=23.98) are 1 minute apart in
 * reality, but raw-hour encoding makes them maximally distant (0 vs
 * 23.98). The (sin, cos) pair on a unit circle puts them adjacent.
 * Same trick applied to day-of-week.
 *
 * Phase 1 (this module): pure derivation + telemetry. No decision path
 * consumes it yet.
 *
 * Phase 2 (follow-up): expose as basin dimensions or as session-context
 * features the executive folds into entry-threshold gating.
 */

export interface TimeOfDayReading {
  /** UTC hour-of-day as a sine on a 24-hour cycle. */
  hourSin: number;
  /** UTC hour-of-day as a cosine on a 24-hour cycle. */
  hourCos: number;
  /** UTC day-of-week as a sine on a 7-day cycle. */
  daySin: number;
  /** UTC day-of-week as a cosine on a 7-day cycle. */
  dayCos: number;
  /** Hour-of-day as a float in [0, 24) — surfaced for telemetry
   *  readability; downstream should use hourSin/Cos. */
  hourUtc: number;
  /** Day-of-week as int in [0, 6] (Mon=0, Sun=6) — same purpose. */
  dayOfWeek: number;
}

/**
 * Compute the time-of-day phase observation. Accepts an explicit Date
 * for testability; defaults to now.
 *
 * Pure derivation: sine and cosine of normalized cycle position.
 * No state, no buffer, no thresholds.
 */
export function observeTimeOfDay(now: Date = new Date()): TimeOfDayReading {
  const ms = now.getTime();
  // UTC seconds since midnight.
  const utcMs = ms % (24 * 60 * 60 * 1000);
  const hourUtc = utcMs / (60 * 60 * 1000);  // 0..24

  // ISO day-of-week: Mon=0, Sun=6. JS getUTCDay() returns Sun=0; remap.
  const jsDay = now.getUTCDay();  // 0..6 with Sun=0
  const dayOfWeek = (jsDay + 6) % 7;  // shift so Mon=0, Sun=6

  const hourAngle = (hourUtc / 24) * 2 * Math.PI;
  const dayAngle = (dayOfWeek / 7) * 2 * Math.PI;

  return {
    hourSin: Math.sin(hourAngle),
    hourCos: Math.cos(hourAngle),
    daySin: Math.sin(dayAngle),
    dayCos: Math.cos(dayAngle),
    hourUtc,
    dayOfWeek,
  };
}

/**
 * Distance on the time-of-day cycle between two readings, in unit-cycle
 * units [0, 1]. 0 = same hour-of-day; 0.5 = opposite side of the
 * 24-hour clock. Useful for "are these two events at similar times of
 * day" queries without dealing with the wraparound at midnight.
 */
export function hourCycleDistance(a: TimeOfDayReading, b: TimeOfDayReading): number {
  // dot product on the unit circle = cos(angular distance)
  const dot = a.hourSin * b.hourSin + a.hourCos * b.hourCos;
  // clamp dot to [-1, 1] in case of float noise
  const clamped = Math.max(-1, Math.min(1, dot));
  // angular distance in radians, normalised to [0, 1] over [0, π]
  return Math.acos(clamped) / Math.PI;
}
