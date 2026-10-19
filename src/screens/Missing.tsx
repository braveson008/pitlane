import { useState } from "react";
import { api, isFailure, type Project } from "../api";

export function Missing({ project, onFound }: { project: Project; onFound: (project: Project) => void }) {
  const [error, setError] = useState("");

  async function locate() {
    setError("");
    const located = await api().projects.locate(project.id);
    if (!located) return;
    if (isFailure(located)) return setError(located.error);
    onFound(located);
  }

  return (
    <main className="screen">
      <p className="hi">{project.name}</p>
      <p className="need">Folder not found</p>
      <p className="lo">{project.path}</p>
      <p className="lo">It may have been moved or renamed. Point Pitlane at its new location; only the same repository is accepted.</p>
      <button type="button" className="row wide" onClick={() => void locate()}><span className="id">Locate…</span></button>
      {error ? <p className="need" role="alert">{error}</p> : null}
    </main>
  );
}
