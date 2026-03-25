-- Migration 013: Fix session_id column types from UUID to VARCHAR
-- 
-- Root cause: Old migration (apps/api/migrations/004) created agent_sessions.id
-- and agent_strategies.session_id as UUID type. The code generates session IDs
-- with a timestamp prefix (e.g. session_1774426163072_UUID) which is not a valid UUID.
-- New migration 007 defines these as VARCHAR(100) but CREATE TABLE IF NOT EXISTS
-- silently skips when the old table already exists.
--
-- This migration safely converts UUID columns to VARCHAR(255) by dropping and
-- recreating FK constraints.

DO $$
DECLARE
    col_type TEXT;
    fk_record RECORD;
BEGIN
    -- Check if agent_sessions.id is UUID type (from old migration 004)
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'agent_sessions'
      AND column_name = 'id';

    -- Nothing to do if table doesn't exist or column is already varchar
    IF col_type IS NULL OR col_type = 'character varying' THEN
        RAISE NOTICE 'agent_sessions.id is already VARCHAR or table does not exist — skipping';
        RETURN;
    END IF;

    IF col_type = 'uuid' THEN
        RAISE NOTICE 'Converting agent_sessions.id from UUID to VARCHAR(255)...';

        -- Drop all FK constraints referencing agent_sessions(id)
        FOR fk_record IN
            SELECT tc.constraint_name, tc.table_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
              AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND ccu.table_name = 'agent_sessions'
              AND ccu.column_name = 'id'
              AND tc.table_schema = current_schema()
        LOOP
            RAISE NOTICE 'Dropping FK constraint %.% → agent_sessions(id)', fk_record.table_name, fk_record.constraint_name;
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk_record.table_name, fk_record.constraint_name);
        END LOOP;

        -- Convert agent_sessions.id to VARCHAR(255)
        ALTER TABLE agent_sessions ALTER COLUMN id TYPE VARCHAR(255) USING id::text;

        -- Convert session_id columns in related tables
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_strategies' AND column_name = 'session_id' AND table_schema = current_schema() AND data_type = 'uuid') THEN
            ALTER TABLE agent_strategies ALTER COLUMN session_id TYPE VARCHAR(255) USING session_id::text;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_learnings' AND column_name = 'session_id' AND table_schema = current_schema() AND data_type = 'uuid') THEN
            ALTER TABLE agent_learnings ALTER COLUMN session_id TYPE VARCHAR(255) USING session_id::text;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_activity_log' AND column_name = 'session_id' AND table_schema = current_schema() AND data_type = 'uuid') THEN
            ALTER TABLE agent_activity_log ALTER COLUMN session_id TYPE VARCHAR(255) USING session_id::text;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trades' AND column_name = 'agent_session_id' AND table_schema = current_schema() AND data_type = 'uuid') THEN
            ALTER TABLE trades ALTER COLUMN agent_session_id TYPE VARCHAR(255) USING agent_session_id::text;
        END IF;

        RAISE NOTICE 'Session ID type conversion complete';
    END IF;
END $$;
