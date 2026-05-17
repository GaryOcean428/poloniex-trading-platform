-- Migration 054: PARAM-1 follow-up — seed 3 monkey_parameters rows added
-- to code after migration 047 shipped.
--
-- Discovered when MONKEY_PARAM_REGISTRY_DB=true was flipped on ml-worker
-- (2026-05-17): the registry loaded successfully but warned about three
-- parameter names that the Python code references with hardcoded defaults
-- but that 047 didn't seed:
--
--   ocean.phi_damping_lower         default 0.85
--   ocean.phi_mushroom_floor        default 0.70
--   executive.lane.swing.budget_frac default 0.50
--
-- The warnings emit once per name, so they're not noise — but they signal
-- that operator tuning via propose_change() for these names is a no-op
-- (the row doesn't exist; the missing-row warning fires; the default is
-- used; nothing in the DB ever changes the effective value).
--
-- Per the registry contract in parameters.py: when a parameter exists in
-- the DB, propose_change() round-trips through monkey_parameter_changes
-- with full audit. When it doesn't, the default is used silently. This
-- migration brings these three names into the registry surface area.

INSERT INTO monkey_parameters
    (name, category, value, bounds_low, bounds_high, justification, version)
VALUES
    (
        'ocean.phi_damping_lower',
        'SAFETY_BOUND',
        0.85,
        0.5,
        0.95,
        'DAMPING intervention floor — when Φ falls below this and isn''t '
        'in ESCAPE/MUSHROOM territory, Ocean applies damping to the '
        'executive output. Tighter than phi_dream_bound (0.5) since '
        'damping is the lightest intervention. Bounded conservatively.',
        1
    ),
    (
        'ocean.phi_mushroom_floor',
        'SAFETY_BOUND',
        0.70,
        0.4,
        0.85,
        'MUSHROOM intervention trigger — when Φ falls below phi_damping_lower '
        'but stays above this floor, the system enters MUSHROOM (gentle '
        'collapse to subset of agents). Above this = damping is enough. '
        'Below this = ESCAPE or SLEEP needed.',
        1
    ),
    (
        'executive.lane.swing.budget_frac',
        'OPERATIONAL',
        0.50,
        0.10,
        0.80,
        'Fraction of total per-symbol margin budget allocated to the swing '
        'lane (5m timeframe). Remainder split across other lanes (scalp + '
        'trend). 0.50 = swing gets half. Bounded so swing can''t starve or '
        'dominate the other lanes.',
        1
    )
ON CONFLICT (name) DO NOTHING;
