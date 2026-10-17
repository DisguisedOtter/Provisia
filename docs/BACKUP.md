# Backup and restore

What must be backed up, in order of importance:

| Data | Where | Why |
|---|---|---|
| `provisia.env` (contains **`APP_KEY`**) | `~/.config/provisia/` or `/etc/provisia/` | Gateway/registrar/server credentials in the database are AES-256-GCM encrypted with this key. Without it they are unrecoverable; everything else can be re-entered. |
| PostgreSQL database | volume `provisia-db` | Clients, invoices (legally required retention: 7 years in NL), services, domains, tickets, settings, audit log. |
| Storage volume | volume `provisia-storage` | Generated invoice PDFs, ticket attachments, uploads. PDFs can be regenerated, attachments cannot. |
| `Caddyfile`, `provisia-db.env` | config dir | Small; restored together with `provisia.env`. |
| Valkey (`provisia-redis`) | volume | **Not backed up**: queue state only. Jobs are re-created from the database; schedulers re-register on worker start. |

## scripts/backup.sh

```sh
scripts/backup.sh                       # -> ~/provisia-backups (rootless) or /var/backups/provisia (rootful)
scripts/backup.sh --dest /mnt/backup/provisia --keep-days 30
scripts/backup.sh --no-config           # skip the config archive (if you store secrets elsewhere)
scripts/backup.sh --age-recipient age1...   # encrypt every file with age (https://age-encryption.org)
scripts/backup.sh --gpg-recipient backups@example.com   # or with gpg
```

The recipient can also come from `PROVISIA_BACKUP_AGE_RECIPIENT` / `PROVISIA_BACKUP_GPG_RECIPIENT` (handy in a
systemd timer). Encrypted runs write `*.age` / `*.gpg` files; `restore.sh` decrypts them transparently (set
`PROVISIA_BACKUP_AGE_IDENTITY=/path/to/key.txt` for age). Keep the private key **outside** the backup set.

Produces, per run (`STAMP` = UTC time):

- `db-STAMP.dump` — `pg_dump -Fc` (custom format, compressed, consistent snapshot; taken through
  `podman exec provisia-postgres`, no client tools needed on the host)
- `storage-STAMP.tar.gz` — `podman volume export provisia-storage`
- `config-STAMP.tar.gz` — the configuration directory (**contains secrets**, mode 0600)
- `manifest-STAMP.sha256`

Files older than `--keep-days` (default 14, `PROVISIA_BACKUP_KEEP_DAYS`) are deleted from the destination.
The script is safe while the stack is running. Exit code is non-zero on any failure, so a timer/cron shows it.

### Schedule it (systemd user timer)

```ini
# ~/.config/systemd/user/provisia-backup.service
[Unit]
Description=Provisia backup
[Service]
Type=oneshot
ExecStart=%h/provisia/scripts/backup.sh --dest %h/provisia-backups --keep-days 14

# ~/.config/systemd/user/provisia-backup.timer
[Unit]
Description=Daily Provisia backup
[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=15m
Persistent=true
[Install]
WantedBy=timers.target
```

```sh
systemctl --user daemon-reload && systemctl --user enable --now provisia-backup.timer
systemctl --user list-timers provisia-backup.timer
```

### Off-site copy

A backup on the same disk is not a backup. Sync the destination directory to another machine or object storage
after each run, for example with `restic` (encrypted, deduplicated) or `rclone`:

```sh
restic -r sftp:backup@backup.example.com:/provisia backup ~/provisia-backups
rclone sync ~/provisia-backups s3:my-bucket/provisia --max-age 2d
```

Because `config-*.tar.gz` contains `APP_KEY` and the database password, run the script with
`--age-recipient` / `--gpg-recipient` (recommended), encrypt the transport/storage (restic does; for rclone use a
`crypt` remote), or keep the config archive on a separate secure channel (password manager) and run the script
with `--no-config`. An unencrypted run logs a reminder.

## Restore

### Full restore on a new server

1. Install podman, create the user (docs/INSTALL.md section 1).
2. Restore the configuration: `mkdir -p ~/.config && tar -C ~/.config -xzf config-STAMP.tar.gz`
   (gives `~/.config/provisia/{provisia.env,provisia-db.env,Caddyfile}`). For a rootful target extract to `/etc/`.
3. Install the units without starting the app: `scripts/install.sh --registry ... --tag ... --no-start`
   (it keeps the restored env files, only writes the quadlets).
4. `systemctl --user start provisia-postgres` and restore:

```sh
scripts/restore.sh --db db-STAMP.dump --storage storage-STAMP.tar.gz
```

`restore.sh` stops api/worker/web/proxy, terminates connections, runs `pg_restore --clean --if-exists` into
the `provisia` database, empties and imports the storage volume, runs the migrate job (so a dump from an
older version is brought up to the installed schema) and starts the services again.

5. Point DNS at the new server; Caddy requests a new certificate (or restore the `provisia-caddy` volume
   with `podman volume import` to keep the old one).

### Partial

- Only the database: `scripts/restore.sh --db db-STAMP.dump`
- One table or a single invoice: `pg_restore -Fc -t invoices --data-only ...` into a scratch database
  (`podman exec -i provisia-postgres pg_restore -U provisia -d scratch ... < db-STAMP.dump`) and copy rows with `psql`.
- Only files: `gzip -dc storage-STAMP.tar.gz | podman volume import provisia-storage -` (stop api/worker first).

### Verify restores

Test the restore procedure on a staging machine at least once per quarter: restore, log in, open an invoice
PDF, check that a gateway "Test credentials" still succeeds (proves `APP_KEY` matches the data).

## Retention and legal notes

- Dutch tax law requires keeping invoices and the underlying administration for 7 years. Keep (at least)
  yearly database dumps for that period, outside the rolling window.
- Backups contain personal data (GDPR): encrypt them, restrict access, and include them in your data retention
  policy / register of processing activities.
