import { useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useProjectContext } from "../context/ProjectContext";
import { useJobs, useMoveJob, useQueues } from "../api/hooks";
import { LoadingBlock, EmptyState } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityChip } from "../components/PriorityChip";
import { CreateJobModal } from "../components/CreateJobModal";
import { getPriorityInfo } from "../lib/priority";
import type { Job, Queue } from "../api/types";

const BOARD_STATUSES = "SCHEDULED,QUEUED,CLAIMED,RUNNING,FAILED,DEAD_LETTER";

function BoardCard({ job }: { job: Job }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { queueId: job.queueId },
  });
  const info = getPriorityInfo(job.priority);

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="board-card"
      style={{
        borderLeftColor: info.color,
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        opacity: isDragging ? 0.35 : 1,
      }}
      whileHover={{ y: -2, boxShadow: "0 6px 16px rgba(0,0,0,0.2)" }}
      onDoubleClick={() => navigate(`/jobs/${job.id}`)}
      title="Drag to another queue, or double-click to open"
    >
      <div className="board-card-type">{job.type}</div>
      <div className="board-card-meta">
        <StatusBadge status={job.status} />
        <PriorityChip priority={job.priority} />
      </div>
    </motion.div>
  );
}

function BoardColumn({ queue, jobs }: { queue: Queue; jobs: Job[] }) {
  const { isOver, setNodeRef } = useDroppable({ id: queue.id });

  return (
    <div ref={setNodeRef} className={`board-column ${isOver ? "is-over" : ""}`}>
      <div className="board-column-header">
        <div>
          <strong>{queue.name}</strong>
          <div className="dim" style={{ fontSize: 11 }}>
            {queue.slug} {queue.isPaused && "· paused"}
          </div>
        </div>
        <span className="dim">{jobs.length}</span>
      </div>
      <div className="board-column-body">
        {jobs.map((job) => (
          <BoardCard key={job.id} job={job} />
        ))}
        {!jobs.length && (
          <div className="dim" style={{ fontSize: 12, textAlign: "center", padding: "16px 0" }}>
            Drop jobs here
          </div>
        )}
      </div>
    </div>
  );
}

export function Board() {
  const { projectId } = useProjectContext();
  const { data: queues, isLoading: queuesLoading } = useQueues(projectId);
  const { data: jobsPage, isLoading: jobsLoading } = useJobs(projectId, { status: BOARD_STATUSES, pageSize: 100 });
  const moveJob = useMoveJob(projectId);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [showCreateJob, setShowCreateJob] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const jobsByQueue = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of jobsPage?.data ?? []) {
      const list = map.get(job.queueId) ?? [];
      list.push(job);
      map.set(job.queueId, list);
    }
    return map;
  }, [jobsPage]);

  function handleDragStart(event: DragStartEvent) {
    const job = jobsPage?.data.find((j) => j.id === event.active.id);
    setActiveJob(job ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveJob(null);
    const { active, over } = event;
    if (!over) return;
    const fromQueueId = active.data.current?.queueId as string | undefined;
    const toQueueId = over.id as string;
    if (!fromQueueId || fromQueueId === toQueueId) return;
    moveJob.mutate({ jobId: active.id as string, queueId: toQueueId });
  }

  if (!projectId) return <EmptyState>Select or create a project first.</EmptyState>;
  if (queuesLoading || jobsLoading) return <LoadingBlock />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Board</h1>
          <span className="dim">Drag a job card between queues to move it. Double-click a card to open it.</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreateJob(true)}>
          New job
        </button>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="board">
          {queues?.map((queue) => (
            <BoardColumn key={queue.id} queue={queue} jobs={jobsByQueue.get(queue.id) ?? []} />
          ))}
        </div>
        <DragOverlay>
          {activeJob && (
            <div className="board-card" style={{ borderLeftColor: getPriorityInfo(activeJob.priority).color, cursor: "grabbing" }}>
              <div className="board-card-type">{activeJob.type}</div>
              <div className="board-card-meta">
                <StatusBadge status={activeJob.status} />
                <PriorityChip priority={activeJob.priority} />
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {!queues?.length && <EmptyState>No queues yet — create one on the Queues page.</EmptyState>}

      {showCreateJob && projectId && <CreateJobModal projectId={projectId} onClose={() => setShowCreateJob(false)} />}
    </div>
  );
}
