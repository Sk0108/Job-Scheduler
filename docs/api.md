# API Documentation

Base URL: `http://localhost:4000/api/v1`. All request/response bodies are JSON.

## Authentication

Two token types, issued as a pair:

- **Access token** (JWT, 15m default) — sent as `Authorization: Bearer <token>` on every
  authenticated request.
- **Refresh token** (JWT + server-side record, 7d default) — exchanged for a new pair via
  `/auth/refresh`. Refresh tokens rotate on use (the old one is revoked the moment a new one is
  issued) and are stored server-side only as a SHA-256 hash, so a leaked database dump doesn't
  expose usable tokens.

```
POST /auth/register   { email, password, name }        -> 201 { user, accessToken, refreshToken }
POST /auth/login       { email, password }              -> 200 { user, accessToken, refreshToken }
POST /auth/refresh      { refreshToken }                -> 200 { user, accessToken, refreshToken }
POST /auth/logout       { refreshToken }                -> 204
GET  /auth/me           (auth required)                 -> 200 { id, email, name, organizations: [{id,name,slug,role}] }
```

## Error format

Every error response has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": { ... } } }
```

| HTTP | code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` / `VALIDATION_ERROR` | Malformed input; `details` holds Zod's field errors |
| 401 | `UNAUTHORIZED` | Missing/invalid/expired token, or bad credentials |
| 403 | `FORBIDDEN` | Authenticated, but the org role doesn't meet the endpoint's minimum |
| 404 | `NOT_FOUND` | Resource doesn't exist (or you can't see it — see below) |
| 409 | `CONFLICT` | Unique constraint violation (duplicate slug, email, etc.) |
| 500 | `INTERNAL_ERROR` | Unhandled server error (logged with a stack trace server-side) |

`404` is returned instead of `403` when a resource simply doesn't exist versus when it exists but
you lack access to its organization, to avoid leaking existence of other tenants' data.

## Pagination & filtering

List endpoints accept `page` (default 1) and `pageSize` (default 25, max 100) and return:

```json
{ "data": [...], "page": 1, "pageSize": 25, "total": 142, "totalPages": 6 }
```

## Authorization model

Every project belongs to an organization; every user's access to a project is derived from their
`OrganizationMember.role` in that organization: `VIEWER < MEMBER < ADMIN < OWNER`. Each endpoint
below lists its minimum role. Nested resources (queues, jobs, job definitions, DLQ entries) resolve
their owning project internally, so `POST /queues/:queueId/jobs` checks your role in the
organization that owns that queue's project — you never pass an org/project id redundantly on
nested routes.

## Organizations & members

```
GET    /organizations                          VIEWER  -> your orgs + your role in each
POST   /organizations           {name,slug}    (any authed user; creator becomes OWNER)
GET    /organizations/:orgId/members            VIEWER
POST   /organizations/:orgId/members  {email,role}  ADMIN  (role: ADMIN|MEMBER|VIEWER; user must already have an account)
PATCH  /organizations/:orgId/members/:memberId {role}  OWNER
DELETE /organizations/:orgId/members/:memberId         ADMIN
```

## Projects

```
GET    /organizations/:orgId/projects                    VIEWER
POST   /organizations/:orgId/projects  {name,slug,description?}  ADMIN
GET    /projects/:projectId                               VIEWER
PATCH  /projects/:projectId            {name?,description?}      ADMIN
DELETE /projects/:projectId                                OWNER
GET    /projects/:projectId/health                        VIEWER  -> SystemHealth (see Metrics)
```

## Retry policies

Named, reusable retry configs a queue can point to as its default (see
[er-diagram.md](er-diagram.md#normalization) for why jobs can also override individual fields
inline instead of requiring a dedicated policy).

```
GET    /projects/:projectId/retry-policies                        VIEWER
POST   /projects/:projectId/retry-policies  {name,strategy,maxRetries,baseDelayMs,maxDelayMs,jitter}  ADMIN
PATCH  /retry-policies/:policyId  {...partial}                     ADMIN
DELETE /retry-policies/:policyId                                    ADMIN
```

`strategy` is one of `FIXED | LINEAR | EXPONENTIAL` — see
[design-decisions.md](design-decisions.md#retry-backoff) for the delay formula.

## Queues

```
GET    /projects/:projectId/queues                                 VIEWER
POST   /projects/:projectId/queues  {name,slug,priority?,concurrencyLimit?,rateLimitPerSecond?,defaultRetryPolicyId?}  ADMIN
GET    /queues/:queueId                                              VIEWER
PATCH  /queues/:queueId  {...partial}                                ADMIN
DELETE /queues/:queueId                                              OWNER
POST   /queues/:queueId/pause                                        MEMBER
POST   /queues/:queueId/resume                                       MEMBER
GET    /queues/:queueId/stats                                        VIEWER
```

`GET /queues/:queueId/stats` response:

```json
{
  "queueId": "...",
  "counts": { "SCHEDULED": 0, "QUEUED": 3, "CLAIMED": 1, "RUNNING": 1, "COMPLETED": 240, "FAILED": 2, "DEAD_LETTER": 1, "CANCELLED": 0 },
  "activeCount": 2,
  "throughputLastHour": 58,
  "avgDurationMsLast100": 312,
  "failureRateLast100": 0.02
}
```

## Jobs

```
POST /queues/:queueId/jobs  MEMBER
{
  "type": "send-welcome-email",
  "payload": { "to": "user@example.com" },
  "priority": 0,
  "runAt": "2026-08-01T12:00:00Z",   // omit for immediate; future timestamp for delayed/scheduled
  "idempotencyKey": "welcome-email-user-123",  // optional; re-posting the same key returns the existing job (200, not 201)
  "maxRetries": 5, "retryStrategy": "EXPONENTIAL", "baseDelayMs": 1000, "maxDelayMs": 300000,  // optional overrides
  "timeoutMs": 30000,
  "dependsOn": ["<jobId>", "..."]     // optional — job stays SCHEDULED until all of these reach COMPLETED
}
-> 201 Job   (or 200 { ...Job, deduplicated: true } on idempotency-key replay)
```

```
POST /queues/:queueId/batches  MEMBER
{ "name": "newsletter-blast", "jobs": [ { "type": "send-newsletter", "payload": {...}, "priority": 0 }, ... ] }
-> 201 Batch
```

```
GET /jobs?projectId=...&queueId=&status=&type=&search=&page=&pageSize=   VIEWER
```
`status` accepts a comma-separated list (e.g. `status=FAILED,DEAD_LETTER`). `search` matches job id
or job type (case-insensitive substring on type).

```
GET  /jobs/:jobId                    VIEWER  -> Job + executions[] + deadLetter[] + dependsOn/dependents + failureSummary
GET  /jobs/:jobId/logs?page=&pageSize=   VIEWER
POST /jobs/:jobId/cancel             MEMBER  (only from QUEUED/SCHEDULED/FAILED)
POST /jobs/:jobId/retry              MEMBER  (only from FAILED/DEAD_LETTER/CANCELLED — resets attempt count, requeues immediately)
POST /jobs/:jobId/move  {queueId}    MEMBER  (only from QUEUED/SCHEDULED/FAILED/DEAD_LETTER/CANCELLED — target queue must be in the same project; powers the dashboard's drag-and-drop board)
```

```
GET /jobs/calendar?projectId=...&from=<ISO datetime>&to=<ISO datetime>   VIEWER
-> { data: [{ id, type, status, priority, runAt, queueId, queue: {name, slug} }] }   (capped at 2000 rows, ordered by runAt — powers the calendar view)
```

`failureSummary` (present only for `FAILED`/`DEAD_LETTER` jobs with at least one execution) is a
rule-based classification of the latest error — see
[design-decisions.md](design-decisions.md#ai-failure-summaries):

```json
{
  "category": "http_5xx",
  "headline": "Downstream service returned a server error",
  "explanation": "A dependency responded with a 5xx status... Attempt 3 of 3 for job type \"call-unreliable-webhook\".",
  "suggestedAction": "Likely transient — verify the downstream provider's status page before escalating.",
  "isTransientGuess": true
}
```

## Recurring (cron) job definitions

```
GET    /queues/:queueId/job-definitions                                    VIEWER
POST   /queues/:queueId/job-definitions
       {name,jobType,cronExpression,timezone?,payload?,priority?,maxRetries?,retryStrategy?,baseDelayMs?,maxDelayMs?,timeoutMs?}  MEMBER
PATCH  /job-definitions/:defId  {...partial}                                MEMBER
DELETE /job-definitions/:defId                                              ADMIN
POST   /job-definitions/:defId/pause                                        MEMBER
POST   /job-definitions/:defId/resume                                       MEMBER
```

`cronExpression` is validated (standard 5-field cron) at create/update time; `nextRunAt` is computed
server-side from `cronExpression` + `timezone` and recomputed every time the scheduler dispatches
a run.

## Dead Letter Queue

```
GET  /dlq?projectId=...&queueId=&page=&pageSize=   VIEWER
POST /dlq/:entryId/retry     MEMBER   -> resets the job and requeues it immediately
POST /dlq/:entryId/resolve   MEMBER   -> marks the DLQ entry resolved without touching the job (e.g. "investigated, ignoring")
```

## Workers

Workers are a shared fleet, not project-scoped (a single worker process can poll queues across
projects) — see [design-decisions.md](design-decisions.md#worker-visibility) for why these two
endpoints are visible to any authenticated user rather than gated per-project.

```
GET /workers              -> [{ id, name, hostname, pid, status, concurrency, activeJobCount, queueFilter, lastHeartbeatAt, isStale }]
GET /workers/:workerId     -> + heartbeats[] (last 50) + activeJobs[] (currently claimed)
```

`isStale` is computed as `now - lastHeartbeatAt > 20s` while `status` isn't already `OFFLINE` — a
worker that crashed without running its graceful-shutdown handler still shows as stale in the UI
even though its DB row says `ONLINE`.

## Metrics

```
GET /metrics/health?projectId=...          VIEWER  -> queued/scheduled/running/deadLetter counts, workersOnline/Total, throughput & failures last hour
GET /metrics/throughput?projectId=...&hours=24  VIEWER  -> hourly {bucket, completed, failed} buckets for the throughput chart
GET /metrics/queues?projectId=...           VIEWER  -> every queue in the project paired with its stats (same shape as GET /queues/:id/stats)
GET /metrics/priority-distribution?projectId=...  VIEWER  -> [{ band: LOW|NORMAL|HIGH|CRITICAL, count }] across non-terminal jobs — powers the dashboard's priority donut chart
```

`GET /queues/:queueId/stats` also includes `durationHistogram: [{ label, count }]` — the last 100
completed/failed executions bucketed into fixed duration ranges (`0-100ms` through `5s+`), used for
the queue detail page's duration chart.

## Live updates (Socket.IO)

Connect to the API's root Socket.IO namespace with `auth: { token: <accessToken> }`, then:

```js
socket.emit("subscribe:project", projectId);
socket.on("job.completed", (event) => { ... });
```

Event types: `job.queued`, `job.claimed`, `job.started`, `job.completed`, `job.failed`,
`job.retry_scheduled`, `job.dead_lettered`, `job.cancelled`, `worker.heartbeat`,
`worker.registered`, `worker.offline`, `queue.updated`. Every event includes at least
`{ type, projectId, timestamp }`, plus `queueId`/`jobId`/`workerId`/`data` where relevant.
