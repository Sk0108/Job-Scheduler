import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ProjectContextValue {
  organizationId: string | null;
  projectId: string | null;
  setOrganizationId: (id: string | null) => void;
  setProjectId: (id: string | null) => void;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [organizationId, setOrganizationIdState] = useState<string | null>(localStorage.getItem("jsp_org_id"));
  const [projectId, setProjectIdState] = useState<string | null>(localStorage.getItem("jsp_project_id"));

  function setOrganizationId(id: string | null) {
    setOrganizationIdState(id);
    if (id) localStorage.setItem("jsp_org_id", id);
    else localStorage.removeItem("jsp_org_id");
  }

  function setProjectId(id: string | null) {
    setProjectIdState(id);
    if (id) localStorage.setItem("jsp_project_id", id);
    else localStorage.removeItem("jsp_project_id");
  }

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Switching orgs invalidates whatever project was selected under the previous one.
    setProjectId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  return (
    <ProjectContext.Provider value={{ organizationId, projectId, setOrganizationId, setProjectId }}>{children}</ProjectContext.Provider>
  );
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectContext must be used within ProjectProvider");
  return ctx;
}
