import { useState } from "react";
import { useParams } from "react-router-dom";
import { useCancelJob, useJob, useJobLogs, useRetryJob } from "../api/hooks";
import { LoadingBlock } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { Pagination } from "../components/Pagination";

export function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data: job, isLoading } = useJob(jobId);
  const cancel = useCancelJob();
  const retry = useRetryJob();
  const [tab, setTab] = useState<"executions" | "logs" | "payload">("executions");
  const [logPage, setLogPage] = useState(1);
  const { data: logs } = useJobLogs(tab === "logs" ? jobId : undefined, logPage);

  if (isLoading || !job) return <LoadingBlock />;

  const canCancel = ["QUEUED", "SCHEDULED", "FAILED"].includes(job.status);
  const canRetry = ["FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.status);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="mono">{job.type}</h1>
          <span className="dim mono" style={{ fontSize: 12 }}>
            {job.id}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <StatusBadge status={job.status} />
          {canCancel && (
            <button className="btn" onClick={() => cancel.mutate(job.id)}>
              Cancel
            </button>
          )}
          {canRetry && (
            <button className="btn btn-primary" onClick={() => retry.mutate(job.id)}>
              Retry now
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4">
        <div className="stat-tile">
          <div className="label">Attempt</div>
          <div className="value">
            {job.attempt}
            {job.maxRetries != null ? ` / ${job.maxRetries}` : ""}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">Priority</div>
          <div className="value">{job.priority}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Run at</div>
          <div className="value" style={{ fontSize: 14 }}>
            {new Date(job.runAt).toLocaleString()}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">Retry strategy</div>
          <div className="value" style={{ fontSize: 14 }}>
            {job.retryStrategy ?? "queue default"}
          </div>
        </div>
      </div>

      {job.failureSummary && (
        <>
          <div className="section-title">AI failure summary</div>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <strong>{job.failureSummary.headline}</strong>
              <span className="dim">{job.failureSummary.isTransientGuess ? "Likely transient" : "Likely deterministic"}</span>
            </div>
            <p className="dim" style={{ margin: "4px 0" }}>
              {job.failureSummary.explanation}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Suggested action:</strong> {job.failureSummary.suggestedAction}
            </p>
          </div>
        </>
      )}

      {(job.dependsOn.length > 0 || job.dependents.length > 0) && (
        <>
          <div className="section-title">Workflow dependencies</div>
          <div className="card" style={{ display: "flex", gap: 32 }}>
            {job.dependsOn.length > 0 && (
              <div>
                <div className="dim" style={{ marginBottom: 6 }}>
                  Depends on
                </div>
                {job.dependsOn.map((d) => (
                  <div key={d.dependsOnJob.id} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <StatusBadge status={d.dependsOnJob.status} />
                    <span className="mono">{d.dependsOnJob.type}</span>
                  </div>
                ))}
              </div>
            )}
            {job.dependents.length > 0 && (
              <div>
                <div className="dim" style={{ marginBottom: 6 }}>
                  Blocks
                </div>
                {job.dependents.map((d) => (
                  <div key={d.job.id} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <StatusBadge status={d.job.status} />
                    <span className="mono">{d.job.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="tabs" style={{ marginTop: 24 }}>
        <button className={tab === "executions" ? "active" : ""} onClick={() => setTab("executions")}>
          Execution history
        </button>
        <button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>
          Logs
        </button>
        <button className={tab === "payload" ? "active" : ""} onClick={() => setTab("payload")}>
          Payload
        </button>
      </div>

      {tab === "executions" && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Attempt</th>
                <th>Status</th>
                <th>Worker</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {job.executions.map((ex) => (
                <tr key={ex.id}>
                  <td>{ex.attemptNumber}</td>
                  <td>
                    <StatusBadge status={ex.status} />
                  </td>
                  <td className="dim">{ex.worker?.name ?? "—"}</td>
                  <td className="dim">{new Date(ex.startedAt).toLocaleString()}</td>
                  <td className="dim">{ex.durationMs != null ? `${ex.durationMs}ms` : "—"}</td>
                  <td className="error-text" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ex.errorMessage ?? ""}
                  </td>
                </tr>
              ))}
              {!job.executions.length && (
                <tr>
                  <td colSpan={6} className="dim">
                    No execution attempts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "logs" && (
        <div className="card">
          {logs?.data.map((l) => (
            <div key={l.id} className="log-line">
              <span className="dim">{new Date(l.timestamp).toLocaleTimeString()}</span>
              <span style={{ color: l.level === "ERROR" ? "var(--red)" : l.level === "WARN" ? "var(--amber)" : "var(--text-dim)" }}>
                {l.level}
              </span>
              <span>{l.message}</span>
            </div>
          ))}
          {!logs?.data.length && <div className="dim">No logs recorded for this job.</div>}
          {logs && <Pagination page={logs.page} totalPages={logs.totalPages} onChange={setLogPage} />}
        </div>
      )}

      {tab === "payload" && (
        <div className="card">
          <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {JSON.stringify(job.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
