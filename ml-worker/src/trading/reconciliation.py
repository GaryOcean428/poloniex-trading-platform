"""
reconciliation.py — pure position-reconciliation logic (v0.8.7c-2).

Ports the diff engine from fullyAutonomousTrader.reconcilePositions
(TS lines 1165-1219). The caller reads positions from Poloniex + the
DB (both IO, stay TS-side); this module takes the two snapshots as
input and returns a structured diff.

Three drift categories:

  1. PHANTOM_DB  — DB thinks position is open, exchange doesn't show.
                   Caller marks the DB row closed with
                   exit_reason='reconciliation: position not found on
                   exchange'. Matches TS `inDbNotExchange` branch.

  2. ORPHAN_EXCHANGE — Exchange has a position not tracked in DB.
                       Caller logs a 'reconciliation_drift' agent
                       event and alerts; does NOT auto-close because
                       it may be a manual position from another
                       system. Matches TS `inExchangeNotDb` branch.

  3. MATCHED — Same symbol present in both. (Future extension point
               for qty/side mismatch detection; current TS only
               compares symbol presence, so v0.8.7c-2 mirrors that.)

Purity: BOUNDARY per P14. Pure function: (db_rows, exchange_positions)
→ ReconciliationReport. Excluded from qig_purity_check.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TrackedPosition:
    """One row from the DB's autonomous_trades.status='open' view.
    Only the fields the reconciler needs; caller can carry more
    metadata but this module ignores it.
    """
    symbol: str
    order_id: str = ""  # kept so caller can log which order was phantom-closed


@dataclass(frozen=True)
class ExchangePosition:
    """One position entry returned by Poloniex getPositions.
    qty is signed (positive=long, negative=short). The TS reconciler
    filters zero-qty entries BEFORE passing in; this module trusts
    the caller to have done that, but _also_ defensively ignores
    zero-qty positions below so shadow parity is safe.
    """
    symbol: str
    qty: float = 0.0


@dataclass(frozen=True)
class ReconciliationReport:
    """Structured drift diff. Each symbol appears in exactly one of
    the three lists. Empty lists mean no drift in that category.
    """
    matched_symbols: list[str] = field(default_factory=list)
    phantom_db_symbols: list[str] = field(default_factory=list)
    orphan_exchange_symbols: list[str] = field(default_factory=list)

    @property
    def has_drift(self) -> bool:
        """Convenience for callers that only need to know if ANY drift
        exists. Returns True when at least one phantom or orphan present.
        """
        return bool(self.phantom_db_symbols or self.orphan_exchange_symbols)


def reconcile_positions(
    db_rows: list[TrackedPosition],
    exchange_positions: list[ExchangePosition],
) -> ReconciliationReport:
    """Diff DB against exchange. Pure. Matches TS reconcilePositions
    lines 1172-1188 exactly:

      - Exchange set = symbols with non-zero qty
      - DB set = all tracked symbols passed in (caller already
        filtered by status='open' AND paper_trade=false)
      - Phantom = in DB, not in exchange
      - Orphan = in exchange, not in DB
      - Matched = intersection

    Empty inputs: returns empty report (no drift). Does not mutate
    inputs. Symbol comparison is case-sensitive (TS uses plain string
    equality in Set membership; Poloniex symbols are always uppercase
    on both sides so this never bites in practice).

    Return lists are sorted ascending for deterministic output — the
    TS reference uses Set iteration order which is insertion-order in
    V8. Sorting here gives us stable test comparisons + a nicer audit
    trail; shadow-mode parity compares sets-of-symbols, not order,
    so this is safe.
    """
    exchange_symbols = {
        pos.symbol for pos in exchange_positions if pos.qty != 0
    }
    db_symbols = {row.symbol for row in db_rows}

    matched = sorted(db_symbols & exchange_symbols)
    phantom_db = sorted(db_symbols - exchange_symbols)
    orphan_exchange = sorted(exchange_symbols - db_symbols)

    return ReconciliationReport(
        matched_symbols=matched,
        phantom_db_symbols=phantom_db,
        orphan_exchange_symbols=orphan_exchange,
    )
