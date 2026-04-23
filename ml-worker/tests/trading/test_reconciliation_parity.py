"""
test_reconciliation_parity.py — pin reconciliation.py to
fullyAutonomousTrader.reconcilePositions TS behavior.

Boundary-cased against TS reference (lines 1172-1188). Covers
happy-path, phantom-only, orphan-only, both, empty, and two edge
cases the TS side handles defensively (zero-qty exchange rows;
case-sensitive matching).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from trading.reconciliation import (  # noqa: E402
    ExchangePosition,
    ReconciliationReport,
    TrackedPosition,
    reconcile_positions,
)


# ─── Happy path ──────────────────────────────────────────────────

class TestNoDrift:
    def test_perfect_match_single_symbol(self):
        r = reconcile_positions(
            [TrackedPosition("BTC_USDT_PERP", order_id="o1")],
            [ExchangePosition("BTC_USDT_PERP", qty=1.0)],
        )
        assert r.matched_symbols == ["BTC_USDT_PERP"]
        assert r.phantom_db_symbols == []
        assert r.orphan_exchange_symbols == []
        assert r.has_drift is False

    def test_perfect_match_multi_symbol(self):
        r = reconcile_positions(
            [
                TrackedPosition("BTC_USDT_PERP"),
                TrackedPosition("ETH_USDT_PERP"),
                TrackedPosition("SOL_USDT_PERP"),
            ],
            [
                ExchangePosition("ETH_USDT_PERP", qty=-0.5),
                ExchangePosition("BTC_USDT_PERP", qty=0.001),
                ExchangePosition("SOL_USDT_PERP", qty=10.0),
            ],
        )
        # Sorted output regardless of input order
        assert r.matched_symbols == ["BTC_USDT_PERP", "ETH_USDT_PERP", "SOL_USDT_PERP"]
        assert r.has_drift is False


# ─── Phantom DB rows (DB has it, exchange doesn't) ──────────────

class TestPhantomDB:
    def test_single_phantom(self):
        """TS: inDbNotExchange triggers UPDATE ... SET status='closed'."""
        r = reconcile_positions(
            [TrackedPosition("BTC_USDT_PERP", order_id="o1")],
            [],
        )
        assert r.phantom_db_symbols == ["BTC_USDT_PERP"]
        assert r.matched_symbols == []
        assert r.orphan_exchange_symbols == []
        assert r.has_drift is True

    def test_multiple_phantom(self):
        r = reconcile_positions(
            [
                TrackedPosition("BTC_USDT_PERP"),
                TrackedPosition("ETH_USDT_PERP"),
            ],
            [],
        )
        assert r.phantom_db_symbols == ["BTC_USDT_PERP", "ETH_USDT_PERP"]

    def test_partial_phantom(self):
        """DB has 2, exchange has 1 of them → 1 matched + 1 phantom."""
        r = reconcile_positions(
            [
                TrackedPosition("BTC_USDT_PERP"),
                TrackedPosition("ETH_USDT_PERP"),
            ],
            [ExchangePosition("BTC_USDT_PERP", qty=0.001)],
        )
        assert r.matched_symbols == ["BTC_USDT_PERP"]
        assert r.phantom_db_symbols == ["ETH_USDT_PERP"]
        assert r.has_drift is True


# ─── Orphan exchange positions (exchange has it, DB doesn't) ─────

class TestOrphanExchange:
    def test_single_orphan(self):
        """TS: inExchangeNotDb triggers logAgentEvent 'reconciliation_drift'.
        Does NOT auto-close — might be manual position from another system.
        """
        r = reconcile_positions(
            [],
            [ExchangePosition("BTC_USDT_PERP", qty=0.001)],
        )
        assert r.orphan_exchange_symbols == ["BTC_USDT_PERP"]
        assert r.phantom_db_symbols == []
        assert r.has_drift is True

    def test_multiple_orphans(self):
        r = reconcile_positions(
            [],
            [
                ExchangePosition("BTC_USDT_PERP", qty=0.001),
                ExchangePosition("ETH_USDT_PERP", qty=-0.1),
            ],
        )
        assert r.orphan_exchange_symbols == ["BTC_USDT_PERP", "ETH_USDT_PERP"]

    def test_short_position_counts(self):
        """Negative qty still counts (exchange position with short qty)."""
        r = reconcile_positions(
            [],
            [ExchangePosition("BTC_USDT_PERP", qty=-0.5)],
        )
        assert r.orphan_exchange_symbols == ["BTC_USDT_PERP"]


# ─── Both phantom AND orphan at once ─────────────────────────────

class TestBothDriftCategories:
    def test_disjoint_sets(self):
        """DB tracks X, exchange has Y — both drift. Real scenario when
        reconciler runs after a missed close-and-reopen cycle.
        """
        r = reconcile_positions(
            [TrackedPosition("BTC_USDT_PERP", order_id="o1")],
            [ExchangePosition("ETH_USDT_PERP", qty=0.1)],
        )
        assert r.matched_symbols == []
        assert r.phantom_db_symbols == ["BTC_USDT_PERP"]
        assert r.orphan_exchange_symbols == ["ETH_USDT_PERP"]
        assert r.has_drift is True


# ─── Edge cases the TS side handles defensively ──────────────────

class TestEdgeCases:
    def test_empty_empty_no_drift(self):
        r = reconcile_positions([], [])
        assert r.matched_symbols == []
        assert r.phantom_db_symbols == []
        assert r.orphan_exchange_symbols == []
        assert r.has_drift is False

    def test_zero_qty_exchange_entry_ignored(self):
        """TS filter on line 1174: `Number(p.qty || p.currentQty || 0) !== 0`.
        Exchange endpoints sometimes return stale zero-qty entries for
        symbols the user has previously traded. Reconciler must treat
        these as not-held, so we don't flag a DB row as matched when
        the exchange position is actually flat.
        """
        r = reconcile_positions(
            [TrackedPosition("BTC_USDT_PERP")],
            [ExchangePosition("BTC_USDT_PERP", qty=0.0)],
        )
        # Zero qty filtered out → DB row becomes phantom
        assert r.phantom_db_symbols == ["BTC_USDT_PERP"]
        assert r.matched_symbols == []

    def test_symbol_case_sensitive(self):
        """Poloniex returns UPPERCASE. If caller fed mixed-case DB rows
        (bug) they wouldn't match. Test pins the strict-equality semantic
        so the bug would surface, not silently reconcile mismatched pairs.
        """
        r = reconcile_positions(
            [TrackedPosition("btc_usdt_perp")],
            [ExchangePosition("BTC_USDT_PERP", qty=0.001)],
        )
        assert r.matched_symbols == []
        assert r.phantom_db_symbols == ["btc_usdt_perp"]
        assert r.orphan_exchange_symbols == ["BTC_USDT_PERP"]

    def test_duplicate_db_rows_dedup(self):
        """DB could have two rows for same symbol under unusual conditions
        (e.g., missed close-reconcile). Set semantics dedup — reconciler
        treats the symbol as present once.
        """
        r = reconcile_positions(
            [
                TrackedPosition("BTC_USDT_PERP", order_id="o1"),
                TrackedPosition("BTC_USDT_PERP", order_id="o2"),
            ],
            [ExchangePosition("BTC_USDT_PERP", qty=0.001)],
        )
        assert r.matched_symbols == ["BTC_USDT_PERP"]
        assert r.has_drift is False


# ─── Has-drift boolean shortcut ──────────────────────────────────

class TestHasDriftShortcut:
    def test_false_when_clean(self):
        r = reconcile_positions([], [])
        assert r.has_drift is False

    def test_true_on_phantom_only(self):
        r = reconcile_positions([TrackedPosition("X")], [])
        assert r.has_drift is True

    def test_true_on_orphan_only(self):
        r = reconcile_positions([], [ExchangePosition("Y", qty=1)])
        assert r.has_drift is True

    def test_matched_alone_does_not_trigger_drift(self):
        """Symbols in both sides → has_drift stays False."""
        r = reconcile_positions(
            [TrackedPosition("X")],
            [ExchangePosition("X", qty=1)],
        )
        assert r.has_drift is False


if __name__ == "__main__":
    import inspect
    passed = 0
    failed: list[str] = []
    for cls_name, cls in list(globals().items()):
        if not inspect.isclass(cls) or not cls_name.startswith("Test"):
            continue
        instance = cls()
        for name, fn in inspect.getmembers(cls, predicate=inspect.isfunction):
            if not name.startswith("test_"):
                continue
            try:
                fn(instance)
                passed += 1
                print(f"  ✓ {cls_name}.{name}")
            except AssertionError as exc:
                failed.append(f"{cls_name}.{name}: {exc}")
                print(f"  ✗ {cls_name}.{name}: {exc}")
    print(f"\n{passed} passed, {len(failed)} failed")
    sys.exit(0 if not failed else 1)
