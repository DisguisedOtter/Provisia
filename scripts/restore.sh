#!/usr/bin/env bash
# Provisia restore from scripts/backup.sh output.
#   scripts/restore.sh --db DEST/db-STAMP.dump[.age|.gpg] [--storage DEST/storage-STAMP.tar.gz[.age|.gpg]] [--yes]
# Encrypted backups (backup.sh --age-recipient / --gpg-recipient) are decrypted on the fly: set
# PROVISIA_BACKUP_AGE_IDENTITY=/path/to/key.txt for age (or run with an agent-less gpg keyring for .gpg).
# Stops api/worker/web, restores the database (drop + recreate objects) and the storage volume, re-runs the
# migrate job (so a backup taken on an older version is upgraded) and starts everything again.
# The configuration (provisia.env with APP_KEY) must already be in place: restore config-STAMP.tar.gz by hand
# to ~/.config/provisia or /etc/provisia first, then run scripts/install.sh --no-start if the quadlets are missing.
set -euo pipefail

DB_DUMP="" STORAGE_TAR="" ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB_DUMP="$2"; shift 2 ;;
    --storage) STORAGE_TAR="$2"; shift 2 ;;
    -y | --yes) ASSUME_YES=1; shift ;;
    -h | --help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DB_DUMP" ] && [ -f "$DB_DUMP" ] || { echo "--db FILE is required" >&2; exit 2; }
[ -z "$STORAGE_TAR" ] || [ -f "$STORAGE_TAR" ] || { echo "storage archive not found: $STORAGE_TAR" >&2; exit 2; }

if [ "$(id -u)" = 0 ]; then SYSTEMCTL=(systemctl); else SYSTEMCTL=(systemctl --user); fi
DB_CONTAINER="${PROVISIA_DB_CONTAINER:-provisia-postgres}"
STORAGE_VOLUME="${PROVISIA_STORAGE_VOLUME:-provisia-storage}"
APP_UNITS=(provisia-proxy.service provisia-web.service provisia-worker.service provisia-api.service)
log() { printf '%s restore: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
# decrypt FILE: writes the plaintext to stdout (passthrough for unencrypted files).
decrypt() {
  case "$1" in
    *.age)
      command -v age >/dev/null 2>&1 || { echo "age not installed" >&2; exit 1; }
      [ -n "${PROVISIA_BACKUP_AGE_IDENTITY:-}" ] || { echo "set PROVISIA_BACKUP_AGE_IDENTITY to the age identity file" >&2; exit 1; }
      age -d -i "$PROVISIA_BACKUP_AGE_IDENTITY" "$1" ;;
    *.gpg)
      command -v gpg >/dev/null 2>&1 || { echo "gpg not installed" >&2; exit 1; }
      gpg --batch --quiet --decrypt "$1" ;;
    *) cat "$1" ;;
  esac
}

echo "This REPLACES the current database${STORAGE_TAR:+ and the $STORAGE_VOLUME volume} with:"
echo "  db      : $DB_DUMP"
[ -n "$STORAGE_TAR" ] && echo "  storage : $STORAGE_TAR"
if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "Type 'restore' to continue: " ans; [ "$ans" = restore ] || exit 1
fi

log "stopping application services"
"${SYSTEMCTL[@]}" stop "${APP_UNITS[@]}" provisia-migrate.service || true
"${SYSTEMCTL[@]}" start provisia-postgres.service
for _ in $(seq 1 30); do podman exec "$DB_CONTAINER" pg_isready -q 2>/dev/null && break; sleep 2; done

db_user="$(podman exec "$DB_CONTAINER" sh -c 'echo "${POSTGRES_USER:-provisia}"')"
db_name="$(podman exec "$DB_CONTAINER" sh -c 'echo "${POSTGRES_DB:-provisia}"')"

log "restoring database $db_name"
podman exec "$DB_CONTAINER" psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db_name' AND pid <> pg_backend_pid();" >/dev/null
decrypt "$DB_DUMP" | podman exec -i "$DB_CONTAINER" pg_restore -U "$db_user" -d "$db_name" --clean --if-exists --no-owner --no-privileges --exit-on-error

if [ -n "$STORAGE_TAR" ]; then
  log "restoring volume $STORAGE_VOLUME"
  podman volume exists "$STORAGE_VOLUME" || podman volume create "$STORAGE_VOLUME" >/dev/null
  # Clear the volume first so files deleted since the backup do not linger.
  podman run --rm -v "$STORAGE_VOLUME":/data:Z docker.io/library/busybox:1.37 sh -c 'find /data -mindepth 1 -delete'
  decrypt "$STORAGE_TAR" | gzip -dc | podman volume import "$STORAGE_VOLUME" -
fi

log "running migrations and starting services"
"${SYSTEMCTL[@]}" start provisia-migrate.service
"${SYSTEMCTL[@]}" start provisia-api.service provisia-worker.service provisia-web.service provisia-proxy.service
log "done. Check: ${SYSTEMCTL[*]} status 'provisia-*'"
