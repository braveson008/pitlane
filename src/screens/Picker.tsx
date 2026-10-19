import { useEffect, useState } from "react";
import { api, isFailure, type Project } from "../api";

export function Picker() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    void api().projects.list().then(setProjects);
  }, []);

  async function openFolder() {
    setError("");
    const chosen = await api().projects.chooseFolder();
    if (!chosen) return;
    const project = await api().projects.add(chosen.path);
    if (isFailure(project)) return setError(project.error);
    setProjects(await api().projects.list());
    await api().projects.open(project.id);
  }

  // The last row is "Open folder…", so the list and the action share one cursor.
  const rows = projects.length + 1;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "j") setSelected((index) => Math.min(rows - 1, index + 1));
      if (event.key === "ArrowUp" || event.key === "k") setSelected((index) => Math.max(0, index - 1));
      if (event.key === "Enter") {
        if (selected < projects.length) void api().projects.open(projects[selected].id);
        else void openFolder();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });


  return (
    <main className="screen picker">
      <p className="hi">PITLANE</p>
      <p className="lo">Pick a project. Each one opens in its own window.</p>
      <ul className="rows">
        {projects.map((project, index) => (
          <li key={project.id}>
            <button type="button" className={`row wide${index === selected ? " sel" : ""}`} onClick={() => void api().projects.open(project.id)}>
              <span className="hi">{project.name}</span> <span className="lo">{project.path}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className={`row wide${selected === projects.length ? " sel" : ""}`} onClick={() => void openFolder()}>
            <span className="id">Open folder…</span>
          </button>
        </li>
      </ul>
      {error ? <p className="need" role="alert">{error}</p> : null}
    </main>
  );
}
