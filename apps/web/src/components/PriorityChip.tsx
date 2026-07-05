import { getPriorityInfo } from "../lib/priority";

export function PriorityChip({ priority }: { priority: number }) {
  const info = getPriorityInfo(priority);
  return (
    <span className="priority-chip" style={{ color: info.color, background: info.bg }} title={`Priority ${priority}/100`}>
      <span className="priority-dot" style={{ background: info.color }} />
      {info.label}
    </span>
  );
}
