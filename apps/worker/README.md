# @provisia/worker

BullMQ workers and schedulers. One process consumes every queue (`billing`, `provisioning`, `domains`,
`email`, `maintenance`) with `WORKER_CONCURRENCY` jobs per queue. Every run is recorded in `jobs_log`
(`running → completed | failed`, payload, result, error, attempt) and shown in Admin → Automation.

## Run

```sh
pnpm --filter @provisia/worker dev          # tsx watch
pnpm --filter @provisia/worker build && node apps/worker/dist/index.js
curl -s localhost:3002/health | jq          # see below
```

Environment (validated in `src/index.ts`): `DATABASE_URL`, `REDIS_URL`, `APP_URL`, `WEB_URL`,
`WORKER_CONCURRENCY` (5), `WORKER_HEALTH_PORT` (3002, `0` disables), `WORKER_HEALTH_HOST` (0.0.0.0),
`WORKER_DLQ_MAX` (1000), `LOG_LEVEL`.

## Retry / backoff defaults per queue

Set in `src/queues.ts` (`QUEUE_JOB_OPTIONS`) and applied as the queue's `defaultJobOptions`; a producer
can override per job via `enqueue(queue, name, data, { attempts, backoff })`.

| Queue          | Attempts | Backoff                      | Rationale |
|----------------|----------|------------------------------|-----------|
| `billing`      | 3        | exponential, 5s → 10s → 20s  | DB-only steps, must be idempotent (deterministic `jobId`) |
| `provisioning` | 5        | exponential from 30s (~15 min total) | Panel APIs time out; `create()` must tolerate re-runs |
| `domains`      | 5        | exponential from 60s (~30 min total) | Registrar rate limits / maintenance windows |
| `email`        | 5        | exponential from 10s         | SMTP greylisting |
| `maintenance`  | 1        | none                         | Scheduled; the next tick is the retry |

Completed jobs are removed after 24h (max 1000 kept), failed jobs after 7 days (`DEFAULT_JOB_OPTIONS`).

## Dead-letter policy

When a job fails on its **last** attempt the worker pushes a compact record
(`queue, name, jobId, data, error, attempts, failedAt`) onto the Redis list `provisia:dlq:<queue>`
(newest first, capped at `WORKER_DLQ_MAX`). The BullMQ job stays in the `failed` set for 7 days so it can
be retried; the dead-letter list is the durable, human-readable trail.

- Inspect: `GET /api/v1/admin/automation/dead-letter?queue=email`, `GET /api/v1/admin/automation/queues`.
- Retry: `POST /api/v1/admin/automation/jobs/:jobsLogId/retry` — uses BullMQ `job.retry()` when the job
  still exists, otherwise re-enqueues the stored payload with `attempts: 1`.
- The daily automation summary (`maintenance:dailySummary`, key `admin.notification`) reports failures and
  dead-letter depth per queue to every active admin (or `automation.summaryRecipients`).
- Nothing is retried automatically after exhaustion: the handler either has a bug or the external system
  needs human attention. Clear the list with `DEL provisia:dlq:<queue>` after triage.

## Schedules

`src/schedules.ts` (scheduler id `queue:name`, visible via `GET /admin/automation/schedules`, triggerable via
`POST /admin/automation/run/queue:name`). Maintenance jobs (`src/jobs/maintenance.ts`):

| Job | When | What |
|---|---|---|
| `heartbeat` | every 5 min | proves schedulers run; stored in Redis `worker:heartbeat` and used by `/health` |
| `cleanupSessions` | every 30 min | delete expired `sessions` |
| `cleanupTokens` | hourly | delete used/expired `auth_tokens` (>24h) |
| `pruneJobsLog` | 02:20 | delete `jobs_log` older than `automation.jobsLogRetentionDays`; mark `running` >24h as failed |
| `pruneActivityLog` | 02:40 | delete `activity_log` older than `automation.activityLogRetentionDays` |
| `cleanupTempStorage` | hourly | delete entries in `storage.tempPath` older than `automation.tempFileMaxAgeHours` |
| `dailySummary` | 06:00 | automation summary email to admins |

## `/health`

`GET http://<worker>:3002/health` → `200 ok` or `503 degraded`:

```json
{
  "status": "ok", "pid": 123, "startedAt": "...", "uptimeSeconds": 42, "stopping": false,
  "lastHeartbeatAt": "...", "concurrency": 5,
  "queues": { "email": { "waiting": 0, "active": 1, "delayed": 0, "failed": 2, "deadLetter": 0, "lastCompletedAt": "..." } }
}
```

Degraded when Redis is unreachable, a worker stopped, shutdown is in progress, or no heartbeat completed in
the last 15 minutes (three missed runs). Use it as the container health check / readiness probe.

## Graceful shutdown

`SIGTERM`/`SIGINT`: the health server closes, every worker waits for its active jobs (`worker.close()`),
producer queues and Redis connections close, then the process exits 0. Give the container at least the
longest expected job duration as stop grace period (provisioning: 2–3 minutes).

## Adding a job

See docs/FOUNDATION.md §8: payload line in `JobPayloads`, handler in `src/jobs/<queue>/<job>.ts`,
one line in `src/jobs/index.ts`, optional schedule line in `src/schedules.ts`.
