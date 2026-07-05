import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  useCreateJobDefinition,
  useJobDefinitions,
  useJobs,
  useQueue,
  useQueueStats,
  useToggleJobDefinition,
  useToggleQueuePause,
  useUpdateQueue,
} from "../api/hooks";
import { useProjectContext } from "../context/ProjectContext";
import { LoadingBlock, EmptyState } from "../components/Spinner";
import { StatTile } from "../components/StatTile";
import { StatusBadge } from "../components/StatusBadge";
import { JobsTable } from "../components/JobsTable";
import { CreateJobModal } from "../components/CreateJobModal";
import { Modal } from "../components/Modal";
import { Reveal } from "../components/Reveal";
import { ApiClientError } from "../api/client";

export function QueueDetail() {
  const { queueId } = useParams<{ queueId: string }>();
  const { projectId } = useProjectContext();
  const { data: queue, isLoading } = useQueue(queueId);
  const { data: stats } = useQueueStats(queueId);
  const { data: definitions } = useJobDefinitions(queueId);
  const { data: jobsPage } = useJobs(projectId, { queueId, pageSize: 10 });
  const toggleQueue = useToggleQueuePause(projectId);
  const toggleDef = useToggleJobDefinition(queueId);
  const updateQueue = useUpdateQueue(projectId);

  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showCreateCron, setShowCreateCron] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);

  if (isLoading || !queue) return <LoadingBlock />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{queue.name}</h1>
          <span className="dim mono">{queue.slug}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setEditingConfig(true)}>
            Configure
          </button>
          <button className="btn" onClick={() => toggleQueue.mutate({ queueId: queue.id, pause: !queue.isPaused })}>
            {queue.isPaused ? "Resume queue" : "Pause queue"}
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreateJob(true)}>
            New job
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4">
        <StatTile label="Status" value={queue.isPaused ? "Paused" : "Active"} />
        <StatTile label="Priority" value={queue.priority} />
        <StatTile label="Concurrency limit" value={queue.concurrencyLimit} />
        <StatTile label="Rate limit" value={queue.rateLimitPerSecond ? `${queue.rateLimitPerSecond}/s` : "None"} />
        <StatTile label="Active now" value={stats?.activeCount ?? "—"} />
        <StatTile label="Completed / hr" value={stats?.throughputLastHour ?? "—"} />
        <StatTile label="Avg duration (last 100)" value={stats?.avgDurationMsLast100 ? `${stats.avgDurationMsLast100}ms` : "—"} />
        <StatTile label="Failure rate (last 100)" value={stats ? `${Math.round(stats.failureRateLast100 * 100)}%` : "—"} />
      </div>

      <Reveal>
        <div className="section-title">Status breakdown</div>
        <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {stats &&
            Object.entries(stats.counts).map(([status, count]) => (
              <div key={status} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusBadge status={status} />
                <strong>{count}</strong>
              </div>
            ))}
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="section-title">Execution duration — last 100 runs</div>
        <div className="card" style={{ height: 220 }}>
          {stats && stats.durationHistogram.some((b) => b.count > 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.durationHistogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" stroke="var(--text-dim)" fontSize={11} />
                <YAxis stroke="var(--text-dim)" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" name="Executions" radius={[4, 4, 0, 0]} animationDuration={600}>
                  {stats.durationHistogram.map((b, i) => (
                    <Cell key={b.label} fill={`var(--accent)`} fillOpacity={0.55 + (i / stats.durationHistogram.length) * 0.45} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>No completed executions yet.</EmptyState>
          )}
        </div>
      </Reveal>

      <div className="page-header" style={{ marginTop: 24 }}>
        <div className="section-title" style={{ margin: 0 }}>
          Recurring (cron) definitions
        </div>
        <button className="btn btn-sm" onClick={() => setShowCreateCron(true)}>
          New cron job
        </button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Job type</th>
              <th>Cron</th>
              <th>Next run</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {definitions?.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="mono dim">{d.jobType}</td>
                <td className="mono">{d.cronExpression}</td>
                <td className="dim">{d.nextRunAt ? new Date(d.nextRunAt).toLocaleString() : "—"}</td>
                <td>
                  <StatusBadge status={d.isPaused ? "DRAINING" : "ONLINE"} />
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => toggleDef.mutate({ defId: d.id, pause: !d.isPaused })}>
                    {d.isPaused ? "Resume" : "Pause"}
                  </button>
                </td>
              </tr>
            ))}
            {!definitions?.length && (
              <tr>
                <td colSpan={6} className="dim">
                  No recurring jobs configured for this queue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">Recent jobs</div>
      <div className="card" style={{ padding: 0 }}>
        <JobsTable jobs={jobsPage?.data ?? []} />
      </div>

      {showCreateJob && projectId && <CreateJobModal projectId={projectId} queueId={queue.id} onClose={() => setShowCreateJob(false)} />}
      {showCreateCron && <CreateCronModal queueId={queue.id} onClose={() => setShowCreateCron(false)} />}
      {editingConfig && (
        <ConfigModal
          queue={queue}
          onClose={() => setEditingConfig(false)}
          onSave={(body) => updateQueue.mutateAsync({ queueId: queue.id, body }).then(() => setEditingConfig(false))}
        />
      )}
    </div>
  );
}

function CreateCronModal({ queueId, onClose }: { queueId: string; onClose: () => void }) {
  const create = useCreateJobDefinition(queueId);
  const [name, setName] = useState("");
  const [jobType, setJobType] = useState("");
  const [cronExpression, setCronExpression] = useState("*/5 * * * *");
  const [payload, setPayload] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload || "{}");
    } catch {
      setError("Payload must be valid JSON");
      return;
    }
    try {
      await create.mutateAsync({ name, jobType, cronExpression, payload: parsedPayload });
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create cron job");
    }
  }

  return (
    <Modal title="New recurring (cron) job" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="form-row">
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Job type</label>
          <input className="input mono" value={jobType} onChange={(e) => setJobType(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Cron expression</label>
          <input className="input mono" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Payload (JSON)</label>
          <textarea className="textarea" rows={4} value={payload} onChange={(e) => setPayload(e.target.value)} />
        </div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending} style={{ width: "100%", marginTop: 8 }}>
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </form>
    </Modal>
  );
}

function ConfigModal({
  queue,
  onClose,
  onSave,
}: {
  queue: { priority: number; concurrencyLimit: number; rateLimitPerSecond?: number | null };
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [priority, setPriority] = useState(queue.priority);
  const [concurrencyLimit, setConcurrencyLimit] = useState(queue.concurrencyLimit);
  const [rateLimitPerSecond, setRateLimitPerSecond] = useState<number | "">(queue.rateLimitPerSecond ?? "");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ priority, concurrencyLimit, rateLimitPerSecond: rateLimitPerSecond === "" ? null : Number(rateLimitPerSecond) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Configure queue" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="form-row">
          <label>Priority (0-100)</label>
          <input className="input" type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
        </div>
        <div className="form-row">
          <label>Concurrency limit</label>
          <input
            className="input"
            type="number"
            min={1}
            value={concurrencyLimit}
            onChange={(e) => setConcurrencyLimit(Number(e.target.value))}
          />
        </div>
        <div className="form-row">
          <label>Rate limit (jobs/sec, blank = none)</label>
          <input
            className="input"
            type="number"
            min={1}
            value={rateLimitPerSecond}
            onChange={(e) => setRateLimitPerSecond(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={saving} style={{ width: "100%", marginTop: 8 }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}
