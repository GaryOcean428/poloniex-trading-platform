"""Regression checks for SQL migration rerun-safety and startup migration execution path."""

from __future__ import annotations

import re
from pathlib import Path


# Module paths under test
ROOT = Path("/app")
DB_MIGRATIONS_DIR = ROOT / "apps" / "api" / "database" / "migrations"
LEGACY_MIGRATIONS_DIR = ROOT / "apps" / "api" / "migrations"
RUNNER_TS = ROOT / "apps" / "api" / "src" / "scripts" / "runMigrations.ts"
STARTUP_TS = ROOT / "apps" / "api" / "src" / "index.ts"


def _sql_files() -> list[Path]:
    return sorted(list(DB_MIGRATIONS_DIR.glob("*.sql")) + list(LEGACY_MIGRATIONS_DIR.glob("*.sql")))


def _strip_line_comments(text: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in text.splitlines())


def _strip_dollar_quoted_blocks(text: str) -> str:
    """Remove bodies like $$...$$ or $tag$...$tag$ to avoid false positives in function bodies."""
    result: list[str] = []
    i = 0
    while i < len(text):
        if text[i] != "$":
            result.append(text[i])
            i += 1
            continue

        j = i + 1
        while j < len(text) and (text[j].isalnum() or text[j] == "_"):
            j += 1
        if j >= len(text) or text[j] != "$":
            result.append(text[i])
            i += 1
            continue

        tag = text[i : j + 1]
        end = text.find(tag, j + 1)
        if end == -1:
            result.append(text[i])
            i += 1
            continue

        # preserve offsets/line numbers by replacing with spaces
        result.append(" " * (end + len(tag) - i))
        i = end + len(tag)

    return "".join(result)


# Feature: Trigger creation should be rerun-safe via DROP TRIGGER IF EXISTS before CREATE TRIGGER
def test_create_trigger_has_drop_if_exists_before_create() -> None:
    missing_drop: list[str] = []

    for sql_file in _sql_files():
        raw = sql_file.read_text(encoding="utf-8")
        sanitized = _strip_line_comments(raw)

        creates = list(re.finditer(r"\bCREATE\s+TRIGGER\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", sanitized, re.IGNORECASE))
        drops = {
            m.group(1).lower(): m.start()
            for m in re.finditer(
                r"\bDROP\s+TRIGGER\s+IF\s+EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)\b",
                sanitized,
                re.IGNORECASE,
            )
        }

        for match in creates:
            trigger_name = match.group(1)
            create_pos = match.start()
            drop_pos = drops.get(trigger_name.lower(), -1)
            if drop_pos == -1 or drop_pos > create_pos:
                missing_drop.append(f"{sql_file}: CREATE TRIGGER {trigger_name} lacks prior DROP TRIGGER IF EXISTS")

    assert not missing_drop, "\n".join(missing_drop)


# Feature: CREATE INDEX statements must be idempotent (IF NOT EXISTS)
def test_no_unsafe_create_index_without_if_not_exists() -> None:
    offenders: list[str] = []
    create_index_pattern = re.compile(r"^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b", re.IGNORECASE)

    for sql_file in _sql_files():
        for line_no, line in enumerate(sql_file.read_text(encoding="utf-8").splitlines(), start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("--"):
                continue
            if create_index_pattern.search(line) and "IF NOT EXISTS" not in line.upper():
                offenders.append(f"{sql_file}:{line_no}: {stripped}")

    assert not offenders, "\n".join(offenders)


# Feature: SQL files should avoid top-level transaction control statements (BEGIN/COMMIT/ROLLBACK)
def test_no_top_level_transaction_statements_in_sql_files() -> None:
    offenders: list[str] = []

    for sql_file in _sql_files():
        raw = sql_file.read_text(encoding="utf-8")
        stripped = _strip_dollar_quoted_blocks(_strip_line_comments(raw))

        for line_no, line in enumerate(stripped.splitlines(), start=1):
            token = line.strip()
            if not token:
                continue
            if re.fullmatch(r"(BEGIN|COMMIT|ROLLBACK)\s*;?", token, re.IGNORECASE):
                offenders.append(f"{sql_file}:{line_no}: {token}")

    assert not offenders, "\n".join(offenders)


# Feature: Startup path should call transactional migration runner
def test_startup_invokes_run_all_migrations() -> None:
    startup_content = STARTUP_TS.read_text(encoding="utf-8")
    assert "runAllMigrations" in startup_content
    assert "await runAllMigrations()" in startup_content


# Feature: Main migration runner wraps each migration in BEGIN/COMMIT/ROLLBACK
def test_typescript_runner_uses_per_migration_transaction() -> None:
    runner_content = RUNNER_TS.read_text(encoding="utf-8")
    assert "await client.query('BEGIN')" in runner_content
    assert "await client.query('COMMIT')" in runner_content
    assert "await client.query('ROLLBACK')" in runner_content
