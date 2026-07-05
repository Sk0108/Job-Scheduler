# Design Decisions

Major trade-offs made while building this platform, and why. Each section states the decision,
the alternative considered, and why the alternative lost for this project's scale and goals.

## Postgres as the queue, not a message broker

**Decision:** Jobs live in a Postgres table; atomic dequeue uses `FOR UPDATE SKIP LOCKED` inside a
single `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)` statement
(`packages/core/src/claim.ts`), not SQS/Kafka/RabbitMQ/BullMQ-on-Redis.

**Alternative:** A dedicated broker gives you push-based delivery and generally higher raw
throughput ceilings.

**Why Postgres won here:** Job state (status, attempt count, retry history, DLQ) and queue state
(what's claimable right now) are the same data — splitting them across a broker and a database
means either a dual-write (broker says "claimed", DB says something else, and now they can
disagree) or treating the broker as the source of truth and losing SQL's ability to answer "show
me every FAILED job in this queue created this week" without exporting broker state into a
database anyway. A single ACID store removes an entire class of consistency bugs. The throughput
ceiling of `SKIP LOCKED` claiming (measured, not assumed, in
`claim.integration.test.ts`) is well past what an internal job scheduler needs; the point where a
broker's throughput actually matters is a different scale of system than this one.

**Trade-off accepted:** No push-based delivery — workers poll (default every 750ms,
`WORKER_POLL_INTERVAL_MS`). At very high job volumes, poll-based claiming would eventually need
either shorter intervals (more DB load) or `LISTEN/NOTIFY` to wake workers early. Not needed at
this scale; noted as the first thing to revisit if throughput requirements grow by an order of
magnitude.

## Retry backoff formula and jitter

**Decision:** Three strategies (`packages/shared/src/retry.ts`): `FIXED` (constant delay),
`LINEAR` (`baseDelay * attempt`), `EXPONENTIAL` (`baseDelay * 2^(attempt-1)`), each capped at
`maxDelayMs` and then jittered ±25% by default.

**Why jitter is on by default:** Without it, every job of the same type that fails at the same
time retries at exactly the same future instant — the classic thundering-herd-on-retry problem.
Full ±25% jitter is a reasonable default; it's a per-policy flag (`jitter: boolean`) rather than
hardcoded, so a policy that needs precise retry timing can turn it off.

## `@map`'d snake_case columns + raw SQL for the claim/dispatch queries

**Decision:** Every Prisma field is explicitly `@map("snake_case")`'d to a conventional Postgres
column name, and the atomic claim, dependency-aware sweep, and throughput-bucketing queries are
hand-written SQL via `prisma.$queryRaw`/`$executeRaw` rather than Prisma's query builder.

**Why:** Prisma's query builder cannot express `FOR UPDATE SKIP LOCKED`, and doing the
claim as "SELECT candidates, then UPDATE by id" in two round trips reopens the exact race two
concurrent workers would hit — a second worker could select the same candidate rows before the
first worker's UPDATE commits. It has to be one statement. Similarly, `date_trunc('hour', ...)`
bucketing for the throughput chart and the dependency `NOT EXISTS` check in the scheduler's sweep
have no clean query-builder equivalent. Raw SQL sees actual column names, so the schema is
explicitly mapped to snake_case (matching normal Postgres convention) rather than leaving Prisma's
implicit default (verbatim camelCase column names, which would need quoting everywhere in raw SQL
and reads oddly next to hand-written Postgres).

**Trade-off accepted:** Raw SQL isn't refactor-safe the way Prisma's builder is — renaming a field
requires updating both the schema `@map` and any raw SQL that references the column. Confined to a
small number of files in `packages/core`, all covered by integration tests that would catch a
drift immediately (as one did during development — see below).

## Redis pub/sub as the event bus between background processes and the dashboard

**Decision:** The worker and scheduler publish lifecycle events to a Redis channel
(`packages/core/src/events.ts`); only the API process holds a Socket.IO server and relays events
into per-project rooms.

**Alternative:** Give the worker/scheduler their own Socket.IO servers, or have the dashboard poll
only.

**Why:** Worker and scheduler processes have no reason to accept inbound HTTP/WebSocket
connections — they're pure background compute. Routing all dashboard-facing traffic through the
one process that's already a web server (the API) keeps the background processes' attack surface
and operational surface (ports, TLS, CORS) at zero. Redis pub/sub is already a dependency (rate
limiting, distributed lock), so this adds no new infrastructure.

**Trade-off accepted:** An event published while no API instance is subscribed is simply lost
(fire-and-forget pub/sub, no replay). This is fine because the dashboard's 5-second poll is the
correctness baseline — a dropped WebSocket event costs at most one poll interval of staleness, never
incorrect data.

## Distributed lock for the scheduler, not just documentation saying "run one"

**Decision:** Each scheduler tick acquires a Redis `SET NX PX` mutex (`packages/core/src/lock.ts`)
before sweeping/dispatching/reaping.

**Why:** "Just run one scheduler" is an operational instruction that gets violated the first time
someone deploys a second replica for availability during a rolling restart — and unlike claiming
(which is safe under concurrency by construction), naive concurrent cron dispatch is *not*
safe: two replicas could both see the same due `JobDefinition`, both create a `Job`, and only
then race to update `nextRunAt` — producing a duplicate execution of a scheduled task. A lock
around the whole tick makes concurrent replicas safe by construction instead of by operational
policy.

## Distributed, not per-worker, rate limiting

**Decision:** A queue's `rateLimitPerSecond` is enforced via a Redis counter keyed by
`queueId + current second` (`packages/worker/src/rate-limiter.ts`), shared across every worker
process, rather than each worker limiting itself independently.

**Why:** Per-worker limiting would mean the effective limit scales with worker count (5 workers ×
"10/sec each" = 50/sec, not 10/sec) — which defeats the purpose of a rate limit meant to protect a
downstream dependency. A shared counter keeps the limit meaning what it says regardless of fleet
size.

**Trade-off accepted:** The counter uses an increment-then-correct pattern rather than a Lua
script, so there's a narrow window where concurrent workers could momentarily over-reserve before
self-correcting. Acceptable for a rate limiter whose job is "protect a downstream API from being
hammered," not "enforce an exact quota."

## Organization-level RBAC, not per-project roles

**Decision:** A user's permissions are determined by their `OrganizationMember.role`
(`OWNER > ADMIN > MEMBER > VIEWER`) in the organization that owns a project — there's no separate
per-project role table.

**Why:** The brief's core requirement is "each project can own multiple job queues" under an
organization, not fine-grained per-project ACLs within one org. Org-level roles cover the
realistic case (an ops team shares access to all of an org's projects) with one join instead of
two, and every nested resource (queue → project → org, job → queue → project → org) resolves its
access check the same way (`packages/api/src/lib/access.ts`). If per-project overrides become a
real requirement, the natural extension is an optional `ProjectMember` table that, when present
for a user, overrides their org-level role for that one project — additive, not a rewrite.

## Worker visibility is fleet-wide, not project-scoped {#worker-visibility}

**Decision:** `GET /workers` returns every worker in the system to any authenticated user; the
`Worker` table has no `projectId` foreign key.

**Why:** A single worker process polls queues by a `queueFilter` (default `"*"`), which can span
multiple projects/organizations — a worker fundamentally isn't owned by one tenant the way a queue
is. Modeling it as project-scoped would be fiction. Treating the worker fleet page as
infrastructure-operator visibility (like an internal ops dashboard) rather than tenant-scoped data
matches what a worker actually is.

## Job-level retry overrides instead of mandatory per-job policies

Covered in depth in [er-diagram.md § Normalization](er-diagram.md#normalization) — summary: jobs
carry optional retry-field overrides that fall back to the queue's named `RetryPolicy`, so the
common case (inherit the queue default) stays normalized while a one-off override doesn't require
minting a throwaway policy row.

## Workflow dependencies via a self-join, enforced in the sweep

**Decision:** `JobDependency` is a simple `(jobId, dependsOnJobId)` self-join on `Job`. A job
created with `dependsOn` is forced into `SCHEDULED` regardless of its own `runAt`, and the
scheduler's due-job sweep excludes any job with an incomplete prerequisite via a `NOT EXISTS`
subquery.

**Why not a full DAG/workflow engine:** The brief lists workflow dependencies as a bonus feature,
not the core deliverable. A self-join plus one `NOT EXISTS` clause gets "job B doesn't start until
job A completes" (and transitively, chains of these) correct with no new tables or processes,
reusing the exact same `SCHEDULED → QUEUED` promotion path every other scheduled job goes through.
It does not detect dependency cycles at creation time — a determined caller could create a cycle
that would deadlock its member jobs in `SCHEDULED` forever. Acceptable for a bonus feature; a
production system built around heavy workflow use would want cycle detection on `JobDependency`
creation.

## Priority as a severity color, not a categorical identity

**Decision:** A job's `priority` (0-100) is bucketed into 4 quartile bands (Low/Normal/High/
Critical, `apps/web/src/lib/priority.ts`) and rendered with the same fixed, non-themed
good→warning→serious→critical color ramp used for status/severity elsewhere in the design system,
rather than an arbitrary gradient or a categorical hue.

**Why:** Priority is an urgency signal — it has a natural order (higher is more urgent) — not an
identity to distinguish unrelated things by (which is what categorical color is for). The
good/warning/serious/critical ramp already encodes exactly that ordinal severity relationship, so
reusing it for priority is semantically correct, not just visually convenient. Every place a
priority color appears (job table, board cards, calendar dots) also renders the band's text label
(`Low`/`Normal`/`High`/`Critical`), so the color is never the only carrier of meaning.

## Drag-and-drop moves a job's queue, not its schedule or state

**Decision:** The board view's drag-and-drop (`POST /jobs/:jobId/move`) only ever changes a job's
`queueId`. It's disabled (server-side, not just in the UI) for jobs that are `CLAIMED`/`RUNNING`.

**Why:** Letting a drag silently reschedule (`runAt`) or reprioritize a job in addition to moving
it would make one gesture do three different things depending on where you dropped it — surprising
and hard to reason about. Re-queuing/rescheduling already have their own explicit actions (retry
button, job creation form); the board's one job is queue placement. Blocking the move server-side
(not just graying out the card client-side) matters because the check has to hold even if a client
sends the request directly — the same reasoning as every other state-transition guard in this
system.

## Calendar view: a capped read, not a paginated one

**Decision:** `GET /jobs/calendar` returns up to 2000 jobs in a date range, unpaginated, rather
than reusing the cursor-paginated `/jobs` list endpoint.

**Why:** A month grid needs every job in range in memory at once to bucket by day and render dots
— paginating it would mean either N page-fetches before the grid can render a single cell, or a
grid that renders incrementally in a visually incoherent order. 2000 is a hard ceiling, not a
tuned capacity number: a project scheduling enough jobs per month to hit it has outgrown a
month-grid overview anyway and needs the filtered `/jobs` explorer instead, which the calendar's
day-click popover deliberately routes into (each job in the popover links to its detail page, and
from there the full job explorer with proper pagination is one click away).

## AI failure summaries: rule-based, with an explicit LLM seam {#ai-failure-summaries}

**Decision:** `packages/shared/src/failure-summary.ts` pattern-matches an error message/stack
against known categories (timeout, network, HTTP 5xx, auth, validation, resource exhaustion) and
returns a structured `{ category, headline, explanation, suggestedAction, isTransientGuess }`,
rather than calling an LLM.

**Why:** No LLM API key is provisioned in this environment, and a heuristic classifier is
deterministic and free to run on every failed job without per-call cost or latency. The function's
input/output contract is intentionally LLM-shaped — `summarizeFailure(input): FailureSummary` — so
swapping the body for a real LLM API call (feeding it the error message, stack, and recent
error history, asking for the same structured fields) is a one-function change with zero call-site
impact across the API and dashboard.

## Idempotent job creation via a unique constraint, not application-level locking

**Decision:** `(queueId, idempotencyKey)` is a unique index; job creation attempts an insert and,
on a unique-violation, fetches and returns the existing row with `deduplicated: true` instead of
pre-checking for existence.

**Why:** A check-then-insert would race under concurrent duplicate submissions (two requests both
check "does it exist?", both see no, both insert) — exactly the kind of bug this platform's claim
logic is built to avoid elsewhere. Letting the database's unique constraint be the source of truth
and handling the resulting `P2002` error is race-free by construction.

## Access tokens in `localStorage`, not an httpOnly cookie

**Decision:** The dashboard stores the JWT access/refresh token pair in `localStorage`
(`apps/web/src/api/client.ts`) and attaches it as an `Authorization` header.

**Trade-off:** `localStorage` is readable by any script on the page, so it's more exposed to XSS
than an httpOnly cookie would be. It was chosen for this project because the API and dashboard are
served from different origins/ports in dev (`:4000` vs `:5174`) and a header-based bearer token
avoids cookie SameSite/CORS-credentials configuration entirely. A production deployment behind one
domain should move to httpOnly, SameSite=Strict cookies for the refresh token at minimum.

## Known limitations

- **Stale worker rows aren't auto-reaped.** If a worker process is killed without receiving
  `SIGTERM` (e.g. `kill -9`, host crash), its `Worker` row stays `status: ONLINE` forever — nothing
  currently sweeps worker rows the way `reapStaleClaims` sweeps job claims. Mitigated, not solved:
  the API computes `isStale` from `lastHeartbeatAt` age so the dashboard visibly flags it, but the
  row itself persists. A production version would add a scheduler task that flips workers to
  `OFFLINE` past a heartbeat-age threshold.
- **No cycle detection on `JobDependency`.** See above.
- **Single-region Postgres/Redis.** No read replicas, no cross-region failover — appropriate for
  this project's scope, not for a globally-distributed deployment.
- **Queue sharding is schema-ready but not implemented.** Every queue-scoped query is already
  keyed by `queueId` with no cross-queue joins on the hot path, so sharding queues across multiple
  Postgres instances by `queueId` hash would not require a schema change — just a routing layer
  the API/worker don't currently have.

## Testing strategy: real database, not mocks

Integration tests (`*.integration.test.ts`) run against a real Postgres instance rather than
mocking Prisma — the two bugs this caught during development (an unmapped column name, and a
`::uuid` cast against a `text` column) are exactly the class of bug that a mocked Prisma client
would never surface, because the mock would happily "succeed" against SQL that real Postgres
rejects. They auto-skip (not fail) when `DATABASE_URL` is unreachable, so `npm test` stays safe to
run without the docker stack while still being the primary correctness check when it's available.
