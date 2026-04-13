-- ============================================================
-- Create restricted ops_user role (DML only — no DDL)
-- Run as superuser/postgres role
-- ============================================================

-- Create the role (change password before running in production)
CREATE ROLE ops_user WITH LOGIN PASSWORD 'CHANGE_ME_BEFORE_PRODUCTION';

-- Grant connect
GRANT CONNECT ON DATABASE postgres TO ops_user;

-- Grant usage on public schema
GRANT USAGE ON SCHEMA public TO ops_user;

-- Grant DML-only on all existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ops_user;

-- Ensure future tables also get DML grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ops_user;

-- Explicitly REVOKE DDL privileges
REVOKE CREATE ON SCHEMA public FROM ops_user;

-- Verify: ops_user should NOT be able to:
--   CREATE TABLE, ALTER TABLE, DROP TABLE, CREATE INDEX, etc.
-- Test after creation:
--   SET ROLE ops_user;
--   CREATE TABLE test_ddl (id int);  -- Should fail with permission denied
--   INSERT INTO ops_config (key, value) VALUES ('test', 'works');  -- Should succeed
--   DELETE FROM ops_config WHERE key = 'test';  -- Should succeed
