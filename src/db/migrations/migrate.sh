#!/bin/bash
# Migration script to initialize database

# Usage: ./migrate.sh <database_url>
# Example: ./migrate.sh "postgresql://user:password@localhost:5432/umbrella_reports"

if [ -z "$1" ]; then
  echo "Error: Database URL required"
  echo "Usage: ./migrate.sh <database_url>"
  exit 1
fi

DB_URL=$1
MIGRATION_DIR="$(dirname "$0")"

echo "Running migrations on: $DB_URL"

# Run all SQL files in order
for file in $MIGRATION_DIR/*.sql; do
  if [ -f "$file" ]; then
    echo "Running: $(basename $file)"
    psql "$DB_URL" -f "$file"
    if [ $? -ne 0 ]; then
      echo "Error running $(basename $file)"
      exit 1
    fi
  fi
done

echo "✅ All migrations completed successfully"
