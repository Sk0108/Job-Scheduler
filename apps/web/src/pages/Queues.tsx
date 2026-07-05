import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectContext } from "../context/ProjectContext";
import { useCreateQueue, useQueues, useToggleQueuePause } from "../api/hooks";
import { LoadingBlock, EmptyState } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { Modal } from "../components/Modal";
import { ApiClientError } from "../api/client";

export function Queues() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const { data: queues, isLoading } = useQueues(projectId);
  const toggle = useToggleQueuePause(projectId);
  const [showCreate, setShowCreate] = useState(false);

  if (!projectId) return <EmptyState>Select or create a project first.</EmptyState>;

  return (
    <div>
      <div className="page-header">
        <h1>Queues</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          New queue
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Priority</th>
                <th>Concurrency</th>
                <th>Rate limit</th>
                <th>Jobs</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {queues?.map((q) => (
                <tr key={q.id} className="clickable" onClick={() => navigate(`/queues/${q.id}`)}>
                  <td>{q.name}</td>
                  <td className="mono dim">{q.slug}</td>
                  <td>{q.priority}</td>
                  <td>{q.concurrencyLimit}</td>
                  <td>{q.rateLimitPerSecond ? `${q.rateLimitPerSecond}/s` : "—"}</td>
                  <td>{q._count?.jobs ?? "—"}</td>
                  <td>
                    <StatusBadge status={q.isPaused ? "DRAINING" : "ONLINE"} />
                  </td>
                  <td>
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle.mutate({ queueId: q.id, pause: !q.isPaused });
                      }}
                    >
                      {q.isPaused ? "Resume" : "Pause"}
                    </button>
                  </td>
                </tr>
              ))}
              {!queues?.length && (
                <tr>
                  <td colSpan={8} className="dim">
                    No queues yet — create one to start scheduling jobs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateQueueModal projectId={projectId} onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateQueueModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const create = useCreateQueue(projectId);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [priority, setPriority] = useState(0);
  const [concurrencyLimit, setConcurrencyLimit] = useState(5);
  const [rateLimitPerSecond, setRateLimitPerSecond] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        name,
        slug,
        priority,
        concurrencyLimit,
        rateLimitPerSecond: rateLimitPerSecond === "" ? undefined : Number(rateLimitPerSecond),
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create queue");
    }
  }

  return (
    <Modal title="New queue" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="form-row">
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Slug</label>
          <input className="input mono" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="emails" required />
        </div>
        <div className="form-grid-2">
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
        </div>
        <div className="form-row">
          <label>Rate limit (jobs/sec, optional)</label>
          <input
            className="input"
            type="number"
            min={1}
            value={rateLimitPerSecond}
            onChange={(e) => setRateLimitPerSecond(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending} style={{ width: "100%", marginTop: 8 }}>
          {create.isPending ? "Creating…" : "Create queue"}
        </button>
      </form>
    </Modal>
  );
}
