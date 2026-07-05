import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./client";
import type {
  DeadLetterEntry,
  Job,
  JobDefinition,
  JobDetail,
  JobLog,
  Organization,
  PaginatedResult,
  Project,
  Queue,
  QueueStats,
  RetryPolicy,
  SystemHealth,
  ThroughputPoint,
  WorkerDetail,
  WorkerRow,
} from "./types";

const POLL_MS = 5000;

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

// ---------------------------------------------------------------------------
// Organizations & projects
// ---------------------------------------------------------------------------

export function useOrganizations() {
  return useQuery({ queryKey: ["organizations"], queryFn: () => api.get<{ data: Organization[] }>("/api/v1/organizations").then((r) => r.data) });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug: string }) => api.post<Organization>("/api/v1/organizations", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

export function useProjects(organizationId: string | null) {
  return useQuery({
    queryKey: ["projects", organizationId],
    queryFn: () => api.get<{ data: Project[] }>(`/api/v1/organizations/${organizationId}/projects`).then((r) => r.data),
    enabled: !!organizationId,
  });
}

export function useCreateProject(organizationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug: string; description?: string }) =>
      api.post<Project>(`/api/v1/organizations/${organizationId}/projects`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", organizationId] }),
  });
}

export interface OrgMember {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  createdAt: string;
  user: { id: string; email: string; name: string };
}

export function useOrgMembers(organizationId: string | null) {
  return useQuery({
    queryKey: ["org-members", organizationId],
    queryFn: () => api.get<{ data: OrgMember[] }>(`/api/v1/organizations/${organizationId}/members`).then((r) => r.data),
    enabled: !!organizationId,
  });
}

export function useAddOrgMember(organizationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; role: "ADMIN" | "MEMBER" | "VIEWER" }) =>
      api.post<OrgMember>(`/api/v1/organizations/${organizationId}/members`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-members", organizationId] }),
  });
}

export function useRemoveOrgMember(organizationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api.delete(`/api/v1/organizations/${organizationId}/members/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-members", organizationId] }),
  });
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export function useQueues(projectId: string | null) {
  return useQuery({
    queryKey: ["queues", projectId],
    queryFn: () => api.get<{ data: Queue[] }>(`/api/v1/projects/${projectId}/queues`).then((r) => r.data),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export function useQueue(queueId: string | undefined) {
  return useQuery({
    queryKey: ["queue", queueId],
    queryFn: () => api.get<Queue>(`/api/v1/queues/${queueId}`),
    enabled: !!queueId,
    refetchInterval: POLL_MS,
  });
}

export function useQueueStats(queueId: string | undefined) {
  return useQuery({
    queryKey: ["queue-stats", queueId],
    queryFn: () => api.get<QueueStats>(`/api/v1/queues/${queueId}/stats`),
    enabled: !!queueId,
    refetchInterval: POLL_MS,
  });
}

export function useCreateQueue(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Queue> & { name: string; slug: string }) => api.post<Queue>(`/api/v1/projects/${projectId}/queues`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queues", projectId] }),
  });
}

export function useUpdateQueue(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, body }: { queueId: string; body: Partial<Queue> }) => api.patch<Queue>(`/api/v1/queues/${queueId}`, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["queues", projectId] });
      qc.invalidateQueries({ queryKey: ["queue", vars.queueId] });
    },
  });
}

export function useToggleQueuePause(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, pause }: { queueId: string; pause: boolean }) =>
      api.post<Queue>(`/api/v1/queues/${queueId}/${pause ? "pause" : "resume"}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queues", projectId] }),
  });
}

export function useRetryPolicies(projectId: string | null) {
  return useQuery({
    queryKey: ["retry-policies", projectId],
    queryFn: () => api.get<{ data: RetryPolicy[] }>(`/api/v1/projects/${projectId}/retry-policies`).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useCreateRetryPolicy(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<RetryPolicy> & { name: string }) => api.post<RetryPolicy>(`/api/v1/projects/${projectId}/retry-policies`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retry-policies", projectId] }),
  });
}

// ---------------------------------------------------------------------------
// Job definitions (cron)
// ---------------------------------------------------------------------------

export function useJobDefinitions(queueId: string | undefined) {
  return useQuery({
    queryKey: ["job-definitions", queueId],
    queryFn: () => api.get<{ data: JobDefinition[] }>(`/api/v1/queues/${queueId}/job-definitions`).then((r) => r.data),
    enabled: !!queueId,
    refetchInterval: POLL_MS,
  });
}

export function useCreateJobDefinition(queueId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<JobDefinition>(`/api/v1/queues/${queueId}/job-definitions`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-definitions", queueId] }),
  });
}

export function useToggleJobDefinition(queueId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ defId, pause }: { defId: string; pause: boolean }) =>
      api.post<JobDefinition>(`/api/v1/job-definitions/${defId}/${pause ? "pause" : "resume"}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-definitions", queueId] }),
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobFilters {
  queueId?: string;
  status?: string;
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useJobs(projectId: string | null, filters: JobFilters) {
  return useQuery({
    queryKey: ["jobs", projectId, filters],
    queryFn: () =>
      api.get<PaginatedResult<Job>>(
        `/api/v1/jobs${qs({ projectId: projectId ?? "", ...filters })}`
      ),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<JobDetail>(`/api/v1/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data && ["RUNNING", "CLAIMED", "QUEUED"].includes(query.state.data.status) ? 2500 : POLL_MS),
  });
}

export function useJobLogs(jobId: string | undefined, page: number) {
  return useQuery({
    queryKey: ["job-logs", jobId, page],
    queryFn: () => api.get<PaginatedResult<JobLog>>(`/api/v1/jobs/${jobId}/logs${qs({ page, pageSize: 50 })}`),
    enabled: !!jobId,
  });
}

export function useCreateJob(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, body }: { queueId: string; body: Record<string, unknown> }) => api.post<Job>(`/api/v1/queues/${queueId}/jobs`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs", projectId] }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post(`/api/v1/jobs/${jobId}/cancel`),
    onSuccess: (_d, jobId) => {
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post<Job>(`/api/v1/jobs/${jobId}/retry`),
    onSuccess: (_d, jobId) => {
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

/** Powers the drag-and-drop board: moves a job to a different queue in the same project. */
export function useMoveJob(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, queueId }: { jobId: string; queueId: string }) => api.post<Job>(`/api/v1/jobs/${jobId}/move`, { queueId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs", projectId] });
      qc.invalidateQueries({ queryKey: ["queues", projectId] });
    },
  });
}

export interface CalendarJob {
  id: string;
  type: string;
  status: string;
  priority: number;
  runAt: string;
  queueId: string;
  queue: { name: string; slug: string };
}

export function useCalendarJobs(projectId: string | null, from: Date, to: Date) {
  return useQuery({
    queryKey: ["calendar-jobs", projectId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
    queryFn: () =>
      api
        .get<{ data: CalendarJob[] }>(`/api/v1/jobs/calendar${qs({ projectId: projectId ?? "", from: from.toISOString(), to: to.toISOString() })}`)
        .then((r) => r.data),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export interface PriorityBandCount {
  band: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  count: number;
}

export function usePriorityDistribution(projectId: string | null) {
  return useQuery({
    queryKey: ["priority-distribution", projectId],
    queryFn: () => api.get<{ data: PriorityBandCount[] }>(`/api/v1/metrics/priority-distribution${qs({ projectId: projectId ?? "" })}`).then((r) => r.data),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

// ---------------------------------------------------------------------------
// Dead letter queue
// ---------------------------------------------------------------------------

export function useDlq(projectId: string | null, queueId: string | undefined, page: number) {
  return useQuery({
    queryKey: ["dlq", projectId, queueId, page],
    queryFn: () =>
      api.get<PaginatedResult<DeadLetterEntry>>(`/api/v1/dlq${qs({ projectId: projectId ?? "", queueId, page, pageSize: 25 })}`),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export function useRetryDlqEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.post<Job>(`/api/v1/dlq/${entryId}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dlq"] }),
  });
}

export function useResolveDlqEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.post<DeadLetterEntry>(`/api/v1/dlq/${entryId}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dlq"] }),
  });
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export function useWorkers() {
  return useQuery({ queryKey: ["workers"], queryFn: () => api.get<{ data: WorkerRow[] }>("/api/v1/workers").then((r) => r.data), refetchInterval: POLL_MS });
}

export function useWorker(workerId: string | undefined) {
  return useQuery({
    queryKey: ["worker", workerId],
    queryFn: () => api.get<WorkerDetail>(`/api/v1/workers/${workerId}`),
    enabled: !!workerId,
    refetchInterval: POLL_MS,
  });
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function useSystemHealth(projectId: string | null) {
  return useQuery({
    queryKey: ["health", projectId],
    queryFn: () => api.get<SystemHealth>(`/api/v1/metrics/health${qs({ projectId: projectId ?? "" })}`),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export function useThroughput(projectId: string | null, hours = 24) {
  return useQuery({
    queryKey: ["throughput", projectId, hours],
    queryFn: () => api.get<{ hours: number; data: ThroughputPoint[] }>(`/api/v1/metrics/throughput${qs({ projectId: projectId ?? "", hours })}`),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export function useQueueMetrics(projectId: string | null) {
  return useQuery({
    queryKey: ["queue-metrics", projectId],
    queryFn: () => api.get<{ data: { queue: Queue; stats: QueueStats }[] }>(`/api/v1/metrics/queues${qs({ projectId: projectId ?? "" })}`),
    enabled: !!projectId,
    refetchInterval: POLL_MS,
  });
}

export type { UseQueryOptions };
