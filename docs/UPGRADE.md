# Upgrading Provisia

Provisia follows semantic versioning. Images are tagged `vX.Y.Z`, `X.Y` and `latest`. Read the release notes
(Forgejo release page / `CHANGELOG.md`) before upgrading; breaking changes and manual steps are listed under
"Breaking changes".

**Always take a backup first**: `scripts/backup.sh` (see `docs/BACKUP.md`). Migrations are forward-only.

## How an upgrade works

1. New images are pulled (`provisia-migrate`, `provisia-api`, `provisia-worker`, `provisia-web`).
2. `provisia-migrate.service` (one-shot) applies pending SQL migrations from the new image. It is `Required` by
   api and worker, so they only (re)start after it succeeded.
3. api, worker and web restart on the new image. Downtime is the restart time (typically 10–30 s); the proxy
   returns 502 meanwhile.

## A. Pinned version (recommended for production)

The quadlets reference an explicit tag when installed with `--tag vX.Y.Z`. To move to a new version:

```sh
cd ~/.config/containers/systemd
sed -i 's#\(provisia-[a-z]*\):v[0-9][^ ]*#\1:vX.Y.Z#' provisia-{api,worker,web,migrate}.container
grep Image= provisia-*.container                       # verify
systemctl --user daemon-reload
systemctl --user restart provisia-migrate              # pulls the new image, runs migrations; api/worker restart via Requires=
systemctl --user restart provisia-web
systemctl --user status 'provisia-*'
journalctl --user -u provisia-migrate -n 50            # "migrations applied" / "done"
```

Pull before restarting to keep the window short: `podman pull FORGEJO_HOST/OWNER/provisia-{api,worker,web,migrate}:vX.Y.Z`.

## B. Floating tag + podman auto-update

With `--tag latest` (or `1.x`) the units carry `AutoUpdate=registry`. `podman auto-update` compares the image
digest with the registry and restarts changed units; `podman-auto-update.timer` does that daily.

```sh
systemctl --user enable --now podman-auto-update.timer   # schedule (daily by default; override with a drop-in)
podman auto-update --dry-run                              # what would change
podman auto-update                                        # pull + restart changed units now
```

Notes:

- All four application images change on a release, so all four units restart. The migrate unit re-runs the
  migrations; api/worker may restart a few seconds before it finished and fail once — systemd restarts them
  (`Restart=always`). Prefer method A if you want zero failed starts.
- `podman auto-update` rolls back a unit automatically when the new container does not become healthy
  (`HealthCmd` + `Notify=healthy` in the units) — the previous image is kept until the update succeeds.
- Pin the major with a `1` or `1.2` tag to receive fixes but no breaking changes.

## Configuration changes

New versions may add environment variables; the release notes say so and `docs/CONFIGURATION.md` is the reference.
Compare your file with the template shipped in the release bundle:

```sh
diff <(sed 's/=.*//' ~/.config/provisia/provisia.env | sort) <(sed 's/=.*//' deploy/quadlets/provisia.env.example | grep -v '^#' | sort)
```

Changed quadlet files (new mounts, health checks) are listed in the notes as well; copy them over as in the
manual install and `systemctl --user daemon-reload`.

## Rollback

Code rolls back by changing the tag back; the **database does not**. Migrations in a release are backwards
compatible with the previous minor version whenever possible (additive columns, no drops in the same release),
so rolling back one minor usually works without restoring the database. If a release notes a destructive
migration, rolling back requires the backup.

```sh
# 1. previous images
sed -i 's#:vX.Y.Z#:vX.Y.(Z-1)#' ~/.config/containers/systemd/provisia-{api,worker,web,migrate}.container
systemctl --user daemon-reload
systemctl --user restart provisia-api provisia-worker provisia-web
# 2. if the schema must go back too: restore the pre-upgrade backup
scripts/restore.sh --db ~/provisia-backups/db-STAMP.dump --storage ~/provisia-backups/storage-STAMP.tar.gz
```

`scripts/restore.sh` stops the app services, restores, runs the migrate job of the *currently configured* image
and starts everything again — so set the tag back before restoring.

## Upgrading the host

- podman / systemd upgrades: `systemctl --user daemon-reload` afterwards; quadlet syntax is stable from 4.4 on.
- PostgreSQL major upgrade (16 → 17): not automatic. Dump with `scripts/backup.sh`, change the image in
  `provisia-postgres.container`, remove (or rename) the `provisia-db` volume, start postgres, restore with
  `scripts/restore.sh --db ...`. Announced in release notes when the supported version changes.
- Node / base image updates come with every release image; no host action.

## Checking a running version

```sh
podman inspect provisia-api --format '{{index .Config.Labels "org.opencontainers.image.version"}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
curl -s https://billing.example.com/api/v1/public/health      # {"status":"ok","version":"X.Y.Z",...}
```
