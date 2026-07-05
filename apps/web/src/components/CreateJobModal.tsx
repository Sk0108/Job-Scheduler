import { useState, type FormEvent } from "react";
import { useCreateJob } from "../api/hooks";
import { ApiClientError } from "../api/client";
import { Modal } from "./Modal";

export function CreateJobModal({ projectId, queueId, onClose }: { projectId: string; queueId: string; onClose: () => void }) {
  const create = useCreateJob(projectId);
  const [type, setType] = useState("");
  const [payload, setPayload] = useState("{}");
  const [priority, setPriority] = useState(0);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [runAt, setRunAt] = useState("");
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
      await create.mutateAsync({
        queueId,
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
