#!/bin/bash

# Run migration 006: Add encryption fields
# Usage: ./scripts/run-migration-006.sh

set -e

echo "Running migration 006: Add encryption fields..."

# Get database connection from environment or use Railway defaults
DB_HOST="${DB_HOST:-interchange.proxy.rlwy.net}"
DB_PORT="${DB_PORT:-45066}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-railway}"
DB_PASSWORD="${DB_PASSWORD:-HcsyUTnGVUNmdsKrWDHloHcTcwUzeteT}"

# Run migration
PGPASSWORD=$DB_PASSWORD psql \
  -h $DB_HOST \
  -U $DB_USER \
  -p $DB_PORT \
  -d $DB_NAME \
  -f database/migrations/006_add_encryption_fields.sql

echo "✅ Migration 006 completed successfully!"
