import { useEffect, useMemo, useState } from "react";
import { api, isFailure, type AgentId, type Project, type Session, type Slot, type Ticket } from "../api";
import { LocalFiles } from "./LocalFiles";
import { UpdateNote, useUpdateState } from "./UpdateNote";
import { ago, orderSessions, sessionMarker, stateLabel } from "../lib/sessionOrder";
import { homeKey } from "../lib/keys";
import { nextTheme, THEME_LABEL, THEME_ORDER, type ThemeId } from "../theme/themes";
import { notStarted, upNext } from "../lib/queue";
import { watchSource, watchTitle } from "../lib/watches";

const AGENT_CHOICES: AgentId[] = ["claude", "codex"];

interface HomeProps {
  project: Project;
  theme: ThemeId;
  sessions: Session[];
  workspaces: Slot[];
  tickets: Ticket[];
  pausedUntil: number | null;
  onOpen: (session: Session) => void;
  onChanges: (session: Session) => void;
  onDraft: (ticket: Ticket) => void;
  onProject: (project: Project) => void;
  onMissing: () => void;
  onWatches: () => void;
  /** True while something over the screen (the switcher) owns the keyboard. */
  paused?: boolean;
}

export function Home({ project, theme, sessions, workspaces, tickets, pausedUntil, onOpen, onChanges, onDraft, onProject, onMissing, onWatches, paused = false }: HomeProps) {
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(0);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const [confirmLocal, setConfirmLocal] = useState<{ candidates: string[]; agent: AgentId } | null>(null);
  const [parking, setParking] = useState<number | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [showAssigned, setShowAssigned] = useState(false);
  const ordered = useMemo(() => orderSessions(sessions, now), [sessions, now]);
  const update = useUpdateState();
  const watches = project.watches ?? [];
  const waiting = tickets.filter((ticket) => ticket.state === "needs-you" || ticket.state === "review-ready");
  const next = upNext(tickets);
  const assigned = notStarted(tickets);
  const reviews = tickets.filter((ticket) => ticket.state === "in-review");
  const busySlots = workspaces.filter((slot) => slot.state !== "free").length;
  // One cursor over everything on the screen, in the order it is drawn.
  type Row = { kind: "ticket"; ticket: Ticket } | { kind: "session"; session: Session } | { kind: "review"; ticket: Ticket } | { kind: "assigned" };
  const rows: Row[] = [
    ...waiting.map((ticket) => ({ kind: "ticket" as const, ticket })),
    ...ordered.map((session) => ({ kind: "session" as const, session })),
    ...next.map((ticket) => ({ kind: "ticket" as const, ticket })),
    ...(assigned.length ? [{ kind: "assigned" as const }] : []),
    ...(showAssigned ? assigned.map((ticket) => ({ kind: "ticket" as const, ticket })) : []),
    ...reviews.map((ticket) => ({ kind: "review" as const, ticket })),
  ];
  const current = rows[Math.min(selected, rows.length - 1)];
  const currentSession = current?.kind === "session" ? current.session : undefined;
  const currentTicket = current?.kind === "ticket" ? current.ticket : undefined;
  const isSelected = (row: (item: Row) => boolean) => current !== undefined && row(current);
  const heldBy = (session: Session) => workspaces.find((slot) => slot.sessionId === session.id && slot.state === "held");
  const endedCount = ordered.filter((session) => session.state !== "running" && !heldBy(session)).length;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setSelected((index) => Math.min(index, Math.max(0, rows.length - 1))); }, [rows.length]);

  async function start(agent: AgentId) {
    setChoosing(null);
    setError("");
    const session = await api().sessions.create(project.id, agent);
    if (isFailure(session)) {
      if (session.missing) return onMissing();
      if (session.error === "confirm-local-files") return setConfirmLocal({ candidates: session.candidates ?? [], agent });
      return setError(session.error);
    }
    onOpen(session);
  }

  async function confirmLocalFiles(files: string[]) {
    const agent = confirmLocal?.agent ?? "claude";
    setConfirmLocal(null);
    const updated = await api().projects.update(project.id, { localFiles: files });
    if (isFailure(updated)) return setError(updated.error);
    onProject(updated);
    await start(agent);
  }

  async function park(session: Session) {
    const slot = heldBy(session);
    if (!slot) return;
    if (parking !== slot.index) {
      setParking(slot.index);
      setTimeout(() => setParking((current) => (current === slot.index ? null : current)), 4000);
      return;
    }
    setParking(null);
    const result = await api().workspaces.park(project.id, slot.index, session.id);
    if (isFailure(result)) setError(result.error);
  }

  async function cycleLimit() {
    const updated = await api().projects.update(project.id, { agentLimit: (project.agentLimit % 3) + 1 });
    if (!isFailure(updated)) onProject(updated);
  }

  function stop(session: Session) {
    if (session.state !== "running") return;
    if (stopping !== session.id) {
      setStopping(session.id);
      setTimeout(() => setStopping((current) => (current === session.id ? null : current)), 4000);
      return;
    }
    setStopping(null);
    void api().sessions.stop(session.id);
  }

  async function unqueue(ticket: Ticket) {
    const result = await api().tickets.unqueue(project.id, ticket.key);
    if (isFailure(result)) setError(result.error);
  }

  function startTicket(ticket: Ticket) {
    if (ticket.state === "review-ready") return onDraft(ticket);
    const running = sessions.find((session) => session.id === ticket.sessionId && session.state === "running");
    if (running) return onOpen(running);
    void api().tickets.start(project.id, ticket.key);
  }

  async function cycleTheme() {
    const updated = await api().projects.update(project.id, { theme: nextTheme(theme) });
    if (!isFailure(updated)) onProject(updated);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (paused || confirmLocal) return;
      if (choosing !== null) {
        if (event.key === "Escape") setChoosing(null);
        if (event.key === "ArrowDown" || event.key === "j") setChoosing((index) => Math.min(AGENT_CHOICES.length - 1, (index ?? 0) + 1));
        if (event.key === "ArrowUp" || event.key === "k") setChoosing((index) => Math.max(0, (index ?? 0) - 1));
        if (event.key === "Enter") void start(AGENT_CHOICES[choosing]);
        event.preventDefault();
        return;
      }
      const action = homeKey(event);
      if (!action) return;
      event.preventDefault();
      if (action === "watches") return onWatches();
      if (action === "update") return void (update?.status === "ready" ? api().updates.install() : api().updates.check());
      if (action === "assigned") return setShowAssigned((shown) => !shown);
      if (action === "stop" && currentSession) return stop(currentSession);
      if (action === "clear") {
        if (!endedCount) return;
        return void api().sessions.clearEnded(project.id);
      }
      if (action === "openPr") {
        const pr = current?.kind === "review" ? current.ticket.prUrl : reviews[0]?.prUrl;
        if (pr) return void api().links.open(pr);
      }
      if (action === "down") setSelected((index) => Math.min(rows.length - 1, index + 1));
      if (action === "up") setSelected((index) => Math.max(0, index - 1));
      if (action === "open" && current) {
        if (current.kind === "session") onOpen(current.session);
        else if (current.kind === "ticket") startTicket(current.ticket);
        else if (current.kind === "assigned") setShowAssigned((shown) => !shown);
        else if (current.ticket.prUrl) void api().links.open(current.ticket.prUrl);
      }
      if (action === "new") setChoosing(0);
      if (action === "theme") void cycleTheme();
      if (action === "help") setHelp((shown) => !shown);
      if (action === "park" && currentSession) void park(currentSession);
      if (action === "park" && currentTicket?.state === "queued") void unqueue(currentTicket);
      if (action === "limit") void cycleLimit();
      if (action === "changes" && currentSession) onChanges(currentSession);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const running = ordered.filter((session) => session.state === "running").length;

  return (
    <>
      <header className="statusline">
        {theme === "acme" ? (
          <>
            <span className="hi">/{project.name}/</span>
            <button type="button" className="tagword" onClick={() => setChoosing(0)}>New</button>
            <button type="button" className="tagword" onClick={() => void cycleTheme()}>Theme</button>
            <button type="button" className="tagword" onClick={() => setHelp((shown) => !shown)}>Help</button>
          </>
        ) : (
          <>
            <span className="hi glitch">{theme === "night-city" ? `${project.name}//` : project.name}</span>
            <span className="ok">{project.trunk}</span>
          </>
        )}
        <span className="spacer" />
        <UpdateNote />
        <span className="lo">{ordered.length} {ordered.length === 1 ? "session" : "sessions"}{running ? ` · ${running} running` : ""}</span>
      </header>

      <div className="screen">
        <section className="section" aria-label="Sessions">
          <p className="hi heading">SESSIONS</p>
          {ordered.length === 0 ? <p className="lo">No sessions yet. Press n to start an agent.</p> : null}
          <p className="lo">workspaces {busySlots}/{project.agentLimit} in use{endedCount ? ` · ${endedCount} ended · C clears them` : ""}</p>
          {pausedUntil ? <p className="need">paused: usage limit · resumes {new Date(pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p> : null}
          <div className="rows">{waiting.map((ticket) => (
            <button key={ticket.key} type="button" className={`row${isSelected((row) => row.kind === "ticket" && row.ticket.key === ticket.key) ? " sel" : ""}`} onClick={() => startTicket(ticket)}>
              <span className="need">!</span>
              <span><span className="id">{ticket.key}</span> {ticket.title}</span>
              <span className="need">{ticket.state === "review-ready" ? "review ready" : "needs you"}</span>
              <span className="lo">{ticket.state === "review-ready" ? ticket.draft?.verdict : ticket.reason}</span>
              <span className="lo right">{ago(ticket.updatedAt, now)}</span>
            </button>
          ))}</div>
          <ul className="rows">
            {ordered.map((session, index) => {
              const marker = sessionMarker(session);
              return (
                <li key={session.id}>
                  <button type="button" className={`row${isSelected((row) => row.kind === "session" && row.session.id === session.id) ? " sel" : ""}`} onClick={() => onOpen(session)}>
                    <span className={marker === "!" ? "need" : "ok"}>{marker}</span>
                    <span className={session.state === "exited" ? "lo" : undefined}>{session.ticketKey ? <span className="id">{session.ticketKey} </span> : null}{session.ticketKey ? session.name.slice(session.ticketKey.length + 1) : session.name}{session.warning ? <span className="lo"> · {session.warning}</span> : null}</span>
                    <span className="agent">{session.agent}</span>
                    <span className={heldBy(session) ? "need" : session.state === "failed" ? "need" : session.state === "running" ? "ok" : "lo"}>
                      {heldBy(session) ? `held · ${heldBy(session)?.heldReason}` : stateLabel(session)}
                    </span>
                    <span className="lo right">{ago(session.createdAt, now)}</span>
                  </button>
                  {session.error && currentSession?.id === session.id ? <p className="need row wide">  {session.error}</p> : null}
                  {heldBy(session) && parking === heldBy(session)?.index ? <p className="need row wide">  park? x again — its work is committed on {session.branch} and kept</p> : null}
                  {stopping === session.id ? <p className="need row wide">  stop this agent? s again — its workspace and changes are kept</p> : null}
                </li>
              );
            })}
          </ul>
          {choosing !== null ? (
            <div className="chooser" role="listbox" aria-label="Agent for the new session">
              <p className="lo">  start which agent?</p>
              {AGENT_CHOICES.map((agent, index) => (
                <button key={agent} type="button" role="option" aria-selected={index === choosing} className={`row${index === choosing ? " sel" : ""}`} onClick={() => void start(agent)}>
                  <span> </span><span className="agent">{agent}</span>
                </button>
              ))}
            </div>
          ) : null}
          {error ? <p className="need" role="alert">{error}</p> : null}
        </section>

        {confirmLocal ? <LocalFiles candidates={confirmLocal.candidates} onConfirm={(files) => void confirmLocalFiles(files)} onCancel={() => setConfirmLocal(null)} /> : null}

        {next.length ? (
          <section className="section" aria-label="Up next">
            <p className="hi heading">UP NEXT</p>
            <p className="lo">{busySlots < project.agentLimit ? "starting now" : `starts by itself when a workspace is free (${busySlots}/${project.agentLimit} in use · L for more)`}</p>
            <div className="rows">{next.map((ticket, index) => (
              <button key={ticket.key} type="button" className={`row${isSelected((row) => row.kind === "ticket" && row.ticket.key === ticket.key) ? " sel" : ""}`} onClick={() => startTicket(ticket)} title={ticket.url}>
                <span className="hi">{index + 1}</span>
                <span><span className="id">{ticket.key}</span> {ticket.title}</span>
                <span className="lo">{ticket.priority === "review" ? "review" : ticket.priority === "feedback" ? "feedback" : "ticket"}</span>
                <span className="lo">{isSelected((row) => row.kind === "ticket" && row.ticket.key === ticket.key) ? "x take out" : ""}</span>
                <span className="lo right">{ago(ticket.firstSeenAt, now)}</span>
              </button>
            ))}</div>
          </section>
        ) : null}

        {assigned.length ? (
          <section className="section" aria-label="Not started">
            <p className="hi heading">NOT STARTED</p>
            <div className="rows">
              <button type="button" className={`row${isSelected((row) => row.kind === "assigned") ? " sel" : ""}`} onClick={() => setShowAssigned((shown) => !shown)}>
                <span className="lo">{showAssigned ? "▾" : "▸"}</span>
                <span className="lo">{assigned.length} assigned before the watch began, or from outside the team · Pitlane won't start these by itself</span>
                <span className="lo">{showAssigned ? "a hide" : "a show"}</span>
                <span /><span />
              </button>
              {showAssigned ? assigned.map((ticket) => (
                <button key={ticket.key} type="button" className={`row${isSelected((row) => row.kind === "ticket" && row.ticket.key === ticket.key) ? " sel" : ""}`} onClick={() => startTicket(ticket)} title={ticket.url}>
                  <span className="lo">·</span>
                  <span><span className="id">{ticket.key}</span> {ticket.title}</span>
                  <span className="lo">{ticket.key.startsWith("review:") ? "review" : "ticket"}</span>
                  <span className="lo">enter up next</span>
                  <span className="lo right">{ago(ticket.firstSeenAt, now)}</span>
                </button>
              )) : null}
            </div>
          </section>
        ) : null}

        {reviews.length ? (
          <section className="section" aria-label="In review">
            <p className="hi heading">IN REVIEW</p>
            <div className="rows">{reviews.map((ticket) => (
              <button key={ticket.key} type="button" className={`row${isSelected((row) => row.kind === "review" && row.ticket.key === ticket.key) ? " sel" : ""}`} onClick={() => ticket.prUrl && void api().links.open(ticket.prUrl)}>
                <span className="ok">~</span>
                <span><span className="id">{ticket.key}</span> {ticket.title}</span>
                <span className="lo">in review</span>
                <span className="id">{ticket.prUrl?.replace(/^https?:\/\/[^/]+\//, "")}</span>
                <span className="lo right">{ago(ticket.updatedAt, now)}</span>
              </button>
            ))}</div>
          </section>
        ) : null}

        <section className="section" aria-label="Watches">
          <p className="hi heading">WATCHES</p>
          {watches.length ? (
            <div className="rows">{watches.map((watch) => (
              <p key={watch.id} className="row">
                <span className={watch.lastError ? "need" : watch.enabled ? "ok" : "lo"}>{watch.enabled ? "●" : "○"}</span>
                <span>{watchTitle(watch)} <span className="id">{watchSource(watch, project)}</span>{watch.scope ? <span className="lo"> · only {watch.scope}</span> : null}</span>
                <span className="agent">{watch.model}</span>
                <span className={watch.lastError ? "need" : watch.enabled ? "ok" : "lo"}>{watch.lastError ? "error" : watch.enabled ? "on" : "paused"}</span>
                <span className="lo right">{Math.round(watch.intervalSeconds / 60)}m</span>
              </p>
            ))}</div>
          ) : (
            <p className="lo">No watches yet · w to add one</p>
          )}
          {watches.some((watch) => watch.lastError) ? <p className="need">  {watches.find((watch) => watch.lastError)?.lastError}</p> : null}
        </section>

        {help ? (
          <section className="section" aria-label="Help">
            <p className="hi heading">KEYS</p>
            <p><span className="hi">enter</span> <span className="lo">open the selected session, start the selected ticket, or open the selected PR</span></p>
            <p><span className="hi">n</span> <span className="lo">start a new agent session</span></p>
            <p><span className="hi">t</span> <span className="lo">next theme ({THEME_ORDER.map((id) => THEME_LABEL[id]).join(", ")})</span></p>
            <p><span className="hi">w</span> <span className="lo">watches: add, edit, switch on or off, remove</span></p>
            <p><span className="hi">U</span> <span className="lo">restart into a new version once one is ready, or check for one</span></p>
            <p><span className="hi">s s</span> <span className="lo">stop the selected session's agent</span></p>
            <p><span className="hi">C</span> <span className="lo">clear ended sessions (ones holding kept work stay)</span></p>
            <p><span className="hi">a</span> <span className="lo">show or hide tickets that are not started · enter puts one up next · x takes it out</span></p>
            <p><span className="hi">p</span> <span className="lo">open the pull request of the first ticket in review</span></p>
            <p><span className="hi">c</span> <span className="lo">what the selected session's agent changed · ⌘D inside a session</span></p>
            <p><span className="hi">x x</span> <span className="lo">park a held session: commit its work locally and free its workspace</span></p>
            <p><span className="hi">L</span> <span className="lo">agents at once in this project (1–3)</span></p>
            <p><span className="hi">j k ↑ ↓</span> <span className="lo">move</span></p>
            <p><span className="hi">⌘K</span> <span className="lo">switch session · inside a session ⌘↑ comes back here</span></p>
          </section>
        ) : null}
      </div>

      <footer className="hints">
        <span><span className="key">enter</span> open</span>
        <span><span className="key">n</span> new</span>
        <span><span className="key">w</span> watches</span>
        <span><span className="key">t</span> theme</span>
        <span><span className="key">?</span> help</span>
      </footer>
    </>
  );
}
