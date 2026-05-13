-- Migration 047: P14 follow-up — Ocean intervention thresholds + refract weight
--
-- Moves six hardcoded constants from module-level literals into the
-- parameter registry for runtime observability + governance audit:
--
--   ocean.spread_bound          ← _SPREAD_BOUND        (ocean.py:87)
--   ocean.phi_dream_bound       ← _PHI_DREAM_BOUND     (ocean.py:88)
--   ocean.phi_escape_bound      ← _PHI_ESCAPE_BOUND    (ocean.py:89)
--   ocean.phi_variance_bound    ← _PHI_VARIANCE_BOUND  (ocean.py:90)
--   ocean.phi_history_max       ← _PHI_HISTORY_MAX     (ocean.py:91)
--   refract.external_weight     ← 0.30 literal         (tick.py:389)
--
-- Per P14: these are SAFETY_BOUND (Ocean) / OPERATIONAL (refract blend)
-- envelopes. P14 permits them as constants; this migration promotes
-- them to registry-backed without changing values, so the kernel
-- behaves identically before/after. Future tuning happens via
-- propose_change() with full audit trail (#669 doctrine §4).

INSERT INTO monkey_parameters
    (name, category, value, bounds_low, bounds_high, justification, version)
VALUES
    (
        'ocean.spread_bound',
        'SAFETY_BOUND',
        0.30,
        0.10,
        0.785,
        'SLEEP trigger threshold for max-pairwise Fisher-Rao distance '
        'across observed cross-lane basins. Above this = divergence/instability, '
        'kernel enters SLEEP. Bounded [0.10, π/2] — π/2 is FR maximum.',
        1
    ),
    (
        'ocean.phi_dream_bound',
        'SAFETY_BOUND',
        0.5,
        0.2,
        0.8,
        'DREAM trigger threshold for Φ (integration measure). Φ below this '
        'and above phi_escape_bound = moderate integration failure → DREAM '
        '(hold tick, skip executive).',
        1
    ),
    (
        'ocean.phi_escape_bound',
        'SAFETY_BOUND',
        0.15,
        0.05,
        0.3,
        'ESCAPE trigger threshold for Φ. Below this = severe integration '
        'failure → force flatten. Strictly lower than phi_dream_bound; '
        'ESCAPE overrides DREAM when both would fire.',
        1
    ),
    (
        'ocean.phi_variance_bound',
        'SAFETY_BOUND',
        0.01,
        0.001,
        0.1,
        'MUSHROOM_MICRO trigger threshold for Φ variance over the rolling '
        'history window. Below this = plateau detected; κ receives a +5 '
        'perturbation to break the stuck state.',
        1
    ),
    (
        'ocean.phi_history_max',
        'OPERATIONAL',
        60.0,
        20.0,
        300.0,
        'Window size (ticks) for Φ variance computation in MUSHROOM_MICRO '
        'detection. At 30s tick cadence, 60 ticks = 30min observation window.',
        1
    ),
    (
        'refract.external_weight',
        'OPERATIONAL',
        0.30,
        0.05,
        0.7,
        'Perception-vs-identity blend weight in refract(). 30% perception, '
        '70% identity — biased toward stable §3.4 Pillar 3 identity basin. '
        'Lower = more conservative (slower regime adaptation); higher = more '
        'reactive (faster but less stable). Tunable via propose_change().',
        1
    )
ON CONFLICT (name) DO NOTHING;
