import { useMemo, useState } from "react";
import type { Session } from "../api";
import { filterSessions } from "../lib/filter";
import { ago, orderSessions, sessionMarker, stateLabel } from "../lib/sessionOrder";

const MAX_ROWS = 12;

export function Switcher({ sessions, currentId, onPick, onClose }: { sessions: Session[]; currentId?: string; onPick: (session: Session) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const now = Date.now();
  const shown = useMemo(() => filterSessions(orderSessions(sessions, now), query).slice(0, MAX_ROWS), [sessions, query]);
  const at = Math.min(selected, Math.max(0, shown.length - 1));

  return (
    <div className="switcher-scrim" onMouseDown={onClose}>
      <div className="switcher" role="dialog" aria-label="Switch session" onMouseDown={(event) => event.stopPropagation()}>
        <input
          className="switcher-input"
          autoFocus
          value={query}
          placeholder="switch to…"
          aria-label="Filter sessions"
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); onClose(); }
            if (event.key === "ArrowDown") { event.preventDefault(); setSelected(Math.min(shown.length - 1, at + 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setSelected(Math.max(0, at - 1)); }
            if (event.key === "Enter" && shown[at]) { event.preventDefault(); onPick(shown[at]); }
          }}
        />
        <ul className="rows">
          {shown.map((session, index) => {
            const marker = sessionMarker(session);
            return (
              <li key={session.id}>
                <button type="button" className={`row${index === at ? " sel" : ""}`} onClick={() => onPick(session)}>
                  <span className={marker === "!" ? "need" : "ok"}>{marker}</span>
                  <span>{session.name}{session.id === currentId ? <span className="lo">  (here)</span> : null}</span>
                  <span className="agent">{session.agent}</span>
                  <span className={session.state === "running" ? "ok" : "lo"}>{stateLabel(session)}</span>
                  <span className="lo right">{ago(session.createdAt, now)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {shown.length === 0 ? <p className="lo">  no session matches</p> : null}
      </div>
    </div>
  );
}
