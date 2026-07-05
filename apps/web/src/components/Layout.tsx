import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertOctagon,
  Building2,
  CalendarDays,
  ChevronsLeft,
  Cpu,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  ListTree,
  LogOut,
  Moon,
  Sun,
  Timer,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useProjectContext } from "../context/ProjectContext";
import { useOrganizations, useProjects } from "../api/hooks";
import { subscribeToProject } from "../lib/socket";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/queues", label: "Queues", icon: ListTree },
  { to: "/board", label: "Board", icon: KanbanSquare },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/jobs", label: "Jobs", icon: ListChecks },
  { to: "/workers", label: "Workers", icon: Cpu },
  { to: "/dlq", label: "Dead Letter Queue", icon: AlertOctagon },
  { to: "/settings", label: "Organization", icon: Building2 },
];

const SIDEBAR_WIDTH = 220;
const SIDEBAR_COLLAPSED_WIDTH = 64;

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { organizationId, projectId, setOrganizationId, setProjectId } = useProjectContext();
  const { data: orgs } = useOrganizations();
  const { data: projects } = useProjects(organizationId);
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("jsp_sidebar_collapsed") === "1");

  useEffect(() => {
    localStorage.setItem("jsp_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (!organizationId && orgs?.length) setOrganizationId(orgs[0].id);
  }, [orgs, organizationId, setOrganizationId]);

  useEffect(() => {
    if (!projectId && projects?.length) setProjectId(projects[0].id);
  }, [projects, projectId, setProjectId]);

  // Live updates: any lifecycle event for this project invalidates the relevant queries so
  // affected views refetch immediately instead of waiting out the polling interval, and select
  // events surface as toasts so an operator watching the dashboard notices without digging in.
  useEffect(() => {
    if (!projectId) return;
    const unsubscribe = subscribeToProject(projectId, (type, payload) => {
      if (type.startsWith("job.")) {
        qc.invalidateQueries({ queryKey: ["jobs"] });
        qc.invalidateQueries({ queryKey: ["job"] });
        qc.invalidateQueries({ queryKey: ["dlq"] });
        qc.invalidateQueries({ queryKey: ["health", projectId] });
        qc.invalidateQueries({ queryKey: ["queue-stats"] });
        qc.invalidateQueries({ queryKey: ["priority-distribution", projectId] });
      } else if (type.startsWith("worker.")) {
        qc.invalidateQueries({ queryKey: ["workers"] });
        qc.invalidateQueries({ queryKey: ["worker"] });
      } else if (type === "queue.updated") {
        qc.invalidateQueries({ queryKey: ["queues", projectId] });
      }

      const data = (payload as { data?: Record<string, unknown> })?.data;
      if (type === "job.dead_lettered") {
        pushToast({ kind: "error", title: "Job moved to Dead Letter Queue", message: (data?.lastError as string) ?? undefined });
      } else if (type === "worker.offline") {
        pushToast({ kind: "warning", title: "A worker went offline" });
      } else if (type === "queue.updated" && data?.jobMoved) {
        pushToast({ kind: "info", title: "Job moved between queues" });
      }
    });
    return unsubscribe;
  }, [projectId, qc, pushToast]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <motion.aside
        className="sidebar"
        animate={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
        transition={{ type: "spring", stiffness: 350, damping: 32 }}
      >
        <div className="brand">
          <Timer size={20} />
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }}>
                Job Scheduler
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} title={item.label} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon size={17} style={{ flexShrink: 0 }} />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    className="label"
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </NavLink>
          );
        })}

        {/* Always rendered at the same spot regardless of collapsed state — pinned to the
            sidebar's edge rather than buried in the nav list — so it's never hard to find. */}
        <motion.button
          className="sidebar-edge-toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
        >
          <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 22 }} style={{ display: "flex" }}>
            <ChevronsLeft size={14} />
          </motion.span>
        </motion.button>
      </motion.aside>
      <div className="main">
        <div className="topbar">
          <div style={{ display: "flex", gap: 10 }}>
            <select className="select" value={organizationId ?? ""} onChange={(e) => setOrganizationId(e.target.value || null)}>
              {!orgs?.length && <option value="">No organizations</option>}
              {orgs?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select className="select" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)}>
              {!projects?.length && <option value="">No projects</option>}
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <motion.button
              className="btn btn-sm btn-icon"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.9 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ opacity: 0, rotate: -60, scale: 0.6 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 60, scale: 0.6 }}
                  transition={{ duration: 0.2 }}
                  style={{ display: "flex" }}
                >
                  {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <span className="dim">{user?.name}</span>
            <button className="btn btn-sm" onClick={handleLogout}>
              <LogOut size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
              Log out
            </button>
          </div>
        </div>
        <div className="content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
