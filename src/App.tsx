import { useEffect, useState } from "react";
import { api, type Project, type ProjectStatus, type Session, type Slot, type Ticket } from "./api";
import { Home } from "./screens/Home";
import { SessionView } from "./screens/SessionView";
import { Switcher } from "./screens/Switcher";
import { Changes } from "./screens/Changes";
import { Draft } from "./screens/Draft";
import { Watches } from "./screens/Watches";
import { orderSessions } from "./lib/sessionOrder";
import type { SessionAction } from "./lib/keys";
import { isFailure } from "./api";
import { Picker } from "./screens/Picker";
import { Missing } from "./screens/Missing";
import { themeFor, type ThemeId } from "./theme/themes";

const projectId = new URLSearchParams(location.search).get("project");

function ProjectWindow({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);

  useEffect(() => {
    void (async () => {
      const found = (await api().projects.list()).find((candidate) => candidate.id === id) ?? null;
      setProject(found);
      setStatus(found ? await api().projects.status(id) : "missing");
    })();
  }, [id]);

  useEffect(() => { if (project) document.title = project.name; }, [project]);

  // The folder can be moved while the window is open; look again whenever the window comes back to the front.
  useEffect(() => {
    const recheck = () => void api().projects.status(id).then(setStatus);
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [id]);
  const theme = useTheme(project ?? undefined);
  const { sessions, workspaces } = useSessions(id);
  const { tickets, pausedUntil } = useTickets(id);
  useEffect(() => api().onProjectChanged((payload) => { if (payload.project.id === id) setProject(payload.project); }), [id]);
  // A notification click asks for a particular session.
  useEffect(() => api().onOpenSession((payload) => setOpenSession(payload.sessionId)), []);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [editingWatches, setEditingWatches] = useState(false);
  const [changesFor, setChangesFor] = useState<{ sessionId: string; from: "home" | "session" } | null>(null);

  // ⌘K opens the switcher from home too; inside a session the terminal's key hook raises it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.altKey && !event.ctrlKey && event.key === "k" && !openSession) {
        event.preventDefault();
        setSwitching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSession]);

  if (!project || !status) return null;
  if (status !== "ok") return <Missing project={project} onFound={(found) => { setProject(found); setStatus("ok"); }} />;
  const switcher = switching ? (
    <Switcher
      sessions={sessions}
      currentId={openSession ?? undefined}
      onPick={(session) => { setSwitching(false); setOpenSession(session.id); }}
      onClose={() => {
        setSwitching(false);
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus());
      }}
    />
  ) : null;

  const drafting = draftFor ? tickets.find((ticket) => ticket.key === draftFor && ticket.state === "review-ready") : undefined;
  if (drafting) return <Draft key={drafting.key} project={project} ticket={drafting} onBack={() => setDraftFor(null)} />;

  if (editingWatches) return <Watches project={project} onProject={setProject} onBack={() => setEditingWatches(false)} />;

  const reviewing = changesFor && sessions.find((session) => session.id === changesFor.sessionId);
  if (reviewing && changesFor) {
    return (
      <Changes
        project={project}
        session={reviewing}
        onBack={() => {
          setChangesFor(null);
          setOpenSession(changesFor.from === "session" ? reviewing.id : null);
        }}
      />
    );
  }

  const current = sessions.find((session) => session.id === openSession);
  if (current) {
    const onAction = (action: SessionAction) => {
      if (action === "home") return setOpenSession(null);
      if (action === "switcher") return setSwitching(true);
      if (action === "changes") return setChangesFor({ sessionId: current.id, from: "session" });
      if (action === "prev" || action === "next") {
        const order = orderSessions(sessions, Date.now());
        const index = order.findIndex((session) => session.id === current.id);
        const next = order[(index + (action === "next" ? 1 : order.length - 1)) % order.length];
        if (next) setOpenSession(next.id);
      }
    };
    const onRestart = async (ended: Session) => {
      const created = await api().sessions.create(project.id, ended.agent);
      if (!isFailure(created)) setOpenSession(created.id);
    };
    return (
      <>
        <SessionView key={current.id} project={project} session={current} theme={theme} onAction={onAction} onRestart={(ended) => void onRestart(ended)} />
        {switcher}
      </>
    );
  }
  // A session that was just started can be opened before the list that includes it arrives.
  if (openSession) return <header className="statusline"><span className="lo">Starting…</span></header>;
  return (
    <>
      <Home project={project} theme={theme} sessions={sessions} workspaces={workspaces} tickets={tickets} pausedUntil={pausedUntil} paused={switching} onMissing={() => setStatus("missing")} onWatches={() => setEditingWatches(true)} onOpen={(session) => setOpenSession(session.id)} onChanges={(session) => setChangesFor({ sessionId: session.id, from: "home" })} onDraft={(ticket) => setDraftFor(ticket.key)} onProject={setProject} />
      {switcher}
    </>
  );
}

function useSessions(projectId: string): { sessions: Session[]; workspaces: Slot[] } {
  const [state, setState] = useState<{ sessions: Session[]; workspaces: Slot[] }>({ sessions: [], workspaces: [] });
  useEffect(() => {
    void Promise.all([api().sessions.list(projectId), api().workspaces.list(projectId)]).then(([sessions, workspaces]) => setState({ sessions, workspaces }));
    return api().sessions.onChanged((payload) => { if (payload.projectId === projectId) setState({ sessions: payload.sessions, workspaces: payload.workspaces }); });
  }, [projectId]);
  return state;
}

function useTickets(projectId: string): { tickets: Ticket[]; pausedUntil: number | null } {
  const [state, setState] = useState<{ tickets: Ticket[]; pausedUntil: number | null }>({ tickets: [], pausedUntil: null });
  useEffect(() => {
    void api().tickets.list(projectId).then(setState);
    return api().tickets.onChanged((payload) => { if (payload.projectId === projectId) setState({ tickets: payload.tickets, pausedUntil: payload.pausedUntil }); });
  }, [projectId]);
  return state;
}

export function useTheme(project?: { theme?: ThemeId }) {
  const [defaultTheme, setDefaultTheme] = useState<ThemeId | undefined>();
  useEffect(() => { void api().settings.get().then((settings) => setDefaultTheme(settings.defaultTheme)); }, []);
  const theme = themeFor(project, { defaultTheme });
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return theme;
}

function PickerWindow() {
  useTheme();
  return <Picker />;
}

export function App() {
  return (
    <div className="frame">
      <div className="titlebar" />
      {projectId ? <ProjectWindow id={projectId} /> : <PickerWindow />}
    </div>
  );
}
