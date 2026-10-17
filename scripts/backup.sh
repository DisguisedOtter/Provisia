#!/usr/bin/env bash
# Provisia backup: PostgreSQL dump + storage volume + configuration, with retention.
#   scripts/backup.sh [--dest DIR] [--keep-days N] [--no-config] [--age-recipient KEY | --gpg-recipient ID]
# Defaults: DIR=~/provisia-backups (rootless) or /var/backups/provisia (rootful), N=14.
# Encryption (recommended, the config archive holds APP_KEY): --age-recipient age1... (or
# PROVISIA_BACKUP_AGE_RECIPIENT) writes *.age files with https://age-encryption.org; --gpg-recipient
# (or PROVISIA_BACKUP_GPG_RECIPIENT) writes *.gpg files. restore.sh decrypts both.
# Runs against the quadlet stack (containers provisia-postgres, volume provisia-storage). Safe while the
# stack is running: pg_dump takes a consistent snapshot; the storage tar may miss files written during the run.
# Schedule it with a systemd timer or cron, see docs/BACKUP.md.
set -euo pipefail

KEEP_DAYS="${PROVISIA_BACKUP_KEEP_DAYS:-14}"
DEST="${PROVISIA_BACKUP_DIR:-}"
AGE_RECIPIENT="${PROVISIA_BACKUP_AGE_RECIPIENT:-}"
GPG_RECIPIENT="${PROVISIA_BACKUP_GPG_RECIPIENT:-}"
WITH_CONFIG=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --keep-days) KEEP_DAYS="$2"; shift 2 ;;
    --no-config) WITH_CONFIG=0; shift ;;
    --age-recipient) AGE_RECIPIENT="$2"; shift 2 ;;
    --gpg-recipient) GPG_RECIPIENT="$2"; shift 2 ;;
    -h | --help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" = 0 ]; then
  DEST="${DEST:-/var/backups/provisia}"; CONF_DIR=/etc/provisia
else
  DEST="${DEST:-$HOME/provisia-backups}"; CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/provisia"
fi
DB_CONTAINER="${PROVISIA_DB_CONTAINER:-provisia-postgres}"
STORAGE_VOLUME="${PROVISIA_STORAGE_VOLUME:-provisia-storage}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

log() { printf '%s backup: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
umask 077
mkdir -p "$DEST"

# encrypt: stdin -> stdout. Plain passthrough when no recipient is configured.
EXT=""
if [ -n "$AGE_RECIPIENT" ] && [ -n "$GPG_RECIPIENT" ]; then echo "use either --age-recipient or --gpg-recipient" >&2; exit 2; fi
if [ -n "$AGE_RECIPIENT" ]; then
  command -v age >/dev/null 2>&1 || { echo "age not installed (https://age-encryption.org)" >&2; exit 1; }
  EXT=".age"; encrypt() { age -r "$AGE_RECIPIENT"; }
elif [ -n "$GPG_RECIPIENT" ]; then
  command -v gpg >/dev/null 2>&1 || { echo "gpg not installed" >&2; exit 1; }
  EXT=".gpg"; encrypt() { gpg --batch --yes --quiet --encrypt --recipient "$GPG_RECIPIENT"; }
else
  encrypt() { cat; }
fi
if [ -z "$EXT" ] && [ "$WITH_CONFIG" = 1 ]; then
  log "note: backups are not encrypted; config-*.tar.gz contains APP_KEY (use --age-recipient / --gpg-recipient or --no-config)"
fi

podman container exists "$DB_CONTAINER" || { echo "container $DB_CONTAINER not found" >&2; exit 1; }
[ "$(podman inspect -f '{{.State.Running}}' "$DB_CONTAINER")" = true ] || { echo "$DB_CONTAINER is not running" >&2; exit 1; }

db_user="$(podman exec "$DB_CONTAINER" sh -c 'echo "${POSTGRES_USER:-provisia}"')"
db_name="$(podman exec "$DB_CONTAINER" sh -c 'echo "${POSTGRES_DB:-provisia}"')"

log "database $db_name -> $DEST/db-$STAMP.dump$EXT (pg_dump custom format)"
podman exec "$DB_CONTAINER" pg_dump -U "$db_user" -d "$db_name" -Fc --no-owner | encrypt > "$DEST/db-$STAMP.dump$EXT.part"
mv "$DEST/db-$STAMP.dump$EXT.part" "$DEST/db-$STAMP.dump$EXT"

if podman volume exists "$STORAGE_VOLUME"; then
  log "volume $STORAGE_VOLUME -> $DEST/storage-$STAMP.tar.gz$EXT"
  podman volume export "$STORAGE_VOLUME" | gzip | encrypt > "$DEST/storage-$STAMP.tar.gz$EXT.part"
  mv "$DEST/storage-$STAMP.tar.gz$EXT.part" "$DEST/storage-$STAMP.tar.gz$EXT"
else
  log "volume $STORAGE_VOLUME not found, skipping"
fi

if [ "$WITH_CONFIG" = 1 ] && [ -d "$CONF_DIR" ]; then
  # Contains APP_KEY: without it encrypted credentials in the database are unreadable. Keep this file safe.
  log "config $CONF_DIR -> $DEST/config-$STAMP.tar.gz$EXT (contains secrets)"
  tar -C "$(dirname "$CONF_DIR")" -cz "$(basename "$CONF_DIR")" | encrypt > "$DEST/config-$STAMP.tar.gz$EXT.part"
  mv "$DEST/config-$STAMP.tar.gz$EXT.part" "$DEST/config-$STAMP.tar.gz$EXT"
fi

( cd "$DEST" && sha256sum db-"$STAMP".dump"$EXT" storage-"$STAMP".tar.gz"$EXT" config-"$STAMP".tar.gz"$EXT" 2>/dev/null > "manifest-$STAMP.sha256" || true )

if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
  log "pruning backups older than $KEEP_DAYS days"
  find "$DEST" -maxdepth 1 -type f \( -name 'db-*.dump*' -o -name 'storage-*.tar.gz*' -o -name 'config-*.tar.gz*' -o -name 'manifest-*.sha256' \) \
    -mtime +"$KEEP_DAYS" -print -delete
fi
log "done: $(du -sh "$DEST" | cut -f1) in $DEST"
