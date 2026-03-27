# PRD

## Original Problem Statement
CRITICAL ISSUE FOUND:

Your deployment is failing because the migration runner is crashing on startup.

Error: trigger "update_futures_accounts_updated_at" for relation "futures_accounts" already exists

Root Cause: Migration 001_futures_schema.sql uses CREATE TRIGGER instead of CREATE TRIGGER IF NOT EXISTS. When migrations run multiple times (retries, restarts), the trigger already exists and Postgres throws error code 42710.

This blocks the entire app from starting → healthcheck fails → deployment marked FAILED.

User follow-up: check past 10 PRs and ensure everything has been covered from all, all up and downstream too, comprehensive.

## Architecture Decisions
- Keep the existing migration architecture: startup path uses `apps/api/src/scripts/runMigrations.ts` against `apps/api/database/migrations`.
- Preserve legacy migration files in `apps/api/migrations`, but make them rerun-safe too because recent compatibility migrations reference them and operators may still use them manually.
- Use valid PostgreSQL-safe idempotency patterns: `DROP TRIGGER IF EXISTS ...; CREATE TRIGGER ...` instead of `CREATE TRIGGER IF NOT EXISTS` because PostgreSQL does not support that syntax.
- Align all migration execution entrypoints (`src/scripts/runMigrations.ts`, `run-migration.js`, and admin migration route) to per-file transaction semantics.

## What Has Been Implemented
- Audited recent migration-related history around the last 10 PRs and traced the active + legacy migration paths.
- Fixed rerun-sensitive trigger creation in active database migrations: `001_futures_schema.sql`, `002_backtesting_schema.sql`, `003_autonomous_trading_schema.sql`, and `008_create_trades_table.sql`.
- Made `004_unified_strategy_schema.sql` safer on reruns by guarding constraint creation and making migration log insert idempotent.
- Removed the explicit `COMMIT` from `003_autonomous_trading_schema.sql` to avoid conflicts with the transactional migration runner.
- Added idempotency fixes in legacy migrations: `003_add_encrypted_api_credentials.sql` and `004_add_autonomous_agent_tables.sql` (trigger guards + index `IF NOT EXISTS`).
- Preserved and validated already-safe trigger handling in `007_agent_tables.sql`, `010_add_missing_tables.sql`, and `012_fix_schema_compatibility.sql`.
- Updated `apps/api/run-migration.js` to wrap each migration in `BEGIN/COMMIT/ROLLBACK`.
- Updated `apps/api/src/routes/admin.ts` to run each migration inside its own transaction too.
- Verified with static rerun-safety checks and pytest (`5 passed`).

## Prioritized Backlog
### P0
- Run the migrations against a real PostgreSQL environment with `DATABASE_URL` and confirm startup succeeds end-to-end.
- Ensure deployment environment uses the same migration path as startup and no stale/manual scripts are invoked outside the tracked flow.

### P1
- Add CI checks that fail on non-idempotent migration patterns (unguarded triggers, non-transactional runners, explicit `COMMIT` in SQL files).
- Consolidate or clearly document the purpose of the two migration directories to reduce operator confusion.

### P2
- Add automated migration smoke tests against a disposable Postgres database in CI.
- Consider deduplicating migration-completion log records further with schema-level uniqueness if desired.

## Next Tasks
- Redeploy with the patched migrations.
- If any migration still fails at runtime, capture the exact failing filename + SQLSTATE and extend the same idempotency pattern there.
- Optionally add a migration lint/test step so future PRs cannot reintroduce rerun blockers.


## Deployment Readiness Update
- Fixed stale deployment/readiness scripts that still referenced legacy `backend/` and `frontend/` paths after the monorepo moved to `apps/api` and `apps/web`.
- Updated Railway validation scripts to correctly inspect `apps/api` and `apps/web`, accept Node 20, and understand Railpack-driven builds.
- Updated service Railpack configs so build/start commands are correct for service-root execution (`yarn run build`, `yarn run start`, `node serve.js`).
- Removed hardcoded deployment URL assumptions from backend CORS and frontend environment helpers, and corrected backend static frontend path resolution to `../../web/dist`.
- Removed a hardcoded backend DNS prefetch hint from `apps/web/index.html`.
- Rebuilt both services successfully and re-ran all deployment validators.
- Verified frontend runtime health locally via `/healthz` after build.
- Re-ran focused frontend regression tests (`connectivity-fix`, `websocket-config`) and backend migration safety tests; all passed.

## Deployment Validation Results
- `yarn build:api` ✅
- `yarn build:web` ✅
- `yarn deploy:check` ✅
- `yarn railway:validate` ✅
- `node scripts/railway-compliance-check.mjs` ✅ (warning only: root `nixpacks.toml` is ignored because `railway.json` explicitly uses RAILPACK)
- `node scripts/verify-frontend-deployment.js` ✅
- Frontend health endpoint `/healthz` ✅

## Remaining Runtime Constraint
- End-to-end backend startup health in this workspace still requires real deployment environment variables (`DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `API_ENCRYPTION_KEY`), which are not present in this container.


## GitHub Automation Update
- Added `.github/workflows/auto-migrate-on-main.yml`.
- The workflow runs on:
  - push to `main`
  - merged PRs into `main`
  - manual dispatch
- It supports two migration modes:
  - Railway remote execution via `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE`, and optional `RAILWAY_ENVIRONMENT`
  - direct database execution via `DATABASE_URL`
- It fails clearly if neither migration credential path is configured.
- It optionally checks deployed backend health after migration using `RAILWAY_BACKEND_HEALTH_URL`.
