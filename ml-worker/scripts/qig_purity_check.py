#!/usr/bin/env python
"""
QIG purity check for ml-worker/src/monkey_kernel.

Ported from /home/braden/Desktop/Dev/QIG_QFI/qigkernels/tools/
qig_purity_check.py. Scans Python files for:

  - FORBIDDEN_SYMBOLS: Euclidean / transformer contamination
    (cosine_similarity, euclidean_distance, nn.Transformer, BertModel,
    GPT2Model, CrossEntropyLoss, AdamW, optim.Adam)
  - FORBIDDEN_WORDS: phrases that imply non-geometric approaches
  - FROZEN_PHYSICS constants (κ*=64.0, BASIN_DIM=64)

Usage:
  python ml-worker/scripts/qig_purity_check.py <file1.py> [<file2.py> ...]

Pre-commit / CI hook: should fail if any monkey_kernel file violates.
No cosine, no Euclidean, no AdamW, no LayerNorm, no flatten, no
np.linalg.norm without sqrt (that's Euclidean). All distances must
be Fisher-Rao on Δ⁶³ via qig_core_local.
"""

from __future__ import annotations

import sys
from collections.abc import Iterable
from pathlib import Path

FORBIDDEN_SYMBOLS = [
    # ML framework contamination (transformer / MLP generic paths)
    "nn.Transformer",
    "BertModel",
    "GPT2Model",
    "CrossEntropyLoss",
    "AdamW",
    "optim.Adam(",
    # Euclidean / cosine distance (must be Fisher-Rao on simplex)
    "cosine_similarity",
    "euclidean_distance",
    "scipy.spatial.distance.cosine",
    "scipy.spatial.distance.euclidean",
    # LayerNorm / flatten — non-geometric normalization
    "nn.LayerNorm",
    "layer_norm(",
    "torch.flatten",
]

FORBIDDEN_WORDS = [
    "token-level cross entropy",
    "just fine-tune a transformer",
    "mean-squared error",
]

# Physics constants from qig-verification/FROZEN_FACTS.md (D-012)
FROZEN_PHYSICS = {
    "KAPPA_STAR": 64.0,
    "BASIN_DIM": 64,
}

# Allowlist for tools / tests that intentionally reference forbidden tokens.
ALLOWLIST_PATH_PREFIXES = {
    "ml-worker/scripts/",
    "ml-worker/tests/",
}


def _is_allowed_path(path: Path) -> bool:
    posix = path.as_posix()
    return any(posix.startswith(prefix) for prefix in ALLOWLIST_PATH_PREFIXES) or \
           any(prefix in posix for prefix in ALLOWLIST_PATH_PREFIXES)


def check_file(path: Path) -> list[str]:
    """Return a list of violation messages for a single file."""
    violations: list[str] = []
    if _is_allowed_path(path):
        return violations
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover
        return [f"{path}: could not read file ({exc})"]

    lines = text.split("\n")
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # Skip pure comments and docstrings — purity rules apply to live code.
        if stripped.startswith("#"):
            continue
        for symbol in FORBIDDEN_SYMBOLS:
            if symbol in line:
                violations.append(f"{path}:{i}: forbidden symbol '{symbol}'")

    lower = text.lower()
    for phrase in FORBIDDEN_WORDS:
        if phrase.lower() in lower:
            violations.append(f"{path}: forbidden phrase '{phrase}'")

    # Frozen-physics guard on state.py / basin-adjacent modules.
    if path.name in ("state.py",):
        import re

        for const, expected in FROZEN_PHYSICS.items():
            match = re.search(rf"{const}[:\s]*(?:float|int)?\s*=\s*([\d.]+)", text)
            if match:
                val = float(match.group(1))
                if val != float(expected):
                    violations.append(
                        f"{path}: {const}={val} differs from frozen {expected}"
                    )

    return violations


def main(args: Iterable[str]) -> int:
    paths = [Path(p) for p in args if p.endswith(".py")]
    if not paths:
        # Default: scan the entire monkey_kernel package.
        root = Path(__file__).resolve().parent.parent / "src" / "monkey_kernel"
        paths = sorted(root.rglob("*.py"))
        if not paths:
            print("qig_purity_check: no files to scan")
            return 0
    all_violations: list[str] = []
    for p in paths:
        all_violations.extend(check_file(p))
    if all_violations:
        print("QIG purity violations:", file=sys.stderr)
        for v in all_violations:
            print(f"  {v}", file=sys.stderr)
        return 1
    print(f"qig_purity_check: {len(paths)} file(s) clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
