#!/usr/bin/env bash
# Creates one database + owner role per service (database-per-service, ADR-001), the Keycloak
# database and the superuser-only extensions. Idempotent: safe on every deploy.
#   Compose:     runs from /docker-entrypoint-initdb.d on an empty data directory (local socket).
#   Kubernetes:  runs as the db-bootstrap Job with PGHOST/PGUSER/PGPASSWORD of the superuser.
# Trusted extensions (pg_trgm, unaccent, btree_gin) are created by each service's migrations.
set -euo pipefail

SERVICES=(catalog tracker records analytics profile billing notification)

psql_su() { psql -v ON_ERROR_STOP=1 -q --username "${PGUSER:-${POSTGRES_USER:-postgres}}" "$@"; }

ensure_role_and_db() { # role password database
  local role="$1" password="$2" db="$3"
  psql_su --dbname postgres -v role="$role" -v password="$password" -v db="$db" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SQL
}

for context in "${SERVICES[@]}"; do
  var="$(echo "$context" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
  ensure_role_and_db "${context}_svc" "${!var:?$var is required}" "${context}_db"
  psql_su --dbname "${context}_db" -v role="${context}_svc" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT format('ALTER SCHEMA public OWNER TO %I', :'role') \gexec
SQL
done

ensure_role_and_db keycloak "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}" keycloak_db

# pg_partman for records_db; records_svc runs create_parent() and the maintenance worker.
psql_su --dbname records_db <<'SQL'
CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
GRANT ALL ON SCHEMA partman TO records_svc;
GRANT ALL ON ALL TABLES IN SCHEMA partman TO records_svc;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO records_svc;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO records_svc;
SQL
echo "databases ready"
