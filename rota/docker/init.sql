-- ==============================================================================
-- Rota — PostgreSQL initialization script
-- Creates the three logical databases for the monorepo.
-- Runs automatically when the postgres container starts for the first time.
-- ==============================================================================

-- Shard 0: team-owned data (teams, memberships, shifts, etc.)
CREATE DATABASE rota_shard_0 OWNER rota;

-- Shard 1: team-owned data (same schema, different teams)
CREATE DATABASE rota_shard_1 OWNER rota;

-- Note: the control_plane database is created by POSTGRES_DB in docker-compose.yml
-- and already exists when this script runs.
