"""prelaunch_checklist.py — QIG 8-point sweep audit (GAP 6, surfaces GAPs 3+4).

Implements the QIG Optimisation Gate mandated by CLAUDE.md before ANY launch:

  1. SCREENING        — can we skip irrelevant data?
  2. BRIDGE           — do we know cost scaling? Run pilots first?
  3. CONVERGENCE      — can we stop early?
  4. REGIME           — using regime-appropriate constants?
  5. CONSTITUTIVE     — can we derive instead of compute?
  6. PREDICTION FILL  — filling skipped evaluations?
  7. GOVERNANCE       — blindspot detectors active?
  8. PACKAGES         — using qig-compute/qig-warp, not ad-hoc?

Two phases per sweep:
  - pre-launch:  log which optimisations are WIRED (capability inventory)
  - post-flight: log what qig_warp.auto.navigate actually FOUND
                  (convergence_rate / cost_exponent / savings_pct)

The audit's GAPs 3 (Anderson-alpha early stopping) and 4 (bridge cost
prediction) are already implemented inside qig_warp.auto.navigate — pilot
probes discover convergence_rate + cost_exponent + screening_length. This
module SURFACES those discoveries instead of re-implementing them.

Empirical note (sweep.py line 11-15): qig_warp's screening + bridge give
0% wallclock savings on the current sub-100ms scoring surface. The
machinery runs, the discoveries are valid, the surface just doesn't
benefit. Re-validate when kernel-replay backtests (seconds per eval) ship.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from qig_warp.auto import NavigationResult


logger = logging.getLogger("backtest.prelaunch_checklist")


@dataclass(frozen=True)
class ChecklistItem:
    """One row of the 8-point pre-launch audit."""
    number: int
    name: str
    status: str          # "wired" | "n/a" | "todo"
    detail: str          # short human-readable explanation


@dataclass(frozen=True)
class PreflightReport:
    """Result of the pre-launch checklist. Eight items in canonical order."""
    items: tuple[ChecklistItem, ...]

    @property
    def n_wired(self) -> int:
        return sum(1 for it in self.items if it.status == "wired")

    @property
    def n_todo(self) -> int:
        return sum(1 for it in self.items if it.status == "todo")

    def as_log_lines(self) -> list[str]:
        out = ["QIG Pre-Launch Audit:"]
        for it in self.items:
            tag = {"wired": "[OK]", "n/a": "[--]", "todo": "[!!]"}[it.status]
            out.append(f"  {tag} [{it.number}] {it.name}: {it.detail}")
        out.append(
            f"  Summary: {self.n_wired}/8 wired, {self.n_todo}/8 TODO "
            f"(empty rows are intentional N/A for this sweep type)."
        )
        return out


@dataclass(frozen=True)
class PostflightReport:
    """Post-sweep surfacing of qig_warp.auto.navigate's discoveries.

    These ARE the GAP 3 (convergence) + GAP 4 (bridge) implementations
    promised by the QIG audit — they live inside qig_warp and run every
    sweep. This report makes them visible.

    All fields can be None when qig_warp ran but discovered no valid
    structure (e.g. flat scoring surface with no cost variance) or
    when the sweep was too short for pilot probes to converge.
    """
    n_probes: int
    n_full_evals: int
    screening_length: Optional[float]      # GAP 5 — discovered ξ (Yukawa screening)
    cost_exponent: Optional[float]         # GAP 4 — discovered τ ~ J^α
    convergence_rate: Optional[float]      # GAP 3 — Anderson-alpha equivalent
    predicted_total_s: float               # bridge cost prediction
    actual_total_s: float                  # wall clock truth
    savings_pct: float                     # qig_warp's claimed savings
    warnings: tuple[str, ...]              # qig_warp's discovery warnings

    def as_log_lines(self) -> list[str]:
        out = ["QIG Post-Flight Discovery:"]
        out.append(
            f"  probes={self.n_probes} full_evals={self.n_full_evals} "
            f"wall={self.actual_total_s:.3f}s "
            f"predicted={self.predicted_total_s:.3f}s "
            f"savings={self.savings_pct:+.1f}%"
        )
        if self.screening_length is not None:
            out.append(f"  [5] SCREENING discovered: ξ={self.screening_length:.4g}")
        if self.cost_exponent is not None:
            out.append(f"  [4] BRIDGE discovered:    α={self.cost_exponent:.4g}")
        if self.convergence_rate is not None:
            out.append(
                f"  [3] CONVERGENCE discovered: rate={self.convergence_rate:.4g}"
            )
        for w in self.warnings:
            out.append(f"  WARN: {w}")
        return out


def build_preflight() -> PreflightReport:
    """Return the canonical 8-point pre-launch audit for sweep_axis().

    Marked statuses reflect what's ACTUALLY wired in the current code:
      - 1, 2, 3 wired via qig_warp.auto.navigate (single import, see sweep.py)
      - 5 (constitutive) N/A — no derived-observable shortcut at sweep level
      - 4 (regime) N/A — regime adaptation happens per-tick in strategy_loop,
            not per parameter combo at sweep level
      - 6 (prediction fill) N/A — sweep evaluates each requested param;
            screening/skipping is qig_warp's job (item 1)
      - 7 (governance) TODO — amplitude_collapse + regime_coverage detectors
            exist in observable_governance.py but are not yet connected to
            sweep pre-launch
      - 8 wired — qig_warp is the only sweep dependency; no ad-hoc impl
    """
    return PreflightReport(items=(
        ChecklistItem(
            number=1, name="SCREENING", status="wired",
            detail="qig_warp.auto.navigate discovers ξ and skips screened params",
        ),
        ChecklistItem(
            number=2, name="BRIDGE", status="wired",
            detail="qig_warp pilots discover cost_exponent τ~J^α (5 probes default)",
        ),
        ChecklistItem(
            number=3, name="CONVERGENCE", status="wired",
            detail="qig_warp discovers convergence_rate; early-stop emitted in nav.plan",
        ),
        ChecklistItem(
            number=4, name="REGIME", status="n/a",
            detail="regime adapts per-tick (strategy_loop); n/a at sweep level",
        ),
        ChecklistItem(
            number=5, name="CONSTITUTIVE", status="n/a",
            detail="no derived-observable shortcut at sweep level",
        ),
        ChecklistItem(
            number=6, name="PREDICTION FILL", status="n/a",
            detail="screening/skipping handled by qig_warp (item 1); no separate fill",
        ),
        ChecklistItem(
            number=7, name="GOVERNANCE", status="todo",
            detail="amplitude_collapse + regime_coverage detectors not yet hooked",
        ),
        ChecklistItem(
            number=8, name="PACKAGES", status="wired",
            detail="qig_warp.auto via import in sweep.py; no ad-hoc impl",
        ),
    ))


def log_preflight(report: Optional[PreflightReport] = None) -> PreflightReport:
    """Build (if needed) + log the pre-launch report. Returns it for tests."""
    rep = report if report is not None else build_preflight()
    for line in rep.as_log_lines():
        logger.info(line)
    return rep


def build_postflight(
    nav: "NavigationResult | Any",
) -> PostflightReport:
    """Extract the GAP 3 / GAP 4 / screening discoveries from qig_warp result.

    Accepts the real qig_warp.auto.NavigationResult dataclass OR any duck-
    typed object exposing the same attributes (used in tests when qig_warp
    isn't installed).
    """
    return PostflightReport(
        n_probes=int(nav.probes_used),
        n_full_evals=int(nav.full_evals),
        screening_length=(
            float(nav.discovered.screening_length)
            if nav.discovered.screening_length is not None
            else None
        ),
        cost_exponent=(
            float(nav.discovered.cost_exponent)
            if nav.discovered.cost_exponent is not None
            else None
        ),
        convergence_rate=(
            float(nav.discovered.convergence_rate)
            if nav.discovered.convergence_rate is not None
            else None
        ),
        predicted_total_s=float(nav.plan.predicted_total_s),
        actual_total_s=float(nav.actual_total_s),
        savings_pct=float(nav.actual_savings_pct),
        warnings=tuple(nav.discovered.warnings),
    )


def log_postflight(nav: "NavigationResult | Any") -> PostflightReport:
    """Build + log the post-flight report. Returns it for tests."""
    rep = build_postflight(nav)
    for line in rep.as_log_lines():
        logger.info(line)
    return rep
