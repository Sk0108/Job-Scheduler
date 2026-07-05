import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNavigate } from "react-router-dom";
import { useProjectContext } from "../context/ProjectContext";
import { useQueueMetrics, useQueues, useSystemHealth, useThroughput, usePriorityDistribution } from "../api/hooks";
import { StatTile } from "../components/StatTile";
import { LoadingBlock, EmptyState } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { Reveal } from "../components/Reveal";
import { getCategoricalColor } from "../lib/categorical";
import { priorityBandColor, priorityBandLabel } from "../lib/priority";

const tooltipStyle = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

export function Dashboard() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const { data: health, isLoading: healthLoading } = useSystemHealth(projectId);
  const { data: throughput } = useThroughput(projectId, 24);
  const { data: queues } = useQueues(projectId);
  const { data: queueMetrics } = useQueueMetrics(projectId);
  const { data: priorityDist } = usePriorityDistribution(projectId);

  if (!projectId) return <EmptyState>Select or create a project to get started.</EmptyState>;
  if (healthLoading || !health) return <LoadingBlock />;

  const chartData = (throughput?.data ?? []).map((p) => ({
    time: new Date(p.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    completed: p.completed,
    failed: p.failed,
  }));

  const priorityChartData = (priorityDist ?? [])
    .filter((b) => b.count > 0)
    .map((b) => ({ name: priorityBandLabel(b.band), value: b.count, color: priorityBandColor(b.band) }));

  const queueChartData = (queueMetrics?.data ?? []).map((entry) => ({
    name: entry.queue.name,
    throughput: entry.stats.throughputLastHour,
    active: entry.stats.activeCount,
    color: getCategoricalColor(entry.queue.id),
  }));

  return (
    <div>
      <div className="page-header">
        <h1>System Health</h1>
      </div>

      <div className="grid grid-cols-4">
        <StatTile label="Queued" value={health.queued} />
        <StatTile label="Scheduled" value={health.scheduled} />
        <StatTile label="Running" value={health.running} />
        <StatTile label="Dead letter" value={health.deadLetter} accent="var(--red)" />
        <StatTile label="Completed / hr" value={health.throughputLastHour} />
        <StatTile label="Failed / hr" value={health.failedLastHour} />
        <StatTile label="Workers online" value={`${health.workersOnline} / ${health.workersTotal}`} />
        <StatTile label="Total jobs" value={health.totalJobs} />
      </div>

      <Reveal>
        <div className="section-title">Throughput — last 24h</div>
        <div className="card" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--green)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--red)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--red)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
              <YAxis stroke="var(--text-dim)" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="completed" name="Completed" stroke="var(--green)" fill="url(#completedGrad)" strokeWidth={2} animationDuration={600} />
              <Area type="monotone" dataKey="failed" name="Failed" stroke="var(--red)" fill="url(#failedGrad)" strokeWidth={2} animationDuration={600} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Reveal>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 24 }}>
        <Reveal delay={0.05}>
          <div className="section-title">Priority mix (active jobs)</div>
          <div className="card" style={{ height: 260 }}>
            {priorityChartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={priorityChartData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} animationDuration={600}>
                    {priorityChartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} stroke="var(--bg-elevated)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState>No active jobs to break down yet.</EmptyState>
            )}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="section-title">Throughput by queue — last hour</div>
          <div className="card" style={{ height: 260 }}>
            {queueChartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={queueChartData} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" stroke="var(--text-dim)" fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" stroke="var(--text-dim)" fontSize={11} width={90} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="throughput" name="Completed / hr" radius={[0, 4, 4, 0]} animationDuration={600}>
                    {queueChartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState>No queues yet.</EmptyState>
            )}
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.1}>
        <div className="section-title">Queues</div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Priority</th>
                <th>Concurrency</th>
                <th>Status</th>
                <th>Jobs</th>
              </tr>
            </thead>
            <tbody>
              {queues?.map((q) => (
                <tr key={q.id} className="clickable" onClick={() => navigate(`/queues/${q.id}`)}>
                  <td>{q.name}</td>
                  <td>{q.priority}</td>
                  <td>{q.concurrencyLimit}</td>
                  <td>
                    <StatusBadge status={q.isPaused ? "DRAINING" : "ONLINE"} />
                    {q.isPaused ? " Paused" : " Active"}
                  </td>
                  <td>{q._count?.jobs ?? "—"}</td>
                </tr>
              ))}
              {!queues?.length && (
                <tr>
                  <td colSpan={5} className="dim">
                    No queues yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Reveal>
    </div>
  );
}
