-- Migration 043: CHOP regime entry suppression parameters (issue #623)
--
-- Adds two OPERATIONAL parameter registry rows that control the
-- confidence thresholds above which new entries are suppressed in
-- confirmed CHOP regime.
--
-- Suppression rules (issue #623):
--   - scalp lane: never suspended (chop is the scalp environment)
--   - trend lane: suspended when regime==CHOP and confidence >= 0.70
--   - swing lane: suspended when regime==CHOP and confidence >= 0.85
--   - TREND_UP / TREND_DOWN: never suspend any lane
--
-- These rows are registry-overridable via propose_change() without
-- redeploy. Rollback is git revert of the calling code (the rows
-- themselves are inert without the suppression logic).

INSERT INTO monkey_parameters
    (name, category, value, bounds_low, bounds_high, justification, version)
VALUES
    (
        'regime.chop_suppress.trend_confidence',
        'OPERATIONAL',
        0.70,
        0.5,
        1.0,
        'CHOP confidence threshold above which trend lane suspends new entries. '
        'Conservative default: only confirmed chop (confidence >= 0.70) suppresses '
        'trend entries. Failure mode of too-low threshold is "system misses trend '
        'entries in borderline chop" — tunable via propose_change().',
        1
    ),
    (
        'regime.chop_suppress.swing_confidence',
        'OPERATIONAL',
        0.85,
        0.5,
        1.0,
        'CHOP confidence threshold above which swing lane suspends new entries. '
        'Higher than the trend threshold (0.85 vs 0.70) because swing tolerates '
        'moderate chop better than trend does. Tunable via propose_change().',
        1
    )
ON CONFLICT (name) DO NOTHING;
