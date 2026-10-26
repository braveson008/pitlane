import { useEffect, useRef, useState } from "react";
import { api, isFailure, type Project, type Ticket } from "../api";
import { planKey } from "../lib/keys";
import { markdownLines } from "../lib/markdown";

/** The planning agent's plan for an assigned ticket. Work starts only on "s s"; "d d" throws the plan away. */
export function Plan({ project, ticket, onBack }: { project: Project; ticket: Ticket; onBack: () => void }) {
  const [confirming, setConfirming] = useState<"start" | "discard" | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const text = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = planKey(event);
      if (!action) return;
      event.preventDefault();
      if (action === "back") return onBack();
      if (action === "down") return text.current?.scrollBy({ top: 48 });
      if (action === "up") return text.current?.scrollBy({ top: -48 });
      if (busy) return;
      if (confirming !== action) return setConfirming(action);
      setConfirming(null);
      setBusy(true);
      const call = action === "start" ? api().tickets.approvePlan(project.id, ticket.key) : api().tickets.discardPlan(project.id, ticket.key);
      void call.then((result) => {
        setBusy(false);
        if (isFailure(result)) return setStatus(result.error);
        onBack();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <header className="statusline">
        <span className="hi">{project.name}</span>
        <span className="lo">›</span>
        <span><span className="id">{ticket.key}</span> {ticket.title} · plan</span>
        <span className="spacer" />
        <span className="need">waiting on you</span>
      </header>
      <div ref={text} className="screen" aria-label="Plan">
        <section className="section">
          <p className="hi heading">PLAN</p>
          <div className="plan-text">
            {markdownLines(ticket.plan ?? "").map((line, index) => (
              <p key={index} className={`plan-${line.kind}`}>
                {line.parts.map((part, at) => (part.kind === "text" ? part.text : <span key={at} className={part.kind === "bold" ? "hi" : "id"}>{part.text}</span>))}
                {line.parts.every((part) => !part.text) ? " " : null}
              </p>
            ))}
          </div>
        </section>
        {status ? <p className="need" role="status">{status}</p> : null}
        {confirming === "start" ? <p className="need">start work on {ticket.key} in its own branch? s again</p> : null}
        {confirming === "discard" ? <p className="need">discard this plan? d again</p> : null}
      </div>
      <footer className="hints">
        <span><span className="key">s</span> start work</span>
        <span><span className="key">d</span> discard</span>
        <span><span className="key">j k</span> scroll</span>
        <span><span className="key">esc</span> back</span>
      </footer>
    </>
  );
}
