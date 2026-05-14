"""test_parameters_psycopg_isolation.py — registry psycopg thread isolation.

2026-05-14 production incident: ml-worker crashed with
``Fatal Python error: Aborted`` / ``Segmentation fault`` every time
``/monkey/tick/run`` was invoked. The crash chain was:

    monkey_tick_run (async, uvloop event-loop thread)
      → _get_ocean() → Ocean.__init__
        → parameters.get() → ParameterRegistry._load()
          → psycopg.connect()  ← sync connect ON the event-loop thread
            → SEGFAULT (psycopg3 sync wait_conn + uvloop + heavy native
              extensions: TensorFlow / scipy / sklearn / h5py)

A native crash is NOT catchable by the try/except in _load() — the
process dies.

Fix: _load() submits the actual psycopg connect+query
(_query_parameters_table) to a dedicated single-worker
ThreadPoolExecutor (_DB_EXECUTOR). The native connect therefore always
runs on a ``param-registry-db`` thread, never the caller's thread —
the supported way to use sync psycopg from async code.

These tests lock:
  1. The psycopg work runs on a _DB_EXECUTOR thread, not the caller.
  2. _load() stays fail-soft (DB error → defaults, no raise).
  3. _load() stays fail-soft on executor timeout.
  4. No-DSN path is unchanged (defaults only, no DB attempt).
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel import parameters as params_mod  # noqa: E402
from monkey_kernel.parameters import (  # noqa: E402
    ParameterRegistry,
    VariableCategory,
)


@pytest.fixture
def db_gate_on(monkeypatch: pytest.MonkeyPatch) -> None:
    """Enable the live DB-load path. _load() is GATED OFF by default
    (MONKEY_PARAM_REGISTRY_DB != 'true' → defaults-only) because
    psycopg's binary wheel segfaults the ml-worker process during
    connect. The DB-path tests below opt in via this fixture so they
    actually reach _query_parameters_table / the executor."""
    monkeypatch.setenv("MONKEY_PARAM_REGISTRY_DB", "true")


def test_db_load_gated_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """The load-bearing safety property: with MONKEY_PARAM_REGISTRY_DB
    unset, _load() must NOT touch psycopg at all — it short-circuits to
    defaults-only. This is what keeps ml-worker from segfaulting: no
    psycopg.connect() call = no native crash."""
    monkeypatch.delenv("MONKEY_PARAM_REGISTRY_DB", raising=False)
    reg = ParameterRegistry(dsn="postgresql://stub/notused")
    called = {"n": 0}

    def must_not_run() -> dict:
        called["n"] += 1
        return {}

    reg._query_parameters_table = must_not_run  # type: ignore[method-assign]
    reg._load()

    assert called["n"] == 0, (
        "_query_parameters_table ran despite the DB gate being OFF — "
        "this re-opens the segfault path"
    )
    assert reg._loaded is True
    # get() still works — defaults-only fail-soft mode.
    assert reg.get("physics.kappa_star", default=64.0) == 64.0


def test_query_appends_sslmode_disable() -> None:
    """_query_parameters_table appends sslmode=disable when the DSN
    doesn't pin it — the Railway internal network is private (SSL adds
    nothing) and psycopg[binary]'s bundled openssl is the crash path."""
    seen: dict[str, str] = {}
    reg = ParameterRegistry(dsn="postgresql://u:p@postgres.railway.internal:5432/railway")

    class _FakeConn:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def cursor(self):
            class _Cur:
                def __enter__(self_): return self_
                def __exit__(self_, *a): return False
                def execute(self_, *a): pass
                def fetchall(self_): return []
            return _Cur()

    import monkey_kernel.parameters as pm

    class _FakePsycopg:
        @staticmethod
        def connect(dsn: str):
            seen["dsn"] = dsn
            return _FakeConn()

    # _query_parameters_table does `import psycopg` locally; patch sys.modules.
    sys.modules["psycopg"] = _FakePsycopg  # type: ignore[assignment]
    try:
        reg._query_parameters_table()
    finally:
        del sys.modules["psycopg"]

    assert "sslmode=disable" in seen["dsn"], seen["dsn"]
    # already had a query-string, so the separator must be '&'
    reg2 = ParameterRegistry(dsn="postgresql://h/db?connect_timeout=5")
    sys.modules["psycopg"] = _FakePsycopg  # type: ignore[assignment]
    try:
        reg2._query_parameters_table()
    finally:
        del sys.modules["psycopg"]
    assert "?connect_timeout=5&sslmode=disable" in seen["dsn"], seen["dsn"]


def test_query_runs_on_db_executor_thread_not_caller(db_gate_on: None) -> None:
    """The psycopg connect+query must execute on a _DB_EXECUTOR worker
    thread — never the thread that called _load(). This is the
    load-bearing property: on the real server _load() is reached from
    the uvloop event-loop thread, and sync psycopg there segfaults."""
    caller_thread = threading.current_thread().name
    seen: dict[str, str] = {}

    reg = ParameterRegistry(dsn="postgresql://stub/notused")

    def fake_query() -> dict:
        seen["thread"] = threading.current_thread().name
        return {}

    reg._query_parameters_table = fake_query  # type: ignore[method-assign]
    reg._load()

    assert "thread" in seen, "_query_parameters_table was never invoked"
    assert seen["thread"] != caller_thread, (
        f"psycopg work ran on the CALLER thread ({caller_thread}) — "
        "this is the segfault path"
    )
    assert seen["thread"].startswith("param-registry-db"), (
        f"expected a _DB_EXECUTOR thread, got {seen['thread']!r}"
    )
    assert reg._loaded is True


def test_load_is_failsoft_on_db_error(db_gate_on: None) -> None:
    """A DB/connect failure inside the executor must NOT propagate —
    _load() catches it, marks _loaded so it stops retrying, and the
    registry serves hardcoded defaults via get()."""
    reg = ParameterRegistry(dsn="postgresql://stub/notused")

    def boom() -> dict:
        raise ConnectionError("simulated DB unreachable")

    reg._query_parameters_table = boom  # type: ignore[method-assign]
    reg._load()  # must not raise

    assert reg._loaded is True
    # get() with a default still works — fail-soft to the default.
    assert reg.get("physics.kappa_star", default=64.0) == 64.0


def test_load_is_failsoft_on_executor_timeout(
    db_gate_on: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the connect hangs past _LOAD_TIMEOUT_S, _load() catches the
    TimeoutError and stays up serving defaults — a wedged connect must
    not wedge the kernel. The module-level timeout is monkeypatched to
    a small value so the test is fast; the production default (15 s)
    behaves identically, just slower."""
    monkeypatch.setattr(params_mod, "_LOAD_TIMEOUT_S", 0.5)
    reg = ParameterRegistry(dsn="postgresql://stub/notused")

    # Interruptible "hang": waits on an Event the test releases at the
    # end, so the shared single-worker _DB_EXECUTOR isn't left occupied
    # for subsequent tests.
    release = threading.Event()

    def hang() -> dict:
        release.wait(timeout=5.0)  # past the patched 0.5 s _load timeout
        return {}

    reg._query_parameters_table = hang  # type: ignore[method-assign]
    started = time.monotonic()
    try:
        reg._load()  # must not raise, must not block past the timeout
        elapsed = time.monotonic() - started

        assert reg._loaded is True
        assert elapsed < 2.0, (
            f"_load blocked {elapsed:.1f}s — should bail at ~0.5 s"
        )
        assert reg.get("loop.history_max", default=100.0) == 100.0
    finally:
        release.set()  # free the executor worker


def test_no_dsn_path_unchanged() -> None:
    """With no DATABASE_URL, _load() short-circuits before ever touching
    the executor — defaults-only, no DB attempt."""
    reg = ParameterRegistry(dsn=None)
    called = {"n": 0}

    def should_not_run() -> dict:
        called["n"] += 1
        return {}

    reg._query_parameters_table = should_not_run  # type: ignore[method-assign]
    reg._load()

    assert called["n"] == 0, "_query_parameters_table ran despite no DSN"
    assert reg._loaded is True
    assert reg.get("executive.green_turn_reversal.min_roi", default=0.003) == 0.003


def test_successful_load_populates_cache(db_gate_on: None) -> None:
    """Happy path: the executor returns a parameter map and _load()
    installs it as the cache; get() then returns the loaded value, not
    the default."""
    reg = ParameterRegistry(dsn="postgresql://stub/notused")

    from monkey_kernel.parameters import ParamValue

    def good_query() -> dict:
        return {
            "physics.kappa_star": ParamValue(
                name="physics.kappa_star",
                category=VariableCategory.SAFETY_BOUND
                if hasattr(VariableCategory, "SAFETY_BOUND")
                else list(VariableCategory)[0],
                value=63.83,
                bounds_low=None,
                bounds_high=None,
                justification="measured",
                version=1,
            ),
        }

    reg._query_parameters_table = good_query  # type: ignore[method-assign]
    reg._load()

    assert reg._loaded is True
    # loaded value wins over the passed default
    assert reg.get("physics.kappa_star", default=64.0) == 63.83
