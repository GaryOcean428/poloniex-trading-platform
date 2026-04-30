-- 041_quarantine_pre_basin_reproject_bubbles.sql
--
-- Companion to proposal #7 (basin_direction Fisher-Rao reprojection).
-- Quarantines bubbles whose basinDir was computed under the pre-2026-04-30
-- saturating ``tanh((mom_mass - MOM_NEUTRAL) * 16)`` formula.
--
-- Pre-reproject bubbles encode their geometric retrieval coordinates
-- with the saturating formula. Post-reproject coordinates use the
-- Fisher-Rao geodesic formulation (see basin_direction docstring).
-- Mixing the two produces:
--   * False matches — a saturated +0.92 pre-reproject bubble retrieves
--     against any post-reproject bubble whose true direction registers
--     as +0.3 (mild bull), pulling Hebbian updates toward an outcome
--     that doesn't represent the same regime.
--   * Distance distortion — Fisher-Rao retrieval distances over
--     mixed-coordinate bubbles are no longer comparable.
--
-- Solution: quarantine flag (mirrors migration 036 pattern). Filter
-- quarantined bubbles out of retrieval / sovereignty / nearestBasin
-- queries. Bubbles stay in the table for forensic analysis; they can
-- be unquarantined once an offline coordinate-recovery method is
-- established.
--
-- Cutoff: deploy timestamp of this migration. The migration writes
-- NOW() into quarantined_at so the cutoff is recorded inline; runtime
-- code uses the quarantined flag, not a timestamp comparison.

BEGIN;

-- Migration 036 already added (quarantined, quarantine_reason,
-- quarantined_at) columns; this migration only sets new flags. The
-- ALTER TABLE statements below are idempotent if 036 has already
-- run.

ALTER TABLE monkey_resonance_bank
    ADD COLUMN IF NOT EXISTS quarantined BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE monkey_resonance_bank
    ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

ALTER TABLE monkey_resonance_bank
    ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ;

-- Quarantine all currently-active bubbles. Anything created BEFORE
-- the deploy of this migration was scored under the saturating
-- formula. New bubbles created after deploy get basinDir under the
-- Fisher-Rao reprojection and are NOT quarantined.
--
-- Idempotent: only flips bubbles not already quarantined. If the
-- migration is replayed, no-op.
UPDATE monkey_resonance_bank
   SET quarantined       = true,
       quarantine_reason = 'pre_basin_reproject_proposal_7_geometric_contamination',
       quarantined_at    = NOW()
 WHERE quarantined = false
   AND created_at < NOW();  -- self-fences re-runs

-- Partial indexes from migration 036 already cover the active-bubble
-- read path. No new indexes required.

COMMIT;
