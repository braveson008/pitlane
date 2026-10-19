import { useEffect, useState } from "react";

/** Which untracked files (.env and the like) get copied into workspaces; asked once per project. */
export function LocalFiles({ candidates, onConfirm, onCancel }: { candidates: string[]; onConfirm: (files: string[]) => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState(() => new Set(candidates));
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === "ArrowDown" || event.key === "j") setCursor((index) => Math.min(candidates.length - 1, index + 1));
      else if (event.key === "ArrowUp" || event.key === "k") setCursor((index) => Math.max(0, index - 1));
      else if (event.key === " ") {
        const file = candidates[cursor];
        setChosen((current) => {
          const next = new Set(current);
          if (next.has(file)) next.delete(file);
          else next.add(file);
          return next;
        });
      } else if (event.key === "Enter") onConfirm(candidates.filter((file) => chosen.has(file)));
      else if (event.key === "Escape") onCancel();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section className="section" aria-label="Local files">
      <p className="hi heading">LOCAL FILES</p>
      <p className="lo">Git doesn't carry these, so a workspace starts without them. Copies go into each workspace and are refreshed when yours change; your originals are never touched.</p>
      <ul>
        {candidates.map((file, index) => (
          <li key={file}>
            <button type="button" className={`row wide${index === cursor ? " sel" : ""}`} onClick={() => setCursor(index)}>
              <span><span className={chosen.has(file) ? "ok" : "lo"}>[{chosen.has(file) ? "x" : " "}]</span> <span className="id">{file}</span></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="lo">space toggle · enter copy these · esc cancel</p>
    </section>
  );
}
