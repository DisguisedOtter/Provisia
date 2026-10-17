#!/usr/bin/env bash
# Provisia installer: podman quadlets + systemd (rootless by default, rootful when run as root).
#
#   curl -fsSL https://<forgejo>/provisia/provisia/raw/branch/main/scripts/install.sh | bash -s -- \
#       --registry forgejo.example.com/provisia --domain billing.example.com --email you@example.com
# or from a checkout / unpacked provisia-quadlets-vX.Y.Z.tar.gz:
#   ./scripts/install.sh --registry forgejo.example.com/provisia --domain billing.example.com --email you@example.com
#
# What it does (see docs/INSTALL.md for the manual equivalent):
#   1. checks podman >= 4.4 and systemd, warns about linger / unprivileged ports (rootless)
#   2. copies deploy/quadlets/* to ~/.config/containers/systemd (or /etc/containers/systemd as root),
#      filling in the image registry/tag
#   3. generates APP_KEY, SESSION_SECRET, the database and queue passwords and an admin password and writes
#      provisia.env (api/worker/migrate) + provisia-db.env + provisia-valkey.env + provisia-proxy.env +
#      provisia-web.env + Caddyfile to ~/.config/provisia (or /etc/provisia). Existing files are kept.
#   4. systemctl daemon-reload, starts the stack, waits for the API health check and prints the admin login
set -euo pipefail

VERSION_MIN_PODMAN="4.4"
REGISTRY="${PROVISIA_REGISTRY:-}"
TAG="${PROVISIA_TAG:-latest}"
DOMAIN="${PROVISIA_DOMAIN:-}"
ACME_EMAIL="${PROVISIA_ACME_EMAIL:-}"
ADMIN_EMAIL="${PROVISIA_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${PROVISIA_ADMIN_PASSWORD:-}"
SOURCE_DIR=""
START=1
ASSUME_YES=0

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  cat <<USAGE

Options:
  --registry HOST[/NAMESPACE]  container registry that holds provisia-{api,worker,web,migrate} (required)
  --tag TAG                    image tag (default: latest; use a version like v0.1.0 to pin)
  --domain HOST                public hostname (Caddy obtains a TLS certificate for it)
  --email ADDRESS              ACME account e-mail (certificate expiry notices)
  --admin-email ADDRESS        first admin login (default: --email)
  --admin-password SECRET      first admin password (default: generated)
  --source DIR                 directory containing deploy/quadlets and deploy/caddy (default: auto-detect / download)
  --no-start                   install units and config only
  -y, --yes                    do not ask for confirmation
  -h, --help                   this help
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) ACME_EMAIL="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift 2 ;;
    --source) SOURCE_DIR="$2"; shift 2 ;;
    --no-start) START=0; shift ;;
    -y | --yes) ASSUME_YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
ask() { # ask VAR "prompt" [default]
  local var="$1" prompt="$2" def="${3:-}" val
  if [ -n "${!var:-}" ]; then return; fi
  if [ "$ASSUME_YES" = 1 ] || [ ! -t 0 ]; then
    [ -n "$def" ] && { printf -v "$var" '%s' "$def"; return; }
    die "$var is required (pass --${var,,} or set PROVISIA_${var})"
  fi
  read -r -p "$prompt${def:+ [$def]}: " val
  printf -v "$var" '%s' "${val:-$def}"
}
randhex() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
randpass() { randhex 12; }
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

# ---- 1. preflight ---------------------------------------------------------------------------
command -v podman >/dev/null 2>&1 || die "podman is not installed (https://podman.io/docs/installation)"
command -v systemctl >/dev/null 2>&1 || die "systemd is required for quadlets"
PODMAN_VERSION="$(podman version --format '{{.Client.Version}}' 2>/dev/null || podman --version | awk '{print $3}')"
version_ge "$PODMAN_VERSION" "$VERSION_MIN_PODMAN" || die "podman $PODMAN_VERSION found, >= $VERSION_MIN_PODMAN required for quadlets"
version_ge "$PODMAN_VERSION" "4.9" || warn "podman < 4.9: 'Notify=healthy' is ignored; services retry until the database is up (slower first start)"

if [ "$(id -u)" = 0 ]; then
  MODE=rootful
  SYSTEMCTL=(systemctl)
  QUADLET_DIR=/etc/containers/systemd
  CONF_DIR=/etc/provisia
else
  MODE=rootless
  SYSTEMCTL=(systemctl --user)
  QUADLET_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd"
  CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/provisia"
  if [ -z "${XDG_RUNTIME_DIR:-}" ]; then XDG_RUNTIME_DIR="/run/user/$(id -u)"; export XDG_RUNTIME_DIR; fi
  [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
  "${SYSTEMCTL[@]}" is-system-running >/dev/null 2>&1 || "${SYSTEMCTL[@]}" list-units >/dev/null 2>&1 \
    || die "cannot talk to the systemd user instance. Log in as this user over SSH (not su/sudo) or run: loginctl enable-linger $(id -un)"
  if command -v loginctl >/dev/null && [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]; then
    warn "lingering is off: the stack stops when you log out. Fix: sudo loginctl enable-linger $(id -un)"
  fi
  START_PORT="$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || echo 1024)"
  if [ "$START_PORT" -gt 80 ]; then
    warn "rootless podman cannot bind ports 80/443 (net.ipv4.ip_unprivileged_port_start=$START_PORT)."
    warn "Fix: echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-provisia.conf && sudo sysctl --system"
  fi
fi
log "podman $PODMAN_VERSION, $MODE install, quadlets -> $QUADLET_DIR, config -> $CONF_DIR"

# ---- 2. locate quadlet sources --------------------------------------------------------------
if [ -z "$SOURCE_DIR" ]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
  for cand in "$here/.." "$here" "$PWD"; do
    if [ -d "$cand/deploy/quadlets" ] && [ -f "$cand/deploy/caddy/Caddyfile" ]; then SOURCE_DIR="$cand"; break; fi
  done
fi
[ -n "$SOURCE_DIR" ] && [ -d "$SOURCE_DIR/deploy/quadlets" ] \
  || die "quadlet sources not found. Run from a checkout or an unpacked provisia-quadlets-*.tar.gz, or pass --source DIR"

ask REGISTRY "Container registry (e.g. forgejo.example.com/provisia)"
REGISTRY="${REGISTRY%/}"
ask DOMAIN "Public hostname" "$(hostname -f 2>/dev/null || hostname)"
ask ACME_EMAIL "E-mail for Let's Encrypt notices" "admin@${DOMAIN}"
ADMIN_EMAIL="${ADMIN_EMAIL:-$ACME_EMAIL}"
if [ "$DOMAIN" = localhost ] || [[ "$DOMAIN" == *.local ]] || [[ "$DOMAIN" == *.localhost ]]; then
  PUBLIC_URL="https://$DOMAIN"
  warn "'$DOMAIN' is not publicly resolvable: Caddy will use its internal CA (browser warning)."
else
  PUBLIC_URL="https://$DOMAIN"
fi

echo
echo "  registry : $REGISTRY  (tag $TAG)"
echo "  domain   : $DOMAIN  ->  $PUBLIC_URL"
echo "  admin    : $ADMIN_EMAIL"
echo "  quadlets : $QUADLET_DIR"
echo "  config   : $CONF_DIR"
echo
if [ "$ASSUME_YES" != 1 ] && [ -t 0 ]; then
  read -r -p "Continue? [Y/n] " yn
  case "$yn" in n | N | no | NO) exit 1 ;; esac
fi

# ---- 3. config files ------------------------------------------------------------------------
umask 077
mkdir -p "$CONF_DIR" "$QUADLET_DIR"
GENERATED_ADMIN_PASSWORD=""
# envval FILE KEY: value of KEY in a systemd EnvironmentFile (empty when missing).
envval() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n1 | sed -e 's/^"//' -e 's/"$//'; }
if [ -f "$CONF_DIR/provisia.env" ]; then
  log "keeping existing $CONF_DIR/provisia.env"
  DB_PASSWORD="$(envval "$CONF_DIR/provisia-db.env" POSTGRES_PASSWORD)"
  VALKEY_PASSWORD="$(envval "$CONF_DIR/provisia-valkey.env" VALKEY_PASSWORD)"
  # Older installs kept the proxy/web variables in provisia.env; reuse them for the split files below.
  [ -n "$(envval "$CONF_DIR/provisia.env" PROVISIA_DOMAIN)" ] && DOMAIN="$(envval "$CONF_DIR/provisia.env" PROVISIA_DOMAIN)"
  [ -n "$(envval "$CONF_DIR/provisia.env" PROVISIA_ACME_EMAIL)" ] && ACME_EMAIL="$(envval "$CONF_DIR/provisia.env" PROVISIA_ACME_EMAIL)"
  [ -n "$(envval "$CONF_DIR/provisia.env" APP_URL)" ] && PUBLIC_URL="$(envval "$CONF_DIR/provisia.env" APP_URL)"
  if [ -z "$VALKEY_PASSWORD" ]; then
    # Upgrade: the queue store gets a password; point REDIS_URL at it (same file, same restart).
    VALKEY_PASSWORD="$(randhex 24)"
    if grep -q '^REDIS_URL=redis://provisia-valkey:6379' "$CONF_DIR/provisia.env"; then
      log "enabling Valkey authentication (REDIS_URL updated in provisia.env)"
      sed -i "s#^REDIS_URL=redis://provisia-valkey:6379#REDIS_URL=redis://:$VALKEY_PASSWORD@provisia-valkey:6379#" "$CONF_DIR/provisia.env"
    else
      warn "provisia-valkey.env is new: make sure REDIS_URL in provisia.env carries the password redis://:PASSWORD@provisia-valkey:6379"
    fi
  fi
else
  DB_PASSWORD="$(randhex 16)"
  VALKEY_PASSWORD="$(randhex 24)"
  APP_KEY="$(randhex 32)"
  SESSION_SECRET="$(randhex 32)"
  if [ -z "$ADMIN_PASSWORD" ]; then ADMIN_PASSWORD="$(randpass)"; GENERATED_ADMIN_PASSWORD=1; fi
  log "writing $CONF_DIR/provisia.env"
  cat > "$CONF_DIR/provisia.env" <<ENV
# Generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Reference: docs/CONFIGURATION.md
# Read by the api, worker and migrate containers only (proxy/web/valkey have their own files).
APP_URL=$PUBLIC_URL
WEB_URL=$PUBLIC_URL

APP_KEY=$APP_KEY
SESSION_SECRET=$SESSION_SECRET

DATABASE_URL=postgres://provisia:$DB_PASSWORD@provisia-postgres:5432/provisia
REDIS_URL=redis://:$VALKEY_PASSWORD@provisia-valkey:6379

NODE_ENV=production
LOG_LEVEL=info
SESSION_TTL_DAYS=30
WORKER_CONCURRENCY=5
STORAGE_PATH=/data/storage

# Configure your SMTP relay (docs/INSTALL.md "Configuring SMTP"); mail is disabled until this points somewhere real.
SMTP_URL=smtp://localhost:25
MAIL_FROM="Provisia <noreply@$DOMAIN>"

# First start only: seed the admin user and defaults, then set MIGRATE_SEED=false and remove the password.
MIGRATE_SEED=true
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV
fi
if [ ! -f "$CONF_DIR/provisia-db.env" ]; then
  [ -n "${DB_PASSWORD:-}" ] || die "provisia.env exists but provisia-db.env is missing; cannot recover the database password"
  log "writing $CONF_DIR/provisia-db.env"
  printf 'POSTGRES_USER=provisia\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=provisia\n' "$DB_PASSWORD" > "$CONF_DIR/provisia-db.env"
fi
if [ ! -f "$CONF_DIR/provisia-valkey.env" ]; then
  log "writing $CONF_DIR/provisia-valkey.env"
  printf '# Must match the password in REDIS_URL (provisia.env).\nVALKEY_PASSWORD=%s\n' "$VALKEY_PASSWORD" > "$CONF_DIR/provisia-valkey.env"
fi
if [ ! -f "$CONF_DIR/provisia-proxy.env" ]; then
  log "writing $CONF_DIR/provisia-proxy.env"
  printf 'PROVISIA_DOMAIN=%s\nPROVISIA_ACME_EMAIL=%s\n' "$DOMAIN" "$ACME_EMAIL" > "$CONF_DIR/provisia-proxy.env"
fi
if [ ! -f "$CONF_DIR/provisia-web.env" ]; then
  log "writing $CONF_DIR/provisia-web.env"
  cat > "$CONF_DIR/provisia-web.env" <<ENV
# Public URLs only; the web container never receives application secrets.
NODE_ENV=production
LOG_LEVEL=info
APP_URL=$PUBLIC_URL
WEB_URL=$PUBLIC_URL
NEXT_PUBLIC_API_URL=$PUBLIC_URL
INTERNAL_API_URL=http://provisia-api:3001
ENV
fi
if [ ! -f "$CONF_DIR/Caddyfile" ]; then
  log "writing $CONF_DIR/Caddyfile"
  install -m 0644 "$SOURCE_DIR/deploy/caddy/Caddyfile" "$CONF_DIR/Caddyfile"
else
  log "keeping existing $CONF_DIR/Caddyfile"
fi
chmod 0600 "$CONF_DIR/provisia.env" "$CONF_DIR/provisia-db.env" "$CONF_DIR/provisia-valkey.env" "$CONF_DIR/provisia-proxy.env" "$CONF_DIR/provisia-web.env"

# ---- 4. quadlets ----------------------------------------------------------------------------
log "installing quadlets"
for f in "$SOURCE_DIR"/deploy/quadlets/*.container "$SOURCE_DIR"/deploy/quadlets/*.network "$SOURCE_DIR"/deploy/quadlets/*.volume; do
  name="$(basename "$f")"
  sed -e "s#__REGISTRY__#$REGISTRY#g" -e "s#__TAG__#$TAG#g" \
      -e "s#%h/.config/provisia#$CONF_DIR#g" \
      "$f" > "$QUADLET_DIR/$name.tmp"
  if [ "$MODE" = rootful ]; then
    sed -i -e 's/^WantedBy=default.target$/WantedBy=multi-user.target/' "$QUADLET_DIR/$name.tmp"
  fi
  mv "$QUADLET_DIR/$name.tmp" "$QUADLET_DIR/$name"
  chmod 0644 "$QUADLET_DIR/$name"
done
if [ "$MODE" = rootless ] && command -v chcon >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null)" = Enforcing ]; then
  chcon -t container_file_t "$CONF_DIR/Caddyfile" 2>/dev/null || true
fi

log "systemctl daemon-reload"
"${SYSTEMCTL[@]}" daemon-reload
if ! "${SYSTEMCTL[@]}" list-unit-files 'provisia-*.service' --no-legend 2>/dev/null | grep -q provisia-api.service; then
  warn "quadlet units were not generated. Inspect with: /usr/libexec/podman/quadlet -dryrun${MODE:+ }$([ "$MODE" = rootless ] && echo -user)"
fi

if [ "$START" != 1 ]; then
  log "installed. Start with: ${SYSTEMCTL[*]} start provisia-proxy provisia-worker"
  exit 0
fi

# ---- 5. start -------------------------------------------------------------------------------
log "pulling images and starting the stack (first start takes a few minutes)"
"${SYSTEMCTL[@]}" start provisia-postgres.service provisia-valkey.service
"${SYSTEMCTL[@]}" start provisia-migrate.service || { "${SYSTEMCTL[@]}" status provisia-migrate.service --no-pager -l || true; die "migrations failed; see: journalctl ${MODE:+--user} -u provisia-migrate"; }
"${SYSTEMCTL[@]}" start provisia-api.service provisia-worker.service provisia-web.service provisia-proxy.service

log "waiting for the API health check"
for _ in $(seq 1 60); do
  if podman healthcheck run provisia-api >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 3
done
if [ -z "${HEALTHY:-}" ]; then
  warn "API not healthy yet. Check: ${SYSTEMCTL[*]} status provisia-api  /  podman logs provisia-api"
fi

# Turn the seed off for subsequent (auto-)restarts of the migrate job and drop the plaintext password.
sed -i -e 's/^MIGRATE_SEED=true$/MIGRATE_SEED=false/' -e 's/^SEED_ADMIN_PASSWORD=.*$/SEED_ADMIN_PASSWORD=/' "$CONF_DIR/provisia.env"

cat <<DONE

Provisia is up.

  Admin panel : $PUBLIC_URL/admin
  Client portal: $PUBLIC_URL/portal
  API docs    : $PUBLIC_URL/api/docs
  Login       : $ADMIN_EMAIL
  Password    : ${ADMIN_PASSWORD:-<as provided>}${GENERATED_ADMIN_PASSWORD:+   (generated; change it after the first login)}

Next steps: docs/INSTALL.md (SMTP, payment gateway), docs/BACKUP.md (scripts/backup.sh), docs/UPGRADE.md.
Enable unattended image updates:  ${SYSTEMCTL[*]} enable --now podman-auto-update.timer
Status:  ${SYSTEMCTL[*]} status 'provisia-*'    Logs:  journalctl $([ "$MODE" = rootless ] && echo --user) -u provisia-api -f
DONE
