# Poloniex Trading Platform - PRD

## Original Problem Statement
Fix SQL migration files causing deployment failures. All recent deployments were FAILED due to migration 009_backtest_results_table.sql having a schema conflict that causes the app to crash-loop on startup.

## Architecture
- **Stack**: Node.js/TypeScript API + React frontend + PostgreSQL
- **Deployment**: Railway
- **Migration System**: Sequential SQL files in `apps/api/database/migrations/`, tracked via `schema_migrations` table, run on startup via `runMigrations.ts`
- **Two migration directories**: `apps/api/migrations/` (old) and `apps/api/database/migrations/` (active)

## Root Cause Analysis
1. Migration 002 creates `backtest_results` table (id, strategy_name, symbol, etc.) - NO user_id column
2. Migration 009 tries `CREATE TABLE IF NOT EXISTS backtest_results` with different schema including user_id - silently skipped (no-op)
3. Migration 009 then creates indexes on `user_id` and `strategy_id` - columns don't exist - CRASH (error 42703)
4. App restart loop -> healthcheck fails -> deployment marked FAILED

## What's Been Implemented (Jan 2026)
- **Migration 009 fix**: Replaced `CREATE TABLE IF NOT EXISTS` with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for user_id, strategy_id, status, progress, results, error, started_at, completed_at
- **Migration 010 fix**: Made agent_session_id FK reference conditional (only adds FK if agent_sessions table exists)
- **Migration 011 fix**: Made agent_events table creation type-aware (checks agent_sessions.id type before deciding FK strategy)

## Testing Status
- All SQL syntax validated
- No column conflicts between migrations
- Migration chain 001-013 verified for correctness
- 95% test pass rate (22/23 - only minor non-blocking numbering gap for migration 005)

## Backlog
- P0: Commit, push, and redeploy to Railway
- P1: Consider consolidating the two migration directories (`migrations/` and `database/migrations/`)
- P2: Add migration 005 to `database/migrations/` if needed for completeness
