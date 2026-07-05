import { motion } from "framer-motion";

const COLORS: Record<string, string> = {
  SCHEDULED: "var(--amber)",
  QUEUED: "var(--blue)",
  CLAIMED: "var(--blue)",
  RUNNING: "var(--blue)",
  COMPLETED: "var(--green)",
  FAILED: "var(--amber)",
  DEAD_LETTER: "var(--red)",
  CANCELLED: "var(--gray)",
  ONLINE: "var(--green)",
  BUSY: "var(--blue)",
  DRAINING: "var(--amber)",
  OFFLINE: "var(--gray)",
  TIMED_OUT: "var(--red)",
};

const LIVE_STATUSES = new Set(["RUNNING", "CLAIMED", "BUSY"]);

export function StatusBadge({ status }: { status: string }) {
  const color = COLORS[status] ?? "var(--gray)";
  const isLive = LIVE_STATUSES.has(status);

  return (
    <span className="badge" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      {isLive ? (
        <motion.span
          className="badge-dot"
          style={{ background: color }}
          animate={{ scale: [1, 1.6, 1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : (
        <span className="badge-dot" style={{ background: color }} />
      )}
      {status.replace(/_/g, " ")}
    </span>
  );
}
