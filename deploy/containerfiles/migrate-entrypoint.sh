#!/bin/sh
# One-shot job: wait for PostgreSQL, apply migrations, optionally seed.
#   MIGRATE_SEED=true      also run the idempotent seed (admin user, tax rules, demo product)
#   MIGRATE_WAIT_SECONDS   how long to wait for the database (default 90)
set -eu

wait_seconds="${MIGRATE_WAIT_SECONDS:-90}"
echo "provisia-migrate: waiting up to ${wait_seconds}s for the database"
i=0
until node -e '
  const { connect } = require("node:net");
  const u = new URL(process.env.DATABASE_URL);
  const s = connect({ host: u.hostname, port: Number(u.port || 5432) }, () => { s.end(); process.exit(0); });
  s.on("error", () => process.exit(1));
  setTimeout(() => process.exit(1), 3000);
' 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge "$wait_seconds" ]; then
    echo "provisia-migrate: database not reachable after ${wait_seconds}s" >&2
    exit 1
  fi
  sleep 1
done

echo "provisia-migrate: applying migrations"
node /app/packages/db/dist/migrate.js

case "${MIGRATE_SEED:-false}" in
  1 | true | TRUE | yes)
    echo "provisia-migrate: running seed"
    node /app/packages/db/dist/seed.js
    ;;
  *)
    echo "provisia-migrate: seed skipped (MIGRATE_SEED=${MIGRATE_SEED:-false})"
    ;;
esac
echo "provisia-migrate: done"
