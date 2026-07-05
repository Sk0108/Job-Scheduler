import { useNavigate } from "react-router-dom";
import { useWorkers } from "../api/hooks";
import { LoadingBlock } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";

export function Workers() {
  const navigate = useNavigate();
  const { data: workers, isLoading } = useWorkers();

  if (isLoading) return <LoadingBlock />;

  return (
    <div>
      <div className="page-header">
        <h1>Worker Fleet</h1>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Host / PID</th>
              <th>Status</th>
              <th>Active jobs</th>
              <th>Queue filter</th>
              <th>Last heartbeat</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {workers?.map((w) => (
              <tr key={w.id} className="clickable" onClick={() => navigate(`/workers/${w.id}`)}>
                <td>{w.name}</td>
                <td className="dim mono">
                  {w.hostname}:{w.pid}
                </td>
                <td>
                  <StatusBadge status={w.isStale ? "OFFLINE" : w.status} />
                  {w.isStale && w.status !== "OFFLINE" && <span className="dim" style={{ marginLeft: 6 }}>(stale)</span>}
                </td>
                <td>
                  {w.activeJobCount} / {w.concurrency}
                </td>
                <td className="mono dim">{w.queueFilter}</td>
                <td className="dim">{new Date(w.lastHeartbeatAt).toLocaleTimeString()}</td>
                <td className="dim">{new Date(w.startedAt).toLocaleString()}</td>
              </tr>
            ))}
            {!workers?.length && (
              <tr>
                <td colSpan={7} className="dim">
                  No workers have registered yet. Start one with <span className="mono">npm run dev:worker</span>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
