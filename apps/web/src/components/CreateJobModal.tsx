import { useState, type FormEvent } from "react";
import { useCreateJob, useQueues } from "../api/hooks";
import { ApiClientError } from "../api/client";
import { Modal } from "./Modal";

/** `queueId` is optional: when creating from a queue's own page it's pre-selected and locked;
 * when creating from the global Jobs explorer or Board, the user picks the target queue first. */
export function CreateJobModal({ projectId, queueId, onClose }: { projectId: string; queueId?: string; onClose: () => void }) {
  const create = useCreateJob(projectId);
  const { data: queues } = useQueues(queueId ? null : projectId);
  const [selectedQueueId, setSelectedQueueId] = useState(queueId ?? "");
  const [type, setType] = useState("");
  const [payload, setPayload] = useState("{}");
  const [priority, setPriority] = useState(0);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [runAt, setRunAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedQueueId) {
      setError("Choose a queue for this job");
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload || "{}");
    } catch {
      setError("Payload must be valid JSON");
      return;
    }

    try {
      await create.mutateAsync({
        queueId: selectedQueueId,
        body: {
          type,
          payload: parsedPayload,
          priority,
          runAt: scheduleMode === "later" && runAt ? new Date(runAt).toISOString() : undefined,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create job");
    }
  }

  return (
    <Modal title="New job" onClose={onClose}>
      <form onSubmit={onSubmit}>
        {!queueId && (
          <div className="form-row">
            <label>Queue</label>
            <select className="select" value={selectedQueueId} onChange={(e) => setSelectedQueueId(e.target.value)} required>
              <option value="">Choose a queue…</option>
              {queues?.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <label>Job type</label>
          <input className="input mono" value={type} onChange={(e) => setType(e.target.value)} placeholder="send-welcome-email" required />
        </div>
        <div className="form-row">
          <label>Payload (JSON)</label>
          <textarea className="textarea" rows={5} value={payload} onChange={(e) => setPayload(e.target.value)} />
        </div>
        <div className="form-grid-2">
          <div className="form-row">
            <label>Priority (0-100)</label>
            <input className="input" type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          </div>
          <div className="form-row">
            <label>Schedule</label>
            <select className="select" value={scheduleMode} onChange={(e) => setScheduleMode(e.target.value as "now" | "later")}>
              <option value="now">Run immediately</option>
              <option value="later">Run at a specific time</option>
            </select>
          </div>
        </div>
        {scheduleMode === "later" && (
          <div className="form-row">
            <label>Run at</label>
            <input className="input" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} required />
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending} style={{ width: "100%", marginTop: 8 }}>
          {create.isPending ? "Creating…" : "Create job"}
        </button>
      </form>
    </Modal>
  );
}
