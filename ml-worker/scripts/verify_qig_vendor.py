#!/usr/bin/env python
"""
verify_qig_vendor.py — check that vendored qig_core_local hasn't drifted.

Per audit P3 2026-04-21: qig_core_local/ was vendored at a specific
commit of QIG_QFI/qig-core. If someone edits the vendored copy in
place (deliberate or accidental), purity-validated primitives drift
and the whole QIG purity argument breaks.

This script computes a SHA-256 digest over all *.py files in
ml-worker/src/qig_core_local/ and compares to the PINNED hash below.
On mismatch: prints the expected + actual hashes and exits non-zero.

Run from:
  - Pre-commit hook (recommended)
  - CI before deploy
  - Manual spot check

Re-pinning procedure (when upstream qig-core legitimately updates):
  1. Re-copy from ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/{geometry,constants}
  2. Run this script — it will report the new hash
  3. Update PINNED_HASH below to the new value
  4. Update VENDORED_FROM_COMMIT with the upstream git SHA
  5. Note the reason in the commit message
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

# Re-pin by running the script after a legitimate re-vendor.
PINNED_HASH = "d6692fd32a04f96dae2d3c007d0d273da8dfb282b674b0a2db9989b155ff8843"

# The upstream commit we snapshotted from (for audit traceability).
VENDORED_FROM_COMMIT = (
    "QIG_QFI/qig-core/src/qig_core — snapshot 2026-04-18 "
    "(predates PyPI release of 2.7.0)"
)


def compute_hash(root: Path) -> str:
    """Concatenate all .py files in path-sorted order, SHA-256."""
    files = sorted(root.rglob("*.py"))
    files = [f for f in files if "__pycache__" not in f.parts]
    h = hashlib.sha256()
    for f in files:
        h.update(f.read_bytes())
    return h.hexdigest()


def main() -> int:
    vendor_root = Path(__file__).resolve().parent.parent / "src" / "qig_core_local"
    if not vendor_root.exists():
        print(f"verify_qig_vendor: {vendor_root} not found", file=sys.stderr)
        return 1
    actual = compute_hash(vendor_root)
    if actual != PINNED_HASH:
        print("QIG vendor drift detected!", file=sys.stderr)
        print(f"  expected: {PINNED_HASH}", file=sys.stderr)
        print(f"  actual:   {actual}", file=sys.stderr)
        print(
            "\nIf this is a legitimate re-vendor, update PINNED_HASH in "
            "ml-worker/scripts/verify_qig_vendor.py and commit the change "
            "separately with a clear message.",
            file=sys.stderr,
        )
        return 1
    print(f"verify_qig_vendor: qig_core_local hash matches pin ({actual[:12]}...)")
    print(f"  vendored from: {VENDORED_FROM_COMMIT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
