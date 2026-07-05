import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import type { Job } from "../api/types";
import { StatusBadge } from "./StatusBadge";
import { PriorityChip } from "./PriorityChip";

export function JobsTable({ jobs, showQueue = false }: { jobs: Job[]; showQueue?: boolean }) {
  const navigate = useNavigate();

  return (
    <table>
      <thead>
        <tr>
          <th>Type</th>
          {showQueue && <th>Queue</th>}
          <th>Status</th>
          <th>Attempt</th>
          <th>Priority</th>
          <th>Run at</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job, i) => (
          <motion.tr
            key={job.id}
            className="clickable"
            onClick={() => navigate(`/jobs/${job.id}`)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.02 }}
          >
            <td className="mono">{job.type}</td>
            {showQueue && <td className="dim">{job.queue?.name ?? job.queueId.slice(0, 8)}</td>}
            <td>
              <StatusBadge status={job.status} />
            </td>
            <td>
              {job.attempt}
              {job.maxRetries != null ? ` / ${job.maxRetries}` : ""}
            </td>
            <td>
              <PriorityChip priority={job.priority} />
            </td>
            <td className="dim">{new Date(job.runAt).toLocaleString()}</td>
            <td className="dim">{new Date(job.updatedAt).toLocaleString()}</td>
          </motion.tr>
        ))}
        {!jobs.length && (
          <tr>
            <td colSpan={showQueue ? 7 : 6} className="dim">
              No jobs match these filters.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
