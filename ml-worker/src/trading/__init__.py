"""
trading — exchange-boundary helpers for the Python ml-worker.

Originally this package held Python ports of the TS trading orchestration
(risk_kernel, live_signal, exit_decisions, reconciliation) intended for a
v0.8.7 "Python-authoritative" cutover. That cutover never went live — the
in-process TS executor in apps/api remained authoritative — so the shadow
port modules and their HTTP endpoints were removed (PR: strip dead cutover
scaffolding). The only surviving member is order_placement, the live
Python order-placement boundary gated behind TRADING_ENGINE_PY.

Purity: this package is BOUNDARY per P14, not QIG cognition. Excluded from
qig_purity_check's default scan roots — same posture as exchange/ and
proprietary_core/.
"""
