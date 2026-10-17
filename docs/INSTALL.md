# Installing Provisia (podman quadlets)

Production deployment of Provisia is a set of OCI containers managed by **systemd through podman quadlets**:
PostgreSQL 16, Valkey (Redis 7 compatible), the API, the background worker, the web app, a one-shot
migration job and a Caddy reverse proxy with automatic HTTPS. Everything runs rootless by default.

```
                 443/80            provisia network (podman bridge)
 Internet ──────────────► provisia-proxy (Caddy) ──┬── /api/*  ──► provisia-api    ──┐
                                                   └── /*      ──► provisia-web      │
                                                                                     ├── provisia-postgres
                                            provisia-migrate (one-shot, before api) ─┤
                                            provisia-worker (BullMQ jobs, cron)     ─┴── provisia-valkey
```

Other ways to run the images (Kubernetes, Nomad, compose) are possible: `deploy/containerfiles/README.md`
documents the images and `docs/CONFIGURATION.md` every variable. This guide covers the supported path.

## 1. Requirements

| | Minimum | Notes |
|---|---|---|
| OS | Linux with systemd | Tested on Fedora CoreOS / Fedora 40+, Debian 13, Ubuntu 24.04. Debian 12 ships podman 4.3 (no quadlets): use the [Debian backports](https://backports.debian.org/) or Fedora/Alma. |
| podman | **4.4** (quadlets); 4.9+ recommended (`Notify=healthy`) | `podman --version` |
| CPU / RAM / disk | 2 vCPU, 2 GB RAM, 20 GB | Images total ~1.3 GB; PostgreSQL grows with invoices/tickets. |
| DNS | A/AAAA record for your hostname pointing at the server | Needed for Let's Encrypt. |
| Ports | 80 and 443 reachable from the internet | HTTP is only used for the ACME challenge and redirects to HTTPS. |
| Outbound | 443 to the container registry, Let's Encrypt, payment gateways / registrars; SMTP to your relay | |

### Rootless prerequisites (recommended)

Create a dedicated user and allow its systemd user instance to run without a login session and to bind
ports 80/443:

```sh
sudo useradd -m -s /bin/bash provisia
sudo loginctl enable-linger provisia
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-provisia.conf
sudo sysctl --system
# Log in as that user through SSH or machinectl (NOT `su`, which has no systemd user session):
sudo machinectl shell provisia@
```

If you prefer not to lower `ip_unprivileged_port_start`, change `PublishPort=` in `provisia-proxy.container`
to `8080:80` / `8443:443` and put your own reverse proxy or a firewall redirect in front.

### Rootful

Run the installer as root; units go to `/etc/containers/systemd/` and configuration to `/etc/provisia/`.
No sysctl or linger changes are needed.

## 2. Install with the script

Download the quadlet bundle attached to the [release](../../../releases) you want (or use a checkout of
the repository) and run the installer. It asks for the registry, hostname and e-mail when not given.

```sh
curl -fsSLO https://FORGEJO_HOST/OWNER/provisia/releases/download/vX.Y.Z/provisia-quadlets-vX.Y.Z.tar.gz
tar -xzf provisia-quadlets-vX.Y.Z.tar.gz && cd provisia-quadlets-vX.Y.Z

./scripts/install.sh \
  --registry FORGEJO_HOST/OWNER \
  --tag vX.Y.Z \
  --domain billing.example.com \
  --email you@example.com
```

Replace `FORGEJO_HOST/OWNER` with the registry namespace the images were published to (the release
notes list the exact image names). The script:

1. checks podman and systemd, warns about linger / unprivileged ports;
2. copies the quadlets to `~/.config/containers/systemd/` (rootless) or `/etc/containers/systemd/` (rootful),
   filling in the image registry and tag;
3. generates `APP_KEY`, `SESSION_SECRET`, the database password and an admin password and writes
   `provisia.env`, `provisia-db.env` and `Caddyfile` to `~/.config/provisia/` (or `/etc/provisia/`), mode 0600.
   Existing files are never overwritten, so re-running is safe;
4. runs `systemctl --user daemon-reload`, starts postgres + valkey, runs the migrate job (with the seed),
   starts api, worker, web and proxy, waits for the API health check and prints the admin login.

Options: `--admin-email`, `--admin-password`, `--no-start` (install only), `-y` (non-interactive),
`--source DIR`. Environment variables `PROVISIA_REGISTRY`, `PROVISIA_TAG`, `PROVISIA_DOMAIN`,
`PROVISIA_ACME_EMAIL`, `PROVISIA_ADMIN_EMAIL`, `PROVISIA_ADMIN_PASSWORD` are read as defaults.

### Private registry

If the packages on your Forgejo are not public, log in once as the service user before installing:
`podman login FORGEJO_HOST`. Rootless podman stores the credential in `${XDG_RUNTIME_DIR}/containers/auth.json`;
for a permanent credential use `podman login --authfile ~/.config/containers/auth.json` (systemd services
read that file).

## 3. Manual install (what the script does)

```sh
# 1. units
mkdir -p ~/.config/containers/systemd ~/.config/provisia
cp deploy/quadlets/*.{container,network,volume} ~/.config/containers/systemd/
sed -i 's#__REGISTRY__#FORGEJO_HOST/OWNER#g; s#__TAG__#vX.Y.Z#g' ~/.config/containers/systemd/provisia-*.container

# 2. configuration (see docs/CONFIGURATION.md for every variable)
cp deploy/quadlets/provisia.env.example ~/.config/provisia/provisia.env
cp deploy/quadlets/provisia-db.env.example ~/.config/provisia/provisia-db.env
cp deploy/caddy/Caddyfile ~/.config/provisia/Caddyfile
chmod 600 ~/.config/provisia/*.env
$EDITOR ~/.config/provisia/provisia.env      # APP_KEY: openssl rand -hex 32, SESSION_SECRET: openssl rand -hex 32,
                                             # PROVISIA_DOMAIN, APP_URL/WEB_URL/NEXT_PUBLIC_API_URL, DATABASE_URL password,
                                             # SMTP_URL, MIGRATE_SEED=true + SEED_ADMIN_* for the first start
$EDITOR ~/.config/provisia/provisia-db.env   # POSTGRES_PASSWORD = the password used in DATABASE_URL

# 3. start
systemctl --user daemon-reload
systemctl --user start provisia-postgres provisia-valkey
systemctl --user start provisia-migrate          # one-shot: migrations + seed
systemctl --user start provisia-api provisia-worker provisia-web provisia-proxy
systemctl --user status 'provisia-*'
```

For a rootful install use `/etc/containers/systemd/`, `/etc/provisia/`, replace `%h/.config/provisia` by
`/etc/provisia` in the unit files, `WantedBy=default.target` by `WantedBy=multi-user.target`, and drop `--user`.

Quadlet files carry `[Install] WantedBy=default.target`, so the stack starts at boot (rootless: at boot thanks
to linger). Dependencies are declared in the units: starting `provisia-proxy` pulls in web and api, which require
postgres, valkey and a successful migrate run.

After the first start set `MIGRATE_SEED=false` and clear `SEED_ADMIN_PASSWORD` in `provisia.env` (the script does
this for you).

## 4. DNS, TLS and the proxy

- Caddy reads `PROVISIA_DOMAIN` and `PROVISIA_ACME_EMAIL` from `provisia.env` and obtains a certificate from
  Let's Encrypt (fallback ZeroSSL) on the first request. Certificates and the ACME account live in the
  `provisia-caddy` volume, so they survive restarts and upgrades.
- Check `journalctl --user -u provisia-proxy -f` while the first certificate is issued. Common failures: DNS
  not propagated, port 80/443 blocked, or rootless podman not allowed to bind them (section 1).
- Internal / test installs: set `PROVISIA_DOMAIN=localhost` (Caddy uses its internal CA; your browser warns) or
  `PROVISIA_DOMAIN=http://billing.lan` to serve plain HTTP. Then also set `APP_URL`, `WEB_URL` and
  `NEXT_PUBLIC_API_URL` to the matching `http://` URL.
- Behind an existing reverse proxy or a CDN: terminate TLS there, point it at `provisia-proxy` on an internal
  port, and keep `X-Forwarded-Proto`/`X-Forwarded-Host`. The Caddyfile trusts private ranges by default
  (`trusted_proxies static private_ranges`).
- Routing: `/api/*` (including `/api/docs`, gateway webhooks `/api/v1/public/webhooks/...`) goes to the API, the
  rest to the web app. Both are same-origin, so no CORS configuration is needed and session cookies are first-party.
- Edit `~/.config/provisia/Caddyfile` for extras (IP allow-list for `/admin`, additional hostnames, custom
  headers) and `systemctl --user restart provisia-proxy`.

## 5. First login

Open `https://billing.example.com/admin` and sign in with the admin e-mail and password printed by the
installer (or `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `provisia.env`). Immediately:

1. Change the admin password (profile menu) and enable two-factor authentication once it is available.
2. Create personal accounts for your staff (role `staff`) instead of sharing the admin login.
3. Settings: company details, VAT number, default currency, invoice numbering prefix, tax rules
   (the seed installs the 27 EU standard rates with NL as home country; review them).

The client portal is `https://billing.example.com/portal`, the OpenAPI reference `https://billing.example.com/api/docs`.

## 6. Configuring SMTP

Outgoing mail (invoices, reminders, ticket notifications) uses the SMTP relay in `SMTP_URL`:

```ini
# ~/.config/provisia/provisia.env
SMTP_URL=smtps://billing%40example.com:APP-PASSWORD@smtp.example.com:465      # implicit TLS
# or STARTTLS:  smtp://user:pass@smtp.example.com:587
MAIL_FROM="Example Hosting <billing@example.com>"
```

URL-encode `@`, `:` and `/` inside the username or password (`@` → `%40`). Then
`systemctl --user restart provisia-api provisia-worker`. Set up SPF, DKIM and DMARC for the sending domain at
your mail provider; Provisia does not sign mail itself. Ticket e-mail piping (IMAP) is configured in the admin
panel per department.

## 7. Configuring a payment gateway

Gateways are modules enabled per installation in **Admin → Settings → Payment gateways**. Credentials are
stored encrypted with `APP_KEY`; nothing goes into `provisia.env`.

1. Open the gateway (for example Mollie or Stripe), paste the API key, save and use "Test credentials".
2. Register the webhook URL shown in the form at the provider, e.g.
   `https://billing.example.com/api/v1/public/webhooks/mollie`. Webhooks are signature-verified and idempotent;
   the provider must be able to reach your hostname on 443.
3. Make a test payment on an unpaid invoice from a client account in the portal. The transaction appears under
   the invoice; the worker's job log (Admin → System → Jobs) shows the processing.

Registrars (Admin → Domains → Registrars) and provisioning servers (Admin → Servers) are configured the same
way; use "Test connection" before assigning products to them. See `docs/MODULES.md` for writing your own.

## 8. Operating the stack

```sh
systemctl --user status 'provisia-*'               # overview
journalctl --user -u provisia-api -f               # logs (also: podman logs provisia-api)
systemctl --user restart provisia-worker           # restart one service
systemctl --user stop provisia-proxy provisia-web provisia-worker provisia-api   # stop the app, keep the db
podman exec -it provisia-postgres psql -U provisia provisia                        # database shell
podman exec provisia-api node -e "fetch('http://127.0.0.1:3001/api/v1/public/health').then(r=>r.json()).then(console.log)"
systemctl --user enable --now podman-auto-update.timer   # unattended image updates (docs/UPGRADE.md)
```

Next: `docs/BACKUP.md` (set up `scripts/backup.sh` on a timer today), `docs/UPGRADE.md`, `docs/CONFIGURATION.md`.
