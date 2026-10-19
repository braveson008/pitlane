import { useEffect, useMemo, useRef, useState } from "react";
import { api, isFailure, type ChangedFile, type LiveChanges, type Project, type Session } from "../api";
import { parseDiff, type DiffHunk } from "../lib/diff";
import { changesKey } from "../lib/keys";

const LETTER: Record<ChangedFile["status"], string> = { added: "A", modified: "M", deleted: "D", renamed: "R", copied: "C", typechange: "T", conflicted: "U" };

function useLiveChanges(sessionId: string): LiveChanges | null {
  const [summary, setSummary] = useState<LiveChanges | null>(null);
  useEffect(() => {
    setSummary(null);
    const stop = api().changes.onUpdate((next) => { if (next.sessionId === sessionId) setSummary(next); });
    void api().changes.subscribe(sessionId);
    return () => {
      stop();
      void api().changes.unsubscribe(sessionId);
    };
  }, [sessionId]);
  return summary;
}

const clock = (at?: number) => (at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/** What the agent changed since the session started, live, with keep and revert per file and per hunk. */
export function Changes({ project, session, onBack }: { project: Project; session: Session; onBack: () => void }) {
  const summary = useLiveChanges(session.id);
  const files = summary?.ok ? summary.files : [];
  const [cursor, setCursor] = useState(0);
  const [hunkAt, setHunkAt] = useState(0);
  const [patch, setPatch] = useState<{ hunks: DiffHunk[]; ids: string[] } | null>(null);
  const [error, setError] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const busy = useRef(false);
  const file = files[Math.min(cursor, Math.max(0, files.length - 1))];

  // Re-read the open file's diff whenever the agent changes something, so the view stays live.
  useEffect(() => {
    if (!file || file.binary) return setPatch(null);
    let current = true;
    void api().changes.fileDiff(session.id, file).then((result) => {
      if (!current) return;
      if (!result.ok) return setError(result.error || "Could not read this file's changes.");
      setPatch({ hunks: parseDiff(result.diff), ids: result.hunks });
    });
    return () => { current = false; };
  }, [summary, file?.path, session.id]);

  useEffect(() => { setHunkAt(0); }, [file?.path]);
  useEffect(() => {
    if (!confirmAll) return;
    const timer = setTimeout(() => setConfirmAll(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmAll]);

  async function act(work: () => Promise<{ ok: boolean } | { error: string } | undefined>) {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      const result = await work();
      if (result && isFailure(result)) setError(result.error);
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The ⌘D that opened this view is still on its way up the page when the view mounts.
      if (event.defaultPrevented) return;
      const action = changesKey(event);
      if (!action) return;
      event.preventDefault();
      if (action === "back") return onBack();
      if (action === "nextFile") return setCursor((index) => Math.min(files.length - 1, index + 1));
      if (action === "prevFile") return setCursor((index) => Math.max(0, index - 1));
      if (action === "nextHunk") return setHunkAt((index) => Math.min((patch?.hunks.length ?? 1) - 1, index + 1));
      if (action === "prevHunk") return setHunkAt((index) => Math.max(0, index - 1));
      if (action === "keepAll") return void act(() => api().changes.keep(session.id));
      if (action === "revertAll") {
        if (!confirmAll) return setConfirmAll(true);
        setConfirmAll(false);
        return void act(async () => {
          for (const each of files) {
            const result = await api().changes.revert(session.id, each);
            if (isFailure(result)) return result;
          }
          return { ok: true };
        });
      }
      if (!file) return;
      if (action === "keep") return void act(() => api().changes.keep(session.id, file));
      if (action === "revert") return void act(() => api().changes.revert(session.id, file));
      if (action === "revertHunk" && patch?.ids[hunkAt]) return void act(() => api().changes.revert(session.id, file, patch.ids[hunkAt]));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const lines = useMemo(() => patch?.hunks ?? [], [patch]);

  return (
    <>
      <header className="statusline">
        <span className="hi glitch">{project.name}</span>
        <span className="lo">›</span>
        <span>{session.name} · changes</span>
        <span className="spacer" />
        {summary?.ok ? (
          <span className="lo">
            {files.length} {files.length === 1 ? "file" : "files"} <span className="ok">+{summary.additions}</span> <span className="need">−{summary.deletions}</span> since {clock(summary.since)}
          </span>
        ) : null}
      </header>
      <div className="changes">
        <ul className="changes-files" aria-label="Changed files">
          {!summary ? <li className="lo">reading the workspace…</li> : null}
          {summary && !summary.ok ? <li className="need">{summary.error}</li> : null}
          {summary?.ok && files.length === 0 ? <li className="lo">No changes since {clock(summary.since)}.</li> : null}
          {files.map((each, index) => (
            <li key={each.path}>
              <button type="button" className={`row changes-row${each === file ? " sel" : ""}`} onClick={() => setCursor(index)} title={each.from ? `${each.from} → ${each.path}` : each.path}>
                <span className="ok">{LETTER[each.status]}</span>
                <span className="id">{each.path}</span>
                <span>{each.binary ? <span className="lo">bin</span> : <><span className="ok">+{each.additions}</span> <span className="need">−{each.deletions}</span></>}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="changes-diff" aria-label="Diff">
          {file && file.binary ? <p className="lo">binary file</p> : null}
          {lines.map((hunk, index) => (
            <div key={patch?.ids[index] ?? index} className={`changes-hunk${index === hunkAt ? " sel" : ""}`} onClick={() => setHunkAt(index)}>
              <p className="lo">@@ {hunk.header}</p>
              {hunk.lines.map((line, lineIndex) => (
                <p key={lineIndex} className={line.kind === "added" ? "ok" : line.kind === "removed" ? "need" : undefined}>
                  <span className="lo">{String(line.after ?? line.before ?? "").padStart(4)} </span>
                  {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}{line.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
      {error ? <p className="need ended" role="alert">{error}</p> : null}
      {confirmAll ? <p className="need ended">revert all {files.length} files? X again</p> : null}
      <footer className="hints">
        <span><span className="key">k</span> keep</span>
        <span><span className="key">r</span> revert</span>
        <span><span className="key">R</span> hunk</span>
        <span><span className="key">K</span> keep all</span>
        <span><span className="key">X</span> revert all</span>
        <span><span className="key">esc</span> back</span>
      </footer>
    </>
  );
}
