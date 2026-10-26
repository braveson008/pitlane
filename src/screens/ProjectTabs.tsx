import { useEffect, useState } from "react";
import { api, isFailure, type Project } from "../api";
import { projectKey } from "../lib/keys";

/** Every project as a tab in the title bar: click one, or ⌘1–⌘9, and this window shows it. + adds a folder. */
export function ProjectTabs({ currentId }: { currentId: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState<Record<string, number>>({});

  useEffect(() => {
    void api().projects.attention().then(setWaiting);
    return api().projects.onAttention(setWaiting);
  }, []);

  useEffect(() => {
    const load = () => void api().projects.list().then(setProjects);
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const index = projectKey(event);
      if (index === null) return;
      // Captured before the terminal sees it, so the agent never gets the keystroke.
      event.preventDefault();
      event.stopPropagation();
      const target = projects[index];
      if (target && target.id !== currentId) void api().projects.switch(target.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projects, currentId]);

  async function add() {
    setError("");
    const chosen = await api().projects.chooseFolder();
    if (!chosen) return;
    const project = await api().projects.add(chosen.path);
    if (isFailure(project)) return setError(project.error);
    await api().projects.switch(project.id);
  }

  return (
    <nav className="project-tabs" aria-label="Projects">
      {projects.map((project, index) => (
        <button
          key={project.id}
          type="button"
          className={project.id === currentId ? "tab current" : "tab"}
          title={[index < 9 ? `⌘${index + 1}` : "", waiting[project.id] ? `${waiting[project.id]} waiting on you` : ""].filter(Boolean).join(" · ") || undefined}
          aria-current={project.id === currentId ? "page" : undefined}
          onClick={() => { if (project.id !== currentId) void api().projects.switch(project.id); }}
        >
          {project.name}
          {waiting[project.id] ? <span className="need waiting"> !{waiting[project.id]}</span> : null}
        </button>
      ))}
      <button type="button" className="tab add" title="Add a project folder" aria-label="Add project" onClick={() => void add()}>+</button>
      {error ? <span className="need" role="alert">{error}</span> : null}
    </nav>
  );
}
