import { useEffect, useState } from "react";
import { api, isFailure, type Draft as DraftData, type Project, type Ticket } from "../api";
import { draftKey } from "../lib/keys";

const VERDICTS: DraftData["verdict"][] = ["comment", "approve", "request-changes"];
const VERDICT_CLASS: Record<DraftData["verdict"], string> = { approve: "ok", comment: "id", "request-changes": "need" };

/** The agent's review of a teammate's PR, for the owner to change, post or throw away. Only "a a" posts. */
export function Draft({ project, ticket, onBack }: { project: Project; ticket: Ticket; onBack: () => void }) {
  const [draft, setDraft] = useState<DraftData>(ticket.draft ?? { summary: "", verdict: "comment", comments: [] });
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<"approve" | "discard" | null>(null);
  const [status, setStatus] = useState(ticket.reason ?? "");
  const [busy, setBusy] = useState(false);

  async function save(next: DraftData) {
    setDraft(next);
    const result = await api().reviews.update(project.id, ticket.key, next);
    if (isFailure(result)) setStatus(result.error);
  }

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing || event.defaultPrevented) return;
      const action = draftKey(event);
      if (!action) return;
      event.preventDefault();
      if (action === "back") return onBack();
      if (busy) return;
      if (action === "down") return setCursor((index) => Math.min(draft.comments.length - 1, index + 1));
      if (action === "up") return setCursor((index) => Math.max(0, index - 1));
      if (action === "edit") return setEditing(true);
      if (action === "verdict") return void save({ ...draft, verdict: VERDICTS[(VERDICTS.indexOf(draft.verdict) + 1) % VERDICTS.length] });
      if (action === "dropComment" && draft.comments[cursor]) {
        setCursor((index) => Math.max(0, Math.min(index, draft.comments.length - 2)));
        return void save({ ...draft, comments: draft.comments.filter((_, index) => index !== cursor) });
      }
      if (action === "discard") {
        if (confirming !== "discard") return setConfirming("discard");
        setConfirming(null);
        return void api().reviews.discard(project.id, ticket.key).then(onBack);
      }
      if (action === "approve") {
        if (confirming !== "approve") return setConfirming("approve");
        setConfirming(null);
        setBusy(true);
        setStatus("posting…");
        void api().reviews.post(project.id, ticket.key).then((result) => {
          setBusy(false);
          if (isFailure(result)) return setStatus(result.error);
          setStatus("posted");
          onBack();
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDiff = draft.comments.filter((comment) => comment.onDiff).length;

  return (
    <>
      <header className="statusline">
        <span className="hi glitch">{project.name}</span>
        <span className="lo">›</span>
        <span><span className="id">#{ticket.pr?.number}</span> {ticket.title} · review</span>
        <span className="spacer" />
        <span className={VERDICT_CLASS[draft.verdict]}>{draft.verdict}</span>
      </header>
      <div className="screen" aria-label="Review draft">
        <section className="section">
          <p className="hi heading">SUMMARY</p>
          {editing ? (
            <textarea
              className="draft-edit"
              autoFocus
              defaultValue={draft.summary}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
                if (event.key === "Enter" && event.metaKey) {
                  setEditing(false);
                  void save({ ...draft, summary: event.currentTarget.value });
                }
              }}
            />
          ) : (
            <p className="draft-summary">{draft.summary}</p>
          )}
        </section>
        <section className="section" aria-label="Comments">
          <p className="hi heading">COMMENTS</p>
          {draft.comments.length === 0 ? <p className="lo">No line comments.</p> : null}
          {draft.comments.map((comment, index) => (
            <div key={`${comment.path}:${comment.line}:${index}`} className={`draft-comment${index === cursor ? " sel" : ""}`}>
              <p><span className="id">{comment.path}:{comment.line}</span>{comment.onDiff ? null : <span className="need">  not on a changed line, left out</span>}</p>
              <p>{comment.body}</p>
            </div>
          ))}
        </section>
        {status ? <p className={/posted|posting/.test(status) ? "ok" : "need"} role="status">{status}</p> : null}
        {confirming === "discard" ? <p className="need">discard this draft? d again</p> : null}
        {confirming === "approve" ? <p className="need">post this {draft.verdict} with {onDiff} {onDiff === 1 ? "comment" : "comments"} to #{ticket.pr?.number}? a again</p> : null}
      </div>
      <footer className="hints">
        <span><span className="key">a</span> approve & post</span>
        <span><span className="key">e</span> edit</span>
        <span><span className="key">v</span> verdict</span>
        <span><span className="key">x</span> drop comment</span>
        <span><span className="key">d</span> discard</span>
        <span><span className="key">esc</span> back</span>
      </footer>
    </>
  );
}
