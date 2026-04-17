/**
 * Slot allocator for parallel strategy execution.
 *
 * Pool size is 12 (was 10). Of those:
 *   - 2 reserved per strategy class (10 total across 5 classes)
 *   - 2 floating slots for bandit-driven exploration
 *
 * A class never loses all its slots to a hot streak in another class.
 * The floating slots are where the bandit gets to chase winners
 * without strangling diversity.
 *
 * Pure function: given the current occupancy, decide whether a new
 * strategy of a given class can be admitted.
 */

import { ALL_STRATEGY_CLASSES, type StrategyClass } from './thompsonBandit.js';

export const SLOTS_PER_CLASS = 2;
export const FLOATING_SLOTS = 2;
export const TOTAL_SLOTS =
  SLOTS_PER_CLASS * ALL_STRATEGY_CLASSES.length + FLOATING_SLOTS;

export interface SlotOccupancy {
  /** How many active strategies currently belong to each class. */
  countsByClass: Map<StrategyClass, number>;
}

export interface SlotAssignment {
  admitted: boolean;
  reason?: string;
  /** Which bucket the admitted strategy occupies, for observability. */
  bucket?: 'reserved' | 'floating';
}

function countTotal(occupancy: SlotOccupancy): number {
  let n = 0;
  for (const c of occupancy.countsByClass.values()) n += c;
  return n;
}

function countFloatingInUse(occupancy: SlotOccupancy): number {
  // Floating usage = total − reserved-seats-actually-used.
  // A class with 3 strategies consumes its 2 reserved seats + 1 floating.
  let floatingUsed = 0;
  for (const klass of ALL_STRATEGY_CLASSES) {
    const inClass = occupancy.countsByClass.get(klass) ?? 0;
    if (inClass > SLOTS_PER_CLASS) {
      floatingUsed += inClass - SLOTS_PER_CLASS;
    }
  }
  return floatingUsed;
}

/**
 * Try to admit a strategy of `targetClass` given the current occupancy.
 * Returns an assignment telling the caller whether the add is allowed
 * and which bucket it falls into.
 */
export function tryAdmitStrategy(
  targetClass: StrategyClass,
  occupancy: SlotOccupancy,
): SlotAssignment {
  if (countTotal(occupancy) >= TOTAL_SLOTS) {
    return { admitted: false, reason: 'pool_full' };
  }

  const inClass = occupancy.countsByClass.get(targetClass) ?? 0;

  if (inClass < SLOTS_PER_CLASS) {
    return { admitted: true, bucket: 'reserved' };
  }

  // Reserved seats for this class are full. Check floating availability.
  const floatingUsed = countFloatingInUse(occupancy);
  if (floatingUsed < FLOATING_SLOTS) {
    return { admitted: true, bucket: 'floating' };
  }

  return {
    admitted: false,
    reason: `class_${targetClass}_reserved_full_and_floating_full`,
  };
}

/** Utility: update occupancy after successful admission. */
export function withAdmittedStrategy(
  targetClass: StrategyClass,
  occupancy: SlotOccupancy,
): SlotOccupancy {
  const counts = new Map(occupancy.countsByClass);
  counts.set(targetClass, (counts.get(targetClass) ?? 0) + 1);
  return { countsByClass: counts };
}
