# Entity-Relationship Diagram

Source of truth: [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma).

```mermaid
erDiagram
    USER ||--o{ ORGANIZATION_MEMBER : "has memberships"
    USER ||--o{ REFRESH_TOKEN : "owns"
    USER ||--o{ JOB : "created (optional)"
    ORGANIZATION ||--o{ ORGANIZATION_MEMBER : has
    ORGANIZATION ||--o{ PROJECT : owns
    PROJECT ||--o{ API_KEY : has
    PROJECT ||--o{ RETRY_POLICY : defines
    PROJECT ||--o{ QUEUE : owns
    PROJECT ||--o{ BATCH : owns
    RETRY_POLICY ||--o{ QUEUE : "default for"
    QUEUE ||--o{ JOB : contains
    QUEUE ||--o{ JOB_DEFINITION : contains
    QUEUE ||--o{ BATCH : contains
    JOB_DEFINITION ||--o{ JOB : spawns
    BATCH ||--o{ JOB : groups
    JOB ||--o{ JOB_EXECUTION : "attempt history"
    JOB ||--o{ JOB_LOG : "log lines"
    JOB ||--o{ DEAD_LETTER_ENTRY : "if exhausted"
    JOB ||--o{ JOB_DEPENDENCY : "depends on (self-referencing)"
    WORKER ||--o{ JOB : "currently claims"
    WORKER ||--o{ JOB_EXECUTION : ran
    WORKER ||--o{ WORKER_HEARTBEAT : emits
    JOB_EXECUTION ||--o{ JOB_LOG : "log lines"

    USER {
        uuid id PK
        string email UK
        string password_hash
        boolean is_active
    }
    ORGANIZATION {
        uuid id PK
        string slug UK
    }
    ORGANIZATION_MEMBER {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        enum role "OWNER|ADMIN|MEMBER|VIEWER"
    }
    PROJECT {
        uuid id PK
        uuid organization_id FK
        string slug "unique per org"
    }
    RETRY_POLICY {
        uuid id PK
        uuid project_id FK
        enum strategy "FIXED|LINEAR|EXPONENTIAL"
        int max_retries
        int base_delay_ms
        int max_delay_ms
    }
    QUEUE {
        uuid id PK
        uuid project_id FK
        string slug "unique per project"
        int priority
        int concurrency_limit
        int rate_limit_per_second "nullable"
        boolean is_paused
        uuid default_retry_policy_id FK "nullable"
    }
    JOB_DEFINITION {
        uuid id PK
        uuid queue_id FK
        string cron_expression
        timestamp next_run_at "indexed"
        boolean is_paused
    }
    BATCH {
        uuid id PK
        uuid project_id FK
        uuid queue_id FK
        int total_jobs
        int completed_jobs
        int failed_jobs
        enum status
    }
    JOB {
        uuid id PK
        uuid queue_id FK
        uuid batch_id FK "nullable"
        uuid job_definition_id FK "nullable"
        uuid claimed_by_worker_id FK "nullable"
        uuid created_by_id FK "nullable"
        string idempotency_key "nullable, unique with queue_id"
        enum status "SCHEDULED|QUEUED|CLAIMED|RUNNING|COMPLETED|FAILED|DEAD_LETTER|CANCELLED"
        int priority
        timestamp run_at "indexed"
        int attempt
        timestamp lock_expires_at
    }
    JOB_DEPENDENCY {
        uuid id PK
        uuid job_id FK
        uuid depends_on_job_id FK
    }
    JOB_EXECUTION {
        uuid id PK
        uuid job_id FK
        uuid worker_id FK "nullable"
        int attempt_number
        enum status "RUNNING|COMPLETED|FAILED|TIMED_OUT"
        int duration_ms
    }
    JOB_LOG {
        uuid id PK
        uuid job_id FK
        uuid execution_id FK "nullable"
        enum level
        string message
    }
    DEAD_LETTER_ENTRY {
        uuid id PK
        uuid job_id FK
        uuid queue_id FK
        int attempts_made
        json payload_snapshot
        timestamp resolved_at "nullable"
    }
    WORKER {
        uuid id PK
        string hostname
        int pid
        enum status "ONLINE|BUSY|DRAINING|OFFLINE"
        timestamp last_heartbeat_at
    }
    WORKER_HEARTBEAT {
        uuid id PK
        uuid worker_id FK
        int active_job_count
        float cpu_load "nullable"
    }
```

## Design notes

### Primary keys
Every table uses a `uuid` primary key (`@default(uuid())`), generated application-side rather than
via a database sequence. This lets the API construct a job's ID before insert (useful for
idempotent client retries) and avoids leaking row counts, and it means IDs are globally unique
across tables without coordination — relevant if this schema is ever sharded (see
[design-decisions.md](design-decisions.md#queue-sharding)).

### Foreign keys and cascading behavior
- **`Organization → Project → Queue → Job`** cascade on delete (`onDelete: Cascade`). Deleting a
  project is meant to delete everything it owns — there's no use case for an orphaned queue.
- **`Job → JobExecution/JobLog/DeadLetterEntry`** also cascade — execution history has no meaning
  independent of its job.
- **Nullable, `SetNull` foreign keys** are used wherever the referenced row is allowed to disappear
  without invalidating the referencing row: `Queue.defaultRetryPolicyId`, `Job.claimedByWorkerId`,
  `Job.createdById`, `Job.batchId`, `Job.jobDefinitionId`. A worker being decommissioned shouldn't
  delete the jobs it once ran; the job's `lastError`/history stands on its own.
- **`JobDependency`** is a many-to-many self-join on `Job` (`dependsOnJobId` / `jobId`), both
  `onDelete: Cascade` — deleting either side of a dependency edge removes just that edge.

### Indexes
Indexes are chosen for the two access patterns that actually run at high frequency, not
speculatively:
- `Job(queueId, status, priority, runAt)` — the exact filter/sort the atomic claim query uses
  (`WHERE queue_id = ? AND status = 'QUEUED' AND run_at <= now() ORDER BY priority DESC, run_at ASC`).
  This is the hottest query in the system; it's a covering index for it.
- `Job(status, runAt)` — the scheduler's system-wide sweep for due `SCHEDULED` jobs, independent of
  queue.
- `JobDefinition(nextRunAt)` — the cron dispatcher's "what's due" query.
- `JobLog(jobId, timestamp)` and `JobExecution(jobId)` — the job detail page's execution/log
  history, always fetched by job.
- `WorkerHeartbeat(workerId, timestamp)` — heartbeat history for a single worker's chart.

Every foreign key column not already covered by one of the above also has its own index
(`batchId`, `jobDefinitionId`, `claimedByWorkerId`, etc.) so cascading deletes and dashboard
lookups by parent don't table-scan.

### Normalization
The schema is in 3NF with one deliberate denormalization: `Job` carries its own optional
`maxRetries` / `retryStrategy` / `baseDelayMs` / `maxDelayMs` / `timeoutMs` columns that, when
`NULL`, fall back to the queue's `defaultRetryPolicy`. This is a conscious trade-off — modeling it
"purely" would mean every job always points at a `RetryPolicy` row, but then a one-off override for
a single job (e.g. "this one job needs 10 retries, not the queue's usual 3") would require minting
a throwaway policy row for no reuse. The override columns keep the common case (inherit the
queue's policy) fully normalized while making the uncommon case (per-job override) cheap. See
`resolveRetryPolicy` in `packages/core/src/lifecycle.ts` for the precedence rule.

### Performance considerations
- `Job.payload`, `JobDefinition.payload`, `JobExecution.resultPayload`, `DeadLetterEntry.payloadSnapshot`,
  and `JobLog.metadata` are all `Json` columns (Postgres `jsonb`) rather than normalized tables —
  job payloads are arbitrary, application-defined shapes that are only ever read/written whole,
  never queried by internal field, so `jsonb` is strictly better here than EAV-style normalization.
- `JobExecution` (one row per attempt) is kept separate from `Job` (one row per logical job)
  specifically so retry history is queryable without ever mutating past attempts — `Job.attempt`
  is a fast-path counter, `JobExecution` is the audit trail.
- All timestamp columns needed for time-range queries (`runAt`, `createdAt`, `completedAt`,
  `movedAt`, heartbeat `timestamp`) are plain `timestamp` types indexed where they're filtered on,
  so the dashboard's "last hour" / "last 24h" aggregations stay index-range-scans rather than full
  table scans as the tables grow.
