import { useState } from "react";
import { useJobs, useQueues } from "../api/hooks";
import { useProjectContext } from "../context/ProjectContext";
import { JobsTable } from "../components/JobsTable";
import { LoadingBlock, EmptyState } from "../components/Spinner";
import { Pagination } from "../components/Pagination";
import { CreateJobModal } from "../components/CreateJobModal";

const STATUSES = ["SCHEDULED", "QUEUED", "CLAIMED", "RUNNING", "COMPLETED", "FAILED", "DEAD_LETTER", "CANCELLED"];

export function Jobs() {
  const { projectId } = useProjectContext();
  const { data: queues } = useQueues(projectId);
  const [queueId, setQueueId] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreateJob, setShowCreateJob] = useState(false);

  const { data, isLoading } = useJobs(projectId, {
    queueId: queueId || undefined,
    status: status || undefined,
    type: type || undefined,
    search: search || undefined,
    page,
    pageSize: 25,
  });

  if (!projectId) return <EmptyState>Select or create a project first.</EmptyState>;

  return (
    <div>
      <div className="page-header">
        <h1>Job Explorer</h1>
        <button className="btn btn-primary" onClick={() => setShowCreateJob(true)}>
          New job
        </button>
      </div>

      <div className="toolbar">
        <select className="select" value={queueId} onChange={(e) => (setQueueId(e.target.value), setPage(1))}>
          <option value="">All queues</option>
          {queues?.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
        <select className="select" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Job type…" value={type} onChange={(e) => (setType(e.target.value), setPage(1))} />
        <input className="input" placeholder="Search id or type…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <JobsTable jobs={data?.data ?? []} showQueue />
        </div>
      )}

      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}

      {showCreateJob && <CreateJobModal projectId={projectId} onClose={() => setShowCreateJob(false)} />}
    </div>
  );
}
