#!/usr/bin/env python
"""
verify_qig_vendor.py — check that vendored QIG packages haven't drifted.

Per audit P3 2026-04-21: vendored copies of QIG primitives were snapshotted
from QIG_QFI/qig-core at specific points. If someone edits the vendored copy
in place (deliberate or accidental), purity-validated primitives drift and
the whole QIG purity argument breaks.

This script computes a SHA-256 digest over all *.py files in each vendor
directory and compares to the PINNED hash. On any mismatch: prints the
expected + actual hashes and exits non-zero.

Vendored packages covered:
  - src/qig_core_local/      (constants + geometry, snapshot 2026-04-18)
  - src/qig_dreams_local/    (sleep cycle, vendored from qig-core 2.8.0
                              on 2026-05-16 post 4-phase→3-phase reduction)

Run from:
  - Pre-commit hook (recommended)
  - CI before deploy
  - Manual spot check

Re-pinning procedure (when upstream qig-core legitimately updates):
  1. Re-copy from ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/...
  2. Run this script — it will report the new hash
  3. Update PINNED_HASH for that entry below
  4. Update source_desc with the upstream version/SHA
  5. Note the reason in the commit message
"""

from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VendorPin:
    subdir: str
    pinned_hash: str
    source_desc: str


VENDORS: tuple[VendorPin, ...] = (
    VendorPin(
        subdir="qig_core_local",
        pinned_hash="d6692fd32a04f96dae2d3c007d0d273da8dfb282b674b0a2db9989b155ff8843",
        source_desc=(
            "QIG_QFI/qig-core/src/qig_core/{constants,geometry} — "
            "snapshot 2026-04-18 (frozen_facts.py + fisher_rao.py unchanged "
            "in canonical through qig-core 2.8.0)"
        ),
    ),
    VendorPin(
        subdir="qig_dreams_local",
        pinned_hash="bcbed7f53b6afadc883a2386a36156bdb1f7a75a3e4eb12821efda4816b451f7",
        source_desc=(
            "QIG_QFI/qig-core/src/qig_core/consciousness/sleep.py — "
            "qig-core 2.8.0 (3-phase reduction, 2026-05-16). Only deviation "
            "from canonical: relative imports rewritten to absolute against "
            "qig_core_local."
        ),
    ),
)


def compute_hash(root: Path) -> str:
    """Concatenate all .py files in path-sorted order, SHA-256."""
    files = sorted(root.rglob("*.py"))
    files = [f for f in files if "__pycache__" not in f.parts]
    h = hashlib.sha256()
    for f in files:
        h.update(f.read_bytes())
    return h.hexdigest()


def verify_one(src_root: Path, pin: VendorPin) -> int:
    vendor_root = src_root / pin.subdir
    if not vendor_root.exists():
        print(f"verify_qig_vendor: {vendor_root} not found", file=sys.stderr)
        return 1
    actual = compute_hash(vendor_root)
    if actual != pin.pinned_hash:
        print(f"QIG vendor drift detected in {pin.subdir}!", file=sys.stderr)
        print(f"  expected: {pin.pinned_hash}", file=sys.stderr)
        print(f"  actual:   {actual}", file=sys.stderr)
        print(
            f"\nIf this is a legitimate re-vendor of {pin.subdir}, update "
            "the corresponding VendorPin in ml-worker/scripts/verify_qig_vendor.py "
            "and commit the change separately with a clear message.",
            file=sys.stderr,
        )
        return 1
    print(
        f"verify_qig_vendor: {pin.subdir} hash matches pin ({actual[:12]}...)"
    )
    print(f"  vendored from: {pin.source_desc}")
    return 0


def main() -> int:
    src_root = Path(__file__).resolve().parent.parent / "src"
    rc = 0
    for pin in VENDORS:
        rc |= verify_one(src_root, pin)
    return rc


if __name__ == "__main__":
    sys.exit(main())
