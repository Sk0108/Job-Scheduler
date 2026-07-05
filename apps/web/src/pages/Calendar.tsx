import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useProjectContext } from "../context/ProjectContext";
import { useCalendarJobs, type CalendarJob } from "../api/hooks";
import { LoadingBlock, EmptyState } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityChip } from "../components/PriorityChip";
import { Modal } from "../components/Modal";
import { getPriorityInfo, PRIORITY_BAND_ORDER } from "../lib/priority";
import { addDays, addMonths, dateKey, isSameDay, MONTH_LABELS, startOfMonth, startOfWeek, WEEKDAY_LABELS } from "../lib/date";

const GRID_DAYS = 42;
const MAX_DOTS_PER_DAY = 6;

export function CalendarPage() {
  const { projectId } = useProjectContext();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const navigate = useNavigate();

  const gridStart = useMemo(() => startOfWeek(startOfMonth(cursor)), [cursor]);
  const gridEnd = useMemo(() => addDays(gridStart, GRID_DAYS - 1), [gridStart]);
  const days = useMemo(() => Array.from({ length: GRID_DAYS }, (_, i) => addDays(gridStart, i)), [gridStart]);

  const { data: jobs, isLoading } = useCalendarJobs(projectId, gridStart, gridEnd);

  const jobsByDay = useMemo(() => {
    const map = new Map<string, CalendarJob[]>();
    for (const job of jobs ?? []) {
      const key = dateKey(new Date(job.runAt));
      const list = map.get(key) ?? [];
      list.push(job);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.priority - a.priority);
    return map;
  }, [jobs]);

  if (!projectId) return <EmptyState>Select or create a project first.</EmptyState>;

  const today = new Date();
  const selectedJobs = selectedDay ? jobsByDay.get(dateKey(selectedDay)) ?? [] : [];

  return (
    <div>
      <div className="page-header">
        <h1>Calendar</h1>
        <div className="toolbar" style={{ margin: 0 }}>
          <button className="btn btn-sm" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft size={14} />
          </button>
          <strong style={{ minWidth: 160, textAlign: "center" }}>
            {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
          </strong>
          <button className="btn btn-sm" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight size={14} />
          </button>
          <button className="btn btn-sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="calendar-grid">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="calendar-weekday">
              {w}
            </div>
          ))}
          {days.map((day, i) => {
            const dayJobs = jobsByDay.get(dateKey(day)) ?? [];
            const outside = day.getMonth() !== cursor.getMonth();
            return (
              <motion.div
                key={day.toISOString()}
                className={`calendar-day ${outside ? "is-outside" : ""} ${isSameDay(day, today) ? "is-today" : ""}`}
                onClick={() => dayJobs.length && setSelectedDay(day)}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, delay: Math.min(i, 20) * 0.008 }}
                whileHover={dayJobs.length ? { y: -2, borderColor: "var(--accent)" } : undefined}
              >
                <div className="calendar-day-number">{day.getDate()}</div>
                <div className="calendar-day-dots">
                  {dayJobs.slice(0, MAX_DOTS_PER_DAY).map((job) => (
                    <span key={job.id} className="calendar-dot" style={{ background: getPriorityInfo(job.priority).color }} title={job.type} />
                  ))}
                </div>
                {dayJobs.length > 0 && (
                  <div className="calendar-day-count">
                    {dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}
                    {dayJobs.length > MAX_DOTS_PER_DAY ? ` (+${dayJobs.length - MAX_DOTS_PER_DAY})` : ""}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {selectedDay && (
        <Modal title={selectedDay.toDateString()} onClose={() => setSelectedDay(null)}>
          {PRIORITY_BAND_ORDER.slice()
            .reverse()
            .map((band) => {
              const inBand = selectedJobs.filter((j) => getPriorityInfo(j.priority).band === band);
              if (!inBand.length) return null;
              return (
                <div key={band} style={{ marginBottom: 14 }}>
                  <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", marginBottom: 6 }}>
                    {band} ({inBand.length})
                  </div>
                  {inBand.map((job) => (
                    <div
                      key={job.id}
                      className="clickable"
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    >
                      <div>
                        <div className="mono" style={{ fontSize: 13 }}>
                          {job.type}
                        </div>
                        <div className="dim" style={{ fontSize: 11 }}>
                          {job.queue.name} · {new Date(job.runAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <StatusBadge status={job.status} />
                        <PriorityChip priority={job.priority} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
        </Modal>
      )}
    </div>
  );
}
