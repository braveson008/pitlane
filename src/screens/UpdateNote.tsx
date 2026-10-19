import { useEffect, useState } from "react";
import { api, type UpdateState } from "../api";
import { updateLabel } from "../lib/update";

export function useUpdateState() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    void api().updates.state().then(setState);
    return api().updates.onState(setState);
  }, []);
  return state;
}

/** A new version in the status line. Inside a session U belongs to the agent, so there it is a button only. */
export function UpdateNote({ inSession = false }: { inSession?: boolean }) {
  const label = updateLabel(useUpdateState());
  if (!label) return null;
  const text = inSession && label.ready ? label.text.replace(" · U restart to update", " · restart to update") : label.text;
  return label.ready
    ? <button type="button" className="id" title="Restart into the new version" onClick={() => void api().updates.install()}>{text}</button>
    : <span className="lo">{text}</span>;
}
