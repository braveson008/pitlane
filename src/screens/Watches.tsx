import { useEffect, useState } from "react";
import { api, type Project, type Watch, type WatchKind } from "../api";
import { ago } from "../lib/sessionOrder";
import { INTERVALS, MODELS, overlapNote, watchNotes, watchTitle, watchSource } from "../lib/watches";

interface WatchesProps {
  project: Project;
  onProject: (project: Project) => void;
  onBack: () => void;
}

type Field = "server" | "instructions" | "scope" | "interval" | "model";
type Text = "instructions" | "scope";
/** `describe`: a ticket watch whose instructions the owner writes before it is added. */
type Choice = { kind: WatchKind; server?: string; describe?: boolean };

/** For each of the project's watches, the other projects whose watch gets the same tickets. */
export function useOverlaps(project: Project) {
  const [overlaps, setOverlaps] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const load = () => void api().watches.overlaps(project.id).then(setOverlaps);
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [project]);
  return overlaps;
}

/** The "only from" this repository's history points at, or "". */
export function useSuggestedScope(project: Project) {
  const [suggested, setSuggested] = useState("");
  useEffect(() => { void api().watches.suggestScope(project.id).then(setSuggested); }, [project.id]);
  return suggested;
}

/** Every watch of the project, and everything about each one the owner can change. */
export function Watches({ project, onProject, onBack }: WatchesProps) {
  const watches = project.watches ?? [];
  const [at, setAt] = useState(0);
  const [servers, setServers] = useState<string[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [typing, setTyping] = useState<{ field: Text; value: string } | null>(null);
  const [describing, setDescribing] = useState<{ server: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const overlapping = useOverlaps(project);
  const suggested = useSuggestedScope(project);
  const current: Watch | undefined = watches[Math.min(at, watches.length - 1)];

  useEffect(() => { void api().watches.servers(project.id).then(setServers); }, [project.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setAt((index) => Math.min(index, Math.max(0, watches.length - 1))); }, [watches.length]);
  useEffect(() => {
    if (!removing) return;
    const timer = setTimeout(() => setRemoving(null), 4000);
    return () => clearTimeout(timer);
  }, [removing]);

  const choices: Choice[] = [
    ...servers.filter((server) => !watches.some((watch) => watch.kind === "ticket-assigned" && watch.server === server && !watch.scope && !watch.instructions)).map((server) => ({ kind: "ticket-assigned" as const, server })),
    ...servers.map((server) => ({ kind: "ticket-assigned" as const, server, describe: true })),
    ...(watches.some((watch) => watch.kind === "review-requested") ? [] : [{ kind: "review-requested" as const }]),
  ];
  const fields: Field[] = current?.kind === "ticket-assigned" ? ["server", "instructions", "scope", "interval", "model"] : ["interval", "model"];

  async function act(work: () => Promise<Project | { error: string }>) {
    setError("");
    const updated = await work();
    if ("error" in updated) return setError(updated.error);
    onProject(updated);
  }

  const cycle = <T,>(values: readonly T[], value: T, step: number) => values[(values.indexOf(value) + step + values.length) % values.length];

  function change(field: Field, step: number) {
    if (!current) return;
    if (field === "interval") return void act(() => api().watches.edit(project.id, current.id, { intervalSeconds: cycle(INTERVALS, current.intervalSeconds, step) }));
    if (field === "model") return void act(() => api().watches.edit(project.id, current.id, { model: cycle(MODELS, current.model as (typeof MODELS)[number], step) }));
    if (field === "server" && servers.length > 1) return void act(() => api().watches.edit(project.id, current.id, { server: cycle(servers, current.server ?? servers[0], step) }));
  }

  async function add(choice: Choice, instructions?: string) {
    setAdding(null);
    if (choice.describe && instructions === undefined) return setDescribing({ server: choice.server ?? "", value: "" });
    setDescribing(null);
    const before = watches.length;
    await act(() => api().watches.create(project.id, choice.kind, choice.server, instructions));
    setAt(before);
  }

  function save(field: Text, value: string) {
    setTyping(null);
    if (current) void act(() => api().watches.edit(project.id, current.id, { [field]: value }));
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing !== null || describing !== null) return;
      const down = event.key === "ArrowDown" || event.key === "j";
      const up = event.key === "ArrowUp" || event.key === "k";
      if (adding !== null) {
        event.preventDefault();
        if (event.key === "Escape") setAdding(null);
        if (down) setAdding((index) => Math.min(choices.length - 1, (index ?? 0) + 1));
        if (up) setAdding((index) => Math.max(0, (index ?? 0) - 1));
        if (event.key === "Enter" && choices[adding]) void add(choices[adding]);
        return;
      }
      if (editing) {
        event.preventDefault();
        const index = fields.indexOf(editing);
        if (event.key === "Escape" || event.key === "e") setEditing(null);
        if (down) setEditing(fields[Math.min(fields.length - 1, index + 1)]);
        if (up) setEditing(fields[Math.max(0, index - 1)]);
        if (event.key === "ArrowRight" || event.key === "l" || event.key === " ") change(editing, 1);
        if (event.key === "ArrowLeft" || event.key === "h") change(editing, -1);
        if (event.key === "Enter") {
          if (editing === "scope") setTyping({ field: "scope", value: current?.scope || suggested });
          else if (editing === "instructions") setTyping({ field: "instructions", value: current?.instructions ?? "" });
          else change(editing, 1);
        }
        return;
      }
      if (event.key === "Escape" || event.key === "w") {
        event.preventDefault();
        return onBack();
      }
      if (event.key === "a") {
        event.preventDefault();
        if (!choices.length) return setError(servers.length ? "every watch this project can have is already here" : "no Jira or Linear MCP server for this project, and the review watch is already here");
        return setAdding(0);
      }
      if (!current) return;
      if (down) setAt((index) => Math.min(watches.length - 1, index + 1));
      if (up) setAt((index) => Math.max(0, index - 1));
      if (event.key === "e" || event.key === "Enter") setEditing(fields[0]);
      if (event.key === " ") void act(() => api().watches.toggle(project.id, current.id));
      if (event.key === "r") void act(() => api().watches.check(project.id, current.id));
      if (event.key === "R") void act(() => api().watches.checkAll(project.id));
      if (event.key === "x") {
        if (removing !== current.id) setRemoving(current.id);
        else {
          setRemoving(null);
          void act(() => api().watches.remove(project.id, current.id));
        }
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const value = (field: Field) => {
    if (!current) return "";
    if (field === "server") return current.server ?? "none";
    if (field === "instructions") return current.instructions || "assigned to me and still open";
    if (field === "scope") return current.scope || `everywhere${suggested ? ` · this repository uses ${suggested}` : ""}`;
    if (field === "interval") return `every ${Math.round(current.intervalSeconds / 60)}m`;
    return current.model;
  };
  const label: Record<Field, string> = { server: "tracker", instructions: "looks for", scope: "only from", interval: "checks", model: "model" };

  return (
    <>
      <header className="statusline">
        <span className="hi">{project.name}</span>
        <span className="lo">watches</span>
        <span className="spacer" />
        <span className="lo">{watches.filter((watch) => watch.enabled).length} of {watches.length} on</span>
      </header>
      <div className="screen">
        <section className="section" aria-label="Watches">
          <p className="hi heading">WATCHES</p>
          <p className="lo">A watch checks for new work on its own and starts it. Tickets already assigned when a watch is first switched on are listed, not started.</p>
          {watches.length === 0 ? <p className="lo">No watches yet · a adds one</p> : null}
          <div className="rows">{watches.map((watch, index) => (
            <button key={watch.id} type="button" className={`row${index === at && !editing ? " sel" : ""}`} onClick={() => setAt(index)}>
              <span className={watch.lastError ? "need" : watch.enabled ? "ok" : "lo"}>{watch.enabled ? "●" : "○"}</span>
              <span>{watchTitle(watch)} <span className="id">{watchSource(watch, project)}</span><span className="lo">{watchNotes(watch)}</span></span>
              <span className="agent">{watch.model}</span>
              <span className={watch.lastError ? "need" : watch.enabled ? "ok" : "lo"}>{watch.lastError ? "error" : watch.enabled ? `on · every ${Math.round(watch.intervalSeconds / 60)}m` : "paused"}</span>
              <span className={watch.due ? "id right" : "lo right"}>{watch.due ? "checking now…" : watch.lastCheckedAt ? `checked ${ago(watch.lastCheckedAt, now)}` : "not checked yet"}</span>
            </button>
          ))}</div>
          {current?.lastError ? <p className="need">  {current.lastError}</p> : null}
          {current && overlapping[current.id] ? <p className="need">  {overlapNote(overlapping[current.id], suggested)} · e to edit</p> : null}
          {removing && removing === current?.id ? <p className="need">  remove this watch? x again — what it found stays on the home screen</p> : null}
        </section>

        {editing && current ? (
          <section className="section" aria-label="Edit watch">
            <p className="hi heading">EDIT · {watchTitle(current).toUpperCase()}</p>
            <div className="rows">{fields.map((field) => (
              <p key={field} className={`row${field === editing ? " sel" : ""}`}>
                <span className="lo">{field === editing ? "›" : " "}</span>
                <span><span className="lo">{label[field]} </span>
                  {typing && typing.field === field ? (
                    <input
                      aria-label={field === "scope" ? "Only from" : "Looks for"}
                      className="inline-input"
                      autoFocus
                      maxLength={field === "scope" ? 120 : 500}
                      value={typing.value}
                      placeholder={field === "scope" ? "a Jira project key, Linear team, or site" : "in your words · empty for assigned to me"}
                      onChange={(event) => setTyping({ field: typing.field, value: event.target.value })}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape") setTyping(null);
                        if (event.key === "Enter") save(typing.field, typing.value);
                      }}
                    />
                  ) : <span className="hi">{value(field)}</span>}
                </span>
                <span className="lo">{field === "scope" || field === "instructions" ? "enter to type" : field === "server" && servers.length < 2 ? "" : "← →"}</span>
                <span />
                <span />
              </p>
            ))}</div>
            <p className="lo">  Changing the tracker, what it looks for, or the scope starts it fresh: what it finds there now is listed, not started.</p>
          </section>
        ) : null}

        {adding !== null ? (
          <section className="section" aria-label="Add watch">
            <p className="hi heading">ADD A WATCH</p>
            <div className="rows">{choices.map((choice, index) => (
              <button key={`${choice.kind}:${choice.server ?? ""}:${choice.describe ? "describe" : ""}`} type="button" className={`row${index === adding ? " sel" : ""}`} onClick={() => void add(choice)}>
                <span className="lo">{index === adding ? "›" : " "}</span>
                <span>{choice.describe ? "Tickets I describe" : watchTitle(choice)} <span className="id">{watchSource(choice, project)}</span>{choice.describe ? <span className="lo"> · in your own words</span> : null}</span>
                <span /><span /><span />
              </button>
            ))}</div>
          </section>
        ) : null}

        {describing ? (
          <section className="section" aria-label="Describe watch">
            <p className="hi heading">TICKETS I DESCRIBE · {describing.server}</p>
            <p className="lo">Say what to look for, the way you would ask a teammate. Matching tickets are planned first, like assigned ones.</p>
            <input
              aria-label="Looks for"
              className="inline-input"
              autoFocus
              maxLength={500}
              value={describing.value}
              placeholder="unassigned bugs labelled frontend in the current sprint"
              onChange={(event) => setDescribing({ ...describing, value: event.target.value })}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") setDescribing(null);
                if (event.key === "Enter") {
                  if (!describing.value.trim()) return setError("say what the watch should look for");
                  void add({ kind: "ticket-assigned", server: describing.server, describe: true }, describing.value);
                }
              }}
            />
          </section>
        ) : null}

        {error ? <p className="need" role="alert">{error}</p> : null}
      </div>
      <footer className="hints">
        {describing || typing ? (
          <>
            <span><span className="key">enter</span> save</span>
            <span><span className="key">esc</span> cancel</span>
          </>
        ) : editing ? (
          <>
            <span><span className="key">↑ ↓</span> field</span>
            <span><span className="key">← →</span> change</span>
            <span><span className="key">esc</span> done</span>
          </>
        ) : adding !== null ? (
          <>
            <span><span className="key">enter</span> add</span>
            <span><span className="key">esc</span> cancel</span>
          </>
        ) : (
          <>
            <span><span className="key">a</span> add</span>
            <span><span className="key">e</span> edit</span>
            <span><span className="key">space</span> on/off</span>
            <span><span className="key">r</span> run now</span>
            <span><span className="key">R</span> run all</span>
            <span><span className="key">x x</span> remove</span>
            <span><span className="key">esc</span> back</span>
          </>
        )}
      </footer>
    </>
  );
}
