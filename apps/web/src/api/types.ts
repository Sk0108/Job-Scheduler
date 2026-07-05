export type OrgRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type JobStatus = "SCHEDULED" | "QUEUED" | "CLAIMED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD_LETTER" | "CANCELLED";
export type RetryStrategy = "FIXED" | "LINEAR" | "EXPONENTIAL";
export type ExecutionStatus = "RUNNING" | "COMPLETED" | "FAILED" | "TIMED_OUT";
export type WorkerStatus = "ONLINE" | "BUSY" | "DRAINING" | "OFFLINE";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: OrgRole;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description?: string | null;
  createdAt: string;
}

export interface RetryPolicy {
  id: string;
  projectId: string;
  name: string;
  strategy: RetryStrategy;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export interface Queue {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description?: string | null;
  priority: number;
  concurrencyLimit: number;
  rateLimitPerSecond?: number | null;
  isPaused: boolean;
  defaultRetryPolicyId?: string | null;
  defaultRetryPolicy?: RetryPolicy | null;
  _count?: { jobs: number };
  createdAt: string;
}

export interface DurationBucket {
  label: string;
  count: number;
}

export interface QueueStats {
  queueId: string;
  counts: Record<string, number>;
  activeCount: number;
  throughputLastHour: number;
  avgDurationMsLast100: number | null;
  failureRateLast100: number;
  durationHistogram: DurationBucket[];
}

export interface SystemHealth {
  totalJobs: number;
  queued: number;
  scheduled: number;
  running: number;
  deadLetter: number;
  workersOnline: number;
  workersTotal: number;
  throughputLastHour: number;
  failedLastHour: number;
}

export interface Job {
  id: string;
  queueId: string;
  batchId?: string | null;
  jobDefinitionId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  status: JobStatus;
  idempotencyKey?: string | null;
  runAt: string;
  attempt: number;
  maxRetries?: number | null;
  retryStrategy?: RetryStrategy | null;
  timeoutMs?: number | null;
  claimedByWorkerId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  queue?: { id: string; name: string; slug: string };
}

export interface JobExecution {
  id: string;
  jobId: string;
  workerId?: string | null;
  attemptNumber: number;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  resultPayload?: unknown;
  errorMessage?: string | null;
  errorStack?: string | null;
  worker?: { id: string; name: string; hostname: string } | null;
}

export interface JobLog {
  id: string;
  jobId: string;
  executionId?: string | null;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

export interface DeadLetterEntry {
  id: string;
  jobId: string;
  queueId: string;
  reason: string;
  lastError?: string | null;
  attemptsMade: number;
  payloadSnapshot: unknown;
  movedAt: string;
  resolvedAt?: string | null;
  job?: { id: string; type: string; attempt: number; queueId: string };
}

export interface JobDefinition {
  id: string;
  queueId: string;
  name: string;
  jobType: string;
  cronExpression: string;
  timezone: string;
  payload: Record<string, unknown>;
  priority: number;
  isPaused: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
}

export interface FailureSummary {
  category: string;
  headline: string;
  explanation: string;
  suggestedAction: string;
  isTransientGuess: boolean;
}

export interface JobDetail extends Job {
  executions: JobExecution[];
  deadLetter: DeadLetterEntry[];
  dependsOn: { dependsOnJob: { id: string; type: string; status: JobStatus } }[];
  dependents: { job: { id: string; type: string; status: JobStatus } }[];
  failureSummary: FailureSummary | null;
}

export interface WorkerRow {
  id: string;
  name: string;
  hostname: string;
  pid: number;
  status: WorkerStatus;
  concurrency: number;
  queueFilter: string;
  activeJobCount: number;
  startedAt: string;
  lastHeartbeatAt: string;
  stoppedAt?: string | null;
  isStale: boolean;
}

export interface WorkerDetail extends WorkerRow {
  heartbeats: { id: string; timestamp: string; activeJobCount: number; cpuLoad?: number | null; memoryUsageMb?: number | null }[];
  activeJobs: Job[];
}

export interface ThroughputPoint {
  bucket: string;
  completed: number;
  failed: number;
}
