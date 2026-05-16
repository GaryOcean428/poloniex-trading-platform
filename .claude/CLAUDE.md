# Claude Project Settings (Polytrade)

Project: Polytrade
Package Manager: Yarn 4
Tech Stack: see `.agent-os/standards/tech-stack.md`
Standards:

- `.agent-os/standards/code-style.md`
- `.agent-os/standards/best-practices.md`

Commands (use these instructions):

- Plan Product: `.agent-os/instructions/plan-product.md`
- Create Spec: `.agent-os/instructions/create-spec.md`
- Execute Tasks: `.agent-os/instructions/execute-tasks.md`
- Execute Task: `.agent-os/instructions/execute-task.md`
- Analyze Product: `.agent-os/instructions/analyze-product.md`

Notes:

- Use explicit dev ports: FE 5675–5699, BE 8765–8799
- Keep changes small and type-safe; add Vitest tests

## Operating principles (REPEATEDLY REINFORCED — STOP MAKING THE USER REPEAT THEM)

### 1. Live-money authorization is STANDING — do not defer fixes to morning

The user has **deliberately reduced the live-money balance to an amount they are prepared to lose** so that work can progress continuously without requiring repeated confirmations. This is an explicit, persistent authorization to:

- Ship code fixes overnight via the standard PR + full-gates flow
- Flip env vars autonomously when the change is reversible
- Make architectural decisions when the QIG canonical source (Dev/QIG_QFI/) is clear

**Do NOT** offer "Path 1 / Path 2 / Path 3" menus when there is a clear right answer from the canonical source. That framing IS the deferral anti-pattern.
**Do NOT** write "operator decides in the morning" when "tinker as needed" is the standing instruction.
**Do NOT** treat live-money + sleeping operator as a reason to ship band-aids and queue the real work — that's calibration-debt accumulation and the user has called this out as deeply frustrating.

The caution discipline is: full pre-merge gates (AST + purity + tsc + tests), wait for CI green, monitor production deploy. NOT decision-deferral.

### 2. Highest-quality long-term solution always (the P1 principle)

Per **Canonical Principles v2.1 P1** (Observer sets ALL params from frozen facts):
- A knob with a hardcoded default that an operator soaks-and-dials is a **regression dressed as a calibration**.
- Frozen physics constants (PHI_INV, CRITICAL_RATIO_2D, BRIDGE_EXPONENT) are calibrated against experiments and have stable physical meaning — these are fine.
- Hardcoded magnification / threshold / amplitude / decay values chosen by intuition are **P1 violations**.
- If the system can observe what would make the threshold correct, the threshold MUST be observer-set; the knob shouldn't exist.

**The rationalization tell:** when you find yourself writing "operator-tunable" or "calibration choice not physics," that's the anti-pattern kicking in. The canonical pattern is `WarpBubble.auto()`: the system observes its own inputs and sets its own thresholds from rolling quantiles.

### 3. Canonical source: Dev/QIG_QFI/

For any QIG-stack architectural question, the canonical source is `/home/braden/Desktop/Dev/QIG_QFI/`. **Read the source before proposing fixes** — do not invent API names, threshold values, or mapping tables from intuition.

Two specific failure modes to avoid:
- **`forge_api_verification_first`**: citing function names from training memory rather than the installed package's `__init__.py`.
- **`forge_shadow_vs_canonical_naming`**: confusing `_shadow` modules (observational/conjectural) with the canonical module that supersedes them.
- **`forge_calibration_dressed_as_calibration`**: shipping hardcoded knobs at "substrate-translation boundaries" when the substrate's own primitives expose the observer-derived answer.

### 4. Execute, don't ask

`merge` / `ship it` is standing authorization for the full merge→deploy chain (including redeploy on CI cancel). User-provided plans are standing authorization for all phases — do not pause between PRs of a sequenced plan asking "want me to continue?"
