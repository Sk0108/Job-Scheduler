# Job Scheduler Platform

A production-inspired distributed job scheduling platform: multi-tenant projects and queues,
five job creation modes (immediate, delayed, scheduled, recurring/cron, batch), a worker fleet
that claims and executes jobs concurrently with heartbeats and graceful shutdown, configurable
retry strategies with a dead letter queue, and a live dashboard for operating all of it.

The dashboard includes a drag-and-drop **Board** view (move a job between queues by dragging its
card), a **Calendar** view (jobs by day, color-coded by priority), a collapsible animated sidebar,
priority-coded chips throughout, and live toast notifications on top of the usual charts/tables.

See also: [docs/architecture.md](docs/architecture.md) · [docs/er-diagram.md](docs/er-diagram.md) ·
[docs/api.md](docs/api.md) · [docs/design-decisions.md](docs/design-decisions.md)

## Stack

| Layer | Tech |
|---|---|
| API | Node.js, Express, Prisma, Zod, JWT, Socket.IO |
| Worker | Node.js, Prisma, ioredis (distributed rate limiting) |
| Scheduler | Node.js, Prisma, ioredis (distributed lock) |
| Web | React, Vite, TanStack Query, Recharts, Socket.IO client |
| Data | PostgreSQL 16, Redis 7 |

Monorepo layout (npm workspaces):

```
packages/
  db/         Prisma schema, migrations, seed script
  shared/     Pure logic: retry backoff math, cron helpers, pagination, failure-summary heuristic
  core/       Reliability engine: atomic claim SQL, retry/DLQ lifecycle, dispatch, stats, distributed lock, event bus
  api/        REST API (Express) + Socket.IO live updates
  worker/     Worker service (poll, claim, execute, heartbeat, graceful shutdown)
  scheduler/  Dispatcher (scheduled->queued sweep, cron dispatch, stale-lock reaper)
apps/
  web/        React dashboard
```

`@jsp/core` is the one place claim/retry/DLQ/dispatch logic lives — the API's manual "retry" button,
the worker's automatic retry-on-failure, and the scheduler's crash-recovery reaper all call the same
functions, so there is exactly one implementation of "what happens when a job fails" in the whole system.

## Prerequisites

- Node.js 20+
- Docker (for Postgres + Redis) — or point `DATABASE_URL`/`REDIS_URL` at your own instances

## Setup

```bash
npm install

cp .env.example .env
# The compose file binds Postgres on host port 5433 and Redis on 6380 (not the 5432/6379
# defaults) so this stack doesn't collide with anything else you might have running locally.
# Edit .env if you want different ports/credentials.

docker compose up -d          # Postgres + Redis
npm run db:migrate            # create schema
npm run db:seed               # demo org/project/queues/jobs (see credentials below)
```

Run each service in its own terminal:

```bash
npm run dev:api         # http://localhost:4000
npm run dev:worker       # polls queues, executes jobs
npm run dev:scheduler    # promotes scheduled jobs, dispatches cron, reaps stale claims

cp apps/web/.env.example apps/web/.env
npm run dev:web          # http://localhost:5174
```

Open http://localhost:5174 and log in:

```
admin@demo.io  / Password123!   (OWNER)
member@demo.io / Password123!   (MEMBER)
```

The seed data includes an immediate job, a delayed job, a scheduled job, a 5-job batch, a
recurring cron definition, and a job that's rigged to always fail (`call-unreliable-webhook`) so
you can watch it retry with backoff and land in the Dead Letter Queue within seconds of starting
the worker.

You can run more than one worker process concurrently (just `npm run dev:worker` again in another
terminal) to see multiple workers fairly splitting the same queue's jobs with no duplicate claims.

## Tests

```bash
npm test
```

Runs pure-logic unit tests (retry math, cron, failure classification, the worker's semaphore) plus
integration tests that exercise the real database: concurrent atomic claiming (asserts no job is
ever claimed twice), the retry-vs-dead-letter decision, and full API flows (auth, RBAC, idempotent
job creation) via supertest. Integration suites auto-skip if `DATABASE_URL` isn't reachable, so
`npm test` is safe to run without the docker stack — you just won't cover that part.

## Scripts reference

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Reset demo data (org, project, queues, jobs) |
| `npm run db:generate` | Regenerate the Prisma client after a schema change |
| `npm run dev:api` / `dev:worker` / `dev:scheduler` / `dev:web` | Run a service in watch mode |
| `npm run build` | Production build of every package |
| `npm test` | Full test suite |

## Production notes

- Set real `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` values — the defaults are dev-only.
- `npm run build` then `node dist/index.js` per package (or containerize each with the shared
  `packages/` as build context).
- Run `prisma migrate deploy` (not `migrate dev`) against production databases.
- Scale workers horizontally by running more `worker` processes — claiming is safe under
  concurrency (see [docs/design-decisions.md](docs/design-decisions.md)). Scale the scheduler
  the same way; its per-tick Redis lock keeps replicas from double-dispatching cron jobs.
