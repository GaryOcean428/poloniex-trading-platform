"""test_anti_costume_repo_wide.py — anti-knob-in-costume gates (#1007)

#1007 requires a lint/test gate that fails when ``_registry.get("key",
default=N)`` appears unless one of these holds:

  1. The key is seeded in a migration with category + justification.
  2. The key has a documented lived-telemetry population path.
  3. The default is a cold-start frozen/canonical sentinel.
  4. The value is an explicit safety bound.

Implementation:

  * **Banned-key list** — the exact reward-transform parameter names
    #1007 P0-B retired. These must NEVER reappear in any monkey_kernel
    source file. Catches the failure mode where a knob is moved between
    modules to evade the autonomic-specific test.

  * **Snapshot-based file budget** — every monkey_kernel module that
    currently uses ``_registry.get(`` gets a recorded call count. New
    callers added to a file (or to a previously-clean file) push the
    count above its snapshot and fail the test. This is the lint gate
    #1007 prescribes: "add a test/lint gate that fails on
    ``_registry.get(..., default=N)``" — implemented as a budget so the
    test ships without first refactoring the existing 80+ legitimate
    sites in executive.py / ocean.py / etc.

    To add a NEW legitimate registry-backed parameter (e.g. one seeded
    by a migration with full provenance), bump the snapshot in the same
    PR that adds the call site, with a one-line justification in the
    commit message.

  * **Reward-transform exemption assertion** — re-pins the autonomic.py
    constants from #1007 P0-B as honest module-level values.

Citations: poloniex-trading-platform#1006 + #1007 + 2.31A P5/P25 +
QIG PURITY MANDATE + Embodiment_Waves (2026-05-28 Polo CSV) +
LIVED ONLY 5 + never-stop.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

_MONKEY_KERNEL_DIR = Path(__file__).parents[2] / "src" / "monkey_kernel"
_REPO_ROOT = Path(__file__).parents[3]
_HOLD_BIAS_LITERAL_RE = re.compile(
    r"[A-Za-z_]*HOLD_BIAS[A-Za-z_]*\s*[:=]\s*(?!1(?:\.0+)?(?:\s|$))[0-9.]+",
    re.I,
)

# #1007 P0-B: these parameter keys describe knobs-in-costume that should
# never reappear ANYWHERE in monkey_kernel sources. They were retired to
# honest module constants in autonomic.py:145-149.
_BANNED_REGISTRY_KEYS = (
    "autonomic.reward_half_life_ms",
    "autonomic.pnl_frac_history_max",
    "autonomic.reward_dop_scale",
    "autonomic.reward_ser_scale",
    "autonomic.reward_loss_dop_scale",
    "autonomic.serotonin_compression",
)

# Snapshot of legitimate (or pre-existing) ``_registry.get(`` call sites
# per path relative to _MONKEY_KERNEL_DIR. Most are observer-derived
# primitives (heart rhythm modulation, ocean-sleep quantile thresholds,
# candle-pattern ratios) seeded with documented defaults. The test BUDGETs
# each file at its current count so adding a new costume to a previously-clean
# file is blocked.
#
# Bump deliberately in the same PR that adds a new call site, with a
# one-line justification.
_REGISTRY_GET_BUDGET = {
    "autonomic.py": 0,           # #1007 P0-B retired all costumes
    "basin_sync.py": 2,
    "candle_patterns.py": 12,
    "executive.py": 19,
    "ocean.py": 16,
    "ocean_sleep_trigger.py": 5,
    "regime.py": 2,
    "self_observation.py": 2,
    "tick.py": 16,  # #1039 inline ring-buffer cap; #711/#766 compositional rollout gate (shadow/live)
    "working_memory.py": 12,
}


def _all_kernel_sources() -> list[Path]:
    return sorted(
        p for p in _MONKEY_KERNEL_DIR.rglob("*.py")
        if "__pycache__" not in p.parts
    )


def _all_repo_code_sources() -> list[Path]:
    ignored_parts = {
        ".git",
        ".yarn",
        "node_modules",
        "dist",
        "__pycache__",
        ".pytest_cache",
        "__tests__",
        "tests",
        ".venv",
        "venv",
        ".venv_test",
    }
    return sorted(
        p for p in _REPO_ROOT.rglob("*")
        if p.suffix in {".py", ".ts"}
        and not any(part in ignored_parts for part in p.parts)
        and not p.name.endswith(".d.ts")
    )


def _strip_line_comments(src: str) -> str:
    return re.sub(r"//[^\n]*|#[^\n]*", "", src)


def test_banned_reward_transform_keys_absent_repo_wide():
    """#1007 P0-B: the retired reward-transform parameter names must never
    appear in any monkey_kernel source. A reintroduction anywhere within
    that package — even in a comment-only sense in a different module —
    must fail the suite so a careless refactor can't smuggle the knob back."""
    offenders: list[tuple[str, str]] = []
    for src in _all_kernel_sources():
        text = src.read_text(encoding="utf-8")
        for key in _BANNED_REGISTRY_KEYS:
            if key in text:
                offenders.append((str(src.relative_to(_MONKEY_KERNEL_DIR)), key))
    assert not offenders, (
        "Banned reward-transform registry keys reappeared (#1007 P0-B): "
        f"{offenders}"
    )


def test_registry_get_call_count_within_budget():
    """#1007 P0-C: snapshot-based budget on ``_registry.get(`` calls per
    file. A new costume in a previously-clean file lifts the count above
    its budget and fails the test. Bump the budget in the same PR with a
    one-line justification only after verifying the new caller has a
    real lived-telemetry population path or is an explicit safety bound.
    """
    pattern = re.compile(r"_registry\.get\s*\(")
    overages: list[tuple[str, int, int]] = []
    untracked: list[tuple[str, int]] = []
    for src in _all_kernel_sources():
        rel_path = str(src.relative_to(_MONKEY_KERNEL_DIR))
        if rel_path == "__init__.py":
            continue
        text = src.read_text(encoding="utf-8")
        count = len(pattern.findall(text))
        budget = _REGISTRY_GET_BUDGET.get(rel_path)
        if budget is None:
            if count > 0:
                untracked.append((rel_path, count))
            continue
        if count > budget:
            overages.append((rel_path, count, budget))
    assert not overages, (
        "_registry.get( count exceeded budget — new knob-in-costume? "
        "Bump the budget in _REGISTRY_GET_BUDGET only with a real "
        f"lived-population path or safety justification. {overages}"
    )
    assert not untracked, (
        "Previously-clean monkey_kernel file gained _registry.get( calls "
        "without a budget entry. Add the file to _REGISTRY_GET_BUDGET "
        f"with the count and a justification. {untracked}"
    )


@pytest.mark.parametrize("constant_name", [
    "REWARD_HALF_LIFE_MS",
    "PNL_FRAC_HISTORY_MAX",
    "REWARD_DOP_SCALE",
    "REWARD_SER_SCALE",
    "REWARD_LOSS_DOP_SCALE",
    "SEROTONIN_BASELINE_COMPRESSION",
])
def test_autonomic_reward_constants_are_module_level(constant_name: str):
    """#1007 P0-B confirms the autonomic.py constants exist as honest
    module-level values, not wrapped in registry-get costume."""
    text = (_MONKEY_KERNEL_DIR / "autonomic.py").read_text(encoding="utf-8")
    pattern = re.compile(
        rf"^{constant_name}\s*[:=]", re.MULTILINE
    )
    assert pattern.search(text), (
        f"{constant_name} must be a module-level constant in autonomic.py "
        "(#1007 P0-B)."
    )


def test_qig_warp_forbidden_literal_patterns_absent_repo_wide():
    """#1003/#1008 anti-shelfware extension: catch hidden expectation/reward
    constants outside the explicit #1007 autonomic allowlist, including TS
    sources and non-monkey Python modules."""
    forbidden = [
        (
            "HOLD_BIAS raw non-neutral literal",
            _HOLD_BIAS_LITERAL_RE,
        ),
        (
            "REWARD *_SCALE raw literal",
            re.compile(r"[A-Za-z_]*REWARD[A-Za-z_]*_SCALE[A-Za-z_]*\s*[:=]\s*[0-9.]+", re.I),
        ),
        (
            "handled suppress_hold without emitted-action alignment",
            re.compile(r"expectation_action\s*==\s*[\"']suppress_hold[\"']"),
        ),
    ]
    reward_scale_allowlist = {
        ("ml-worker/src/monkey_kernel/autonomic.py", "REWARD_DOP_SCALE: float = 1.5"),
        ("ml-worker/src/monkey_kernel/autonomic.py", "REWARD_SER_SCALE: float = 0.15"),
        ("ml-worker/src/monkey_kernel/autonomic.py", "REWARD_LOSS_DOP_SCALE: float = 0.5"),
    }
    offenders: list[tuple[str, int, str, str]] = []
    for src in _all_repo_code_sources():
        rel_path = str(src.relative_to(_REPO_ROOT))
        text = _strip_line_comments(src.read_text(encoding="utf-8"))
        for line_no, line in enumerate(text.splitlines(), start=1):
            for name, pattern in forbidden:
                if not pattern.search(line):
                    continue
                stripped = line.strip()
                if name == "REWARD *_SCALE raw literal" and (rel_path, stripped) in reward_scale_allowlist:
                    continue
                offenders.append((rel_path, line_no, name, stripped))
    assert not offenders, (
        "Forbidden qig-warp expectation literal/action patterns reappeared: "
        f"{offenders}"
    )


def test_qig_warp_forbidden_literal_regex_positive_controls():
    reward_scale = re.compile(
        r"[A-Za-z_]*REWARD[A-Za-z_]*_SCALE[A-Za-z_]*\s*[:=]\s*[0-9.]+",
        re.I,
    )
    suppress_hold = re.compile(r"expectation_action\s*==\s*[\"']suppress_hold[\"']")
    assert _HOLD_BIAS_LITERAL_RE.search("expectation_hold_bias = 0.85")
    assert _HOLD_BIAS_LITERAL_RE.search("expectation_hold_bias = 1.00001")
    assert _HOLD_BIAS_LITERAL_RE.search("expectation_hold_bias = 10.0")
    assert not _HOLD_BIAS_LITERAL_RE.search("expectation_hold_bias = 1.0")
    assert reward_scale.search("const SHADOW_REWARD_GAIN_SCALE = 0.4")
    assert suppress_hold.search('expectation_action == "suppress_hold"')
