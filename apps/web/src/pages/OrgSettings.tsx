import { useState, type FormEvent } from "react";
import {
  useAddOrgMember,
  useCreateOrganization,
  useCreateProject,
  useOrgMembers,
  useProjects,
  useRemoveOrgMember,
} from "../api/hooks";
import { useProjectContext } from "../context/ProjectContext";
import { LoadingBlock, EmptyState } from "../components/Spinner";
import { ApiClientError } from "../api/client";

export function OrgSettings() {
  const { organizationId } = useProjectContext();
  const { data: members, isLoading } = useOrgMembers(organizationId);
  const { data: projects } = useProjects(organizationId);
  const addMember = useAddOrgMember(organizationId);
  const removeMember = useRemoveOrgMember(organizationId);
  const createOrg = useCreateOrganization();
  const createProject = useCreateProject(organizationId);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER" | "VIEWER">("MEMBER");
  const [error, setError] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectSlug, setNewProjectSlug] = useState("");

  async function onAddMember(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addMember.mutateAsync({ email, role });
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to add member");
    }
  }

  async function onCreateOrg(e: FormEvent) {
    e.preventDefault();
    await createOrg.mutateAsync({ name: newOrgName, slug: newOrgSlug });
    setNewOrgName("");
    setNewOrgSlug("");
  }

  async function onCreateProject(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    await createProject.mutateAsync({ name: newProjectName, slug: newProjectSlug });
    setNewProjectName("");
    setNewProjectSlug("");
  }

  return (
    <div>
      <div className="page-header">
        <h1>Organization</h1>
      </div>

      <div className="section-title">Members</div>
      {!organizationId ? (
        <EmptyState>Select an organization first.</EmptyState>
      ) : isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="card" style={{ padding: 0, marginBottom: 20 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members?.map((m) => (
                <tr key={m.id}>
                  <td>{m.user.name}</td>
                  <td className="dim">{m.user.email}</td>
                  <td>{m.role}</td>
                  <td>
                    <button className="btn btn-sm btn-danger" onClick={() => removeMember.mutate(m.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {organizationId && (
        <form className="card" onSubmit={onAddMember} style={{ marginBottom: 24 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Invite an existing user
          </div>
          <div className="form-grid-2">
            <div className="form-row">
              <label>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-row">
              <label>Role</label>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="ADMIN">Admin</option>
                <option value="MEMBER">Member</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </div>
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={addMember.isPending}>
            Add member
          </button>
        </form>
      )}

      <div className="section-title">Projects</div>
      <div className="card" style={{ padding: 0, marginBottom: 20 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {projects?.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="mono dim">{p.slug}</td>
                <td className="dim">{p.description}</td>
              </tr>
            ))}
            {!projects?.length && (
              <tr>
                <td colSpan={3} className="dim">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <form className="card" onSubmit={onCreateProject} style={{ flex: 1, minWidth: 280 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            New project
          </div>
          <div className="form-row">
            <label>Name</label>
            <input className="input" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Slug</label>
            <input className="input mono" value={newProjectSlug} onChange={(e) => setNewProjectSlug(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={!organizationId || createProject.isPending}>
            Create project
          </button>
        </form>

        <form className="card" onSubmit={onCreateOrg} style={{ flex: 1, minWidth: 280 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            New organization
          </div>
          <div className="form-row">
            <label>Name</label>
            <input className="input" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Slug</label>
            <input className="input mono" value={newOrgSlug} onChange={(e) => setNewOrgSlug(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={createOrg.isPending}>
            Create organization
          </button>
        </form>
      </div>
    </div>
  );
}
