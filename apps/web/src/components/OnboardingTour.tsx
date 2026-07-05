import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export interface TourStep {
  target: string;
  title: string;
  description: string;
  placement?: "right" | "bottom" | "left" | "top";
}

export const ONBOARDING_DONE_KEY = "jsp_onboarding_done";

export const TOUR_STEPS: TourStep[] = [
  {
    target: "brand",
    title: "Welcome to Job Scheduler",
    description: "A quick 30-second tour of where everything lives — use Next to continue, or Skip anytime.",
    placement: "right",
  },
  {
    target: "nav-dashboard",
    title: "Dashboard",
    description: "System health at a glance: queued/running/dead-lettered counts, throughput over time, and a priority breakdown.",
    placement: "right",
  },
  {
    target: "nav-queues",
    title: "Queues",
    description: "Create and configure queues here — priority, concurrency limits, rate limits, and retry policies.",
    placement: "right",
  },
  {
    target: "nav-board",
    title: "Board",
    description: "Drag a job card from one queue's column to another to move it there.",
    placement: "right",
  },
  {
    target: "nav-calendar",
    title: "Calendar",
    description: "See what's scheduled each day, color-coded by priority.",
    placement: "right",
  },
  {
    target: "nav-jobs",
    title: "Jobs",
    description: "Search, filter, and create jobs across every queue in this project — this is the fastest way to create a job from anywhere.",
    placement: "right",
  },
  {
    target: "nav-workers",
    title: "Workers",
    description: "Monitor the worker fleet — status, heartbeats, and active job counts.",
    placement: "right",
  },
  {
    target: "nav-dlq",
    title: "Dead Letter Queue",
    description: "Jobs that exhausted their retries land here. Retry or resolve them from this page.",
    placement: "right",
  },
  {
    target: "org-project-picker",
    title: "Organization & project",
    description: "Switch between organizations and projects here — everything else on screen scopes to your selection.",
    placement: "bottom",
  },
  {
    target: "theme-toggle",
    title: "Light / dark mode",
    description: "Toggle the theme anytime — your choice is remembered on this device.",
    placement: "bottom",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getRect(selector: string): Rect | null {
  const el = document.querySelector(`[data-tour="${selector}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function track() {
      setRect(getRect(TOUR_STEPS[step].target));
      frameRef.current = requestAnimationFrame(track);
    }
    track();
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [open, step]);

  if (!open) return null;

  const total = TOUR_STEPS.length;
  const current = TOUR_STEPS[step];

  function finish() {
    localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    onClose();
  }

  function next() {
    if (step >= total - 1) finish();
    else setStep((s) => s + 1);
  }

  function prev() {
    setStep((s) => Math.max(0, s - 1));
  }

  const bubbleWidth = 300;
  const gap = 16;
  let bubbleStyle: CSSProperties = { visibility: "hidden" };

  if (rect) {
    const placement = current.placement ?? "right";
    if (placement === "right") {
      bubbleStyle = {
        top: Math.min(Math.max(16, rect.top + rect.height / 2 - 90), window.innerHeight - 220),
        left: Math.min(rect.left + rect.width + gap, window.innerWidth - bubbleWidth - 16),
      };
    } else if (placement === "left") {
      bubbleStyle = { top: rect.top, left: Math.max(16, rect.left - bubbleWidth - gap) };
    } else if (placement === "bottom") {
      bubbleStyle = { top: rect.top + rect.height + gap, left: Math.min(rect.left, window.innerWidth - bubbleWidth - 16) };
    } else {
      bubbleStyle = { top: Math.max(16, rect.top - gap - 160), left: rect.left };
    }
  }

  return (
    <>
      {rect && (
        <motion.div
          className="tour-spotlight"
          animate={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
        />
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className="tour-bubble"
          style={bubbleStyle}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.18 }}
        >
          <button className="tour-close" onClick={finish} title="Close tour">
            <X size={14} />
          </button>
          <div className="tour-step-count">
            Step {step + 1} of {total}
          </div>
          <div className="tour-title">{current.title}</div>
          <p className="tour-desc">{current.description}</p>
          <div className="tour-actions">
            <button className="btn btn-sm" onClick={finish}>
              Skip tour
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              {step > 0 && (
                <button className="btn btn-sm" onClick={prev}>
                  Back
                </button>
              )}
              <button className="btn btn-sm btn-primary" onClick={next}>
                {step === total - 1 ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
