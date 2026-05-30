import { describe, expect, it } from 'vitest';
import { hasEntrySignalConviction } from '../loop.js';

describe('hasEntrySignalConviction', () => {
	it('rejects weak sideways-chop geometric leans below the derived entry threshold', () => {
		const result = hasEntrySignalConviction({
			basinDir: 0.05,
			tapeTrend: -0.17,
			entryThreshold: 0.1,
		});

		expect(result.hasConviction).toBe(false);
		expect(result.signal).toBeCloseTo(-0.035, 6);
		expect(result.strength).toBeCloseTo(0.035, 6);
	});

	it('allows geometric signal only when absolute strength clears the derived threshold', () => {
		const result = hasEntrySignalConviction({
			basinDir: -0.08,
			tapeTrend: -0.12,
			entryThreshold: 0.1,
		});

		expect(result.hasConviction).toBe(true);
		expect(result.signal).toBeCloseTo(-0.14, 6);
		expect(result.strength).toBeCloseTo(0.14, 6);
	});
});
