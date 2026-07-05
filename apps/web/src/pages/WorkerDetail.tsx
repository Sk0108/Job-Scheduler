import { useParams } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWorker } from "../api/hooks";
import { LoadingBlock } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { StatTile } from "../components/StatTile";
import { JobsTable } from "../components/JobsTable";

export function WorkerDetail() {
  const { workerId } = useParams<{ workerId: string }>();
  const { data: worker, isLoading } = useWorker(workerId);

  if (isLoading || !worker) return <LoadingBlock />;

  const chartData = [...worker.heartbeats]
    .reverse()
    .map((h) => ({ time: new Date(h.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), active: h.activeJobCount }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{worker.name}</h1>
          <span className="dim mono">
            {worker.hostname}:{worker.pid}
          </span>
        </div>
        <StatusBadge status={worker.isStale ? "OFFLINE" : worker.status} />
      </div>

      <div className="grid grid-cols-4">
        <StatTile label="Active jobs" value={`${worker.activeJobCount} / ${worker.concurrency}`} />
        <StatTile label="Queue filter" value={worker.queueFilter} />
        <StatTile label="Started" value={new Date(worker.startedAt).toLocaleString()} />
        <StatTile label="Last heartbeat" value={new Date(worker.lastHeartbeatAt).toLocaleTimeString()} />
      </div>

      <div className="section-title">Active job count — recent heartbeats</div>
      <div className="card" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
            <YAxis stroke="var(--text-dim)" fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="active" stroke="var(--accent)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="section-title">Currently claimed jobs</div>
      <div className="card" style={{ padding: 0 }}>
        <JobsTable jobs={worker.activeJobs} showQueue />
      </div>
    </div>
  );
}
