import { useState } from "react";
import { useDlq, useQueues, useResolveDlqEntry, useRetryDlqEntry } from "../api/hooks";
import { useProjectContext } from "../context/ProjectContext";
import { LoadingBlock, EmptyState } from "../components/Spinner";
import { Pagination } from "../components/Pagination";

export function Dlq() {
  const { projectId } = useProjectContext();
  const { data: queues } = useQueues(projectId);
  const [queueId, setQueueId] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useDlq(projectId, queueId || undefined, page);
  const retry = useRetryDlqEntry();
  const resolve = useResolveDlqEntry();

  if (!projectId) return <EmptyState>Select or create a project first.</EmptyState>;

  return (
    <div>
      <div className="page-header">
        <h1>Dead Letter Queue</h1>
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
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Job type</th>
                <th>Attempts made</th>
                <th>Reason</th>
                <th>Last error</th>
                <th>Moved at</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.job?.type}</td>
                  <td>{entry.attemptsMade}</td>
                  <td className="dim">{entry.reason}</td>
                  <td className="error-text" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.lastError}
                  </td>
                  <td className="dim">{new Date(entry.movedAt).toLocaleString()}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => retry.mutate(entry.id)}>
                      Retry
                    </button>
                    <button className="btn btn-sm" onClick={() => resolve.mutate(entry.id)}>
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
              {!data?.data.length && (
                <tr>
                  <td colSpan={6} className="dim">
                    Nothing in the dead letter queue. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </div>
  );
}
