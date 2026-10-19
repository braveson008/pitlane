import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { api, type Project, type Session } from "../api";
import { sessionKey, type SessionAction } from "../lib/keys";
import { ago, stateLabel } from "../lib/sessionOrder";
import { xtermTheme, type ThemeId } from "../theme/themes";
import { UpdateNote } from "./UpdateNote";

interface SessionViewProps {
  project: Project;
  session: Session;
  theme: ThemeId;
  onAction: (action: SessionAction) => void;
  onRestart: (session: Session) => void;
}

export function SessionView({ project, session, theme, onAction, onRestart }: SessionViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const actions = useRef(onAction);
  actions.current = onAction;
  const ended = session.state !== "running";

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      theme: xtermTheme(theme),
      macOptionIsMeta: true,
      // Links an agent prints open in the browser, never inside Pitlane.
      linkHandler: { activate: (_event, uri) => void api().links.open(uri), allowNonHttpProtocols: false },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // The DOM renderer is slower but always works.
    }
    term.attachCustomKeyEventHandler((event) => {
      const action = event.type === "keydown" ? sessionKey(event) : null;
      if (!action) return true;
      event.preventDefault();
      actions.current(action);
      return false;
    });
    terminal.current = term;
    if (api().e2e) {
      window.__pitlaneTerminalText = () => {
        const lines: string[] = [];
        for (let row = 0; row < term.buffer.active.length; row += 1) lines.push(term.buffer.active.getLine(row)?.translateToString(true) ?? "");
        return lines.join("\n");
      };
    }

    let disposed = false;
    const stopData = api().sessions.onData((payload) => { if (payload.id === session.id) term.write(payload.data); });
    void api().sessions.attach(session.id).then(({ scrollback }) => { if (!disposed) term.write(scrollback); });
    const input = term.onData((data) => void api().sessions.write(session.id, data));

    const resize = () => {
      try {
        fit.fit();
        void api().sessions.resize(session.id, term.cols, term.rows);
      } catch {
        // Fitting a hidden terminal throws; the next resize fits it.
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    term.focus();

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      stopData();
      void api().sessions.detach(session.id);
      term.dispose();
      terminal.current = null;
    };
  }, [session.id]);

  useEffect(() => { if (terminal.current) terminal.current.options.theme = xtermTheme(theme); }, [theme]);

  useEffect(() => {
    if (!ended) return;
    const onKey = (event: KeyboardEvent) => {
      // Something on top (the switcher) already took this Enter.
      if (event.defaultPrevented) return;
      if (event.key === "Enter" && !event.metaKey) onRestart(session);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ended, session, onRestart]);

  return (
    <>
      <header className="statusline">
        <span className="hi glitch">{project.name}</span>
        <span className="lo">›</span>
        <span>{session.name}</span>
        <span className="agent">{session.agent}</span>
        <span className={session.state === "running" ? "ok" : session.state === "failed" ? "need" : "lo"}>{stateLabel(session)} {ago(session.createdAt, Date.now())}</span>
        <span className="spacer" />
        <UpdateNote inSession />
      </header>
      <div
        className="terminal"
        ref={host}
        data-session={session.id}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length) void api().sessions.pasteFiles(session.id, event.dataTransfer.files);
        }}
      />
      {ended ? (
        <p className="ended lo">[{session.state === "failed" ? session.error : `exited ${session.exitCode ?? ""}`.trim()}] — enter to start a new session</p>
      ) : null}
      <footer className="hints">
        <span><span className="key">⌘↑</span> home</span>
        <span><span className="key">⌘K</span> sessions</span>
        <span><span className="key">⌥⌘←→</span> prev/next</span>
        <span><span className="key">⌘D</span> changes</span>
        <span>typing goes to the agent</span>
      </footer>
    </>
  );
}
