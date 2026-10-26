export type ThemeId = "github-dark" | "nord" | "one-dark" | "dracula" | "tokyo-night";

export interface Project {
  id: string;
  name: string;
  path: string;
  rootCommit: string;
  trunk: string;
  theme?: ThemeId;
  github?: { host: string; kind: "github" | "gitlab"; login: string };
  signInNeeded?: boolean;
  watches?: Watch[];
  /** Local files copied into workspaces; undefined until the owner has confirmed them. */
  localFiles?: string[];
  createdAt: number;
}

export type AgentId = "claude" | "codex";

export interface Session {
  id: string;
  projectId: string;
  agent: AgentId;
  name: string;
  cwd: string;
  state: "running" | "exited" | "failed";
  exitCode?: number;
  error?: string;
  createdAt: number;
  endedAt?: number;
  slot?: number;
  branch?: string;
  /** Something the session runs without, such as the project's GitHub login. */
  warning?: string;
  /** Set while the agent waits on the owner (Claude's Notification hook); cleared when they type. */
  attention?: string;
  ticketKey?: string;
  /** The owner stopped its agent. */
  stopped?: boolean;
}

export interface Slot {
  index: number;
  path: string;
  state: "free" | "busy" | "held";
  sessionId?: string;
  branch?: string;
  heldReason?: "uncommitted" | "unpushed";
}

export interface ChangedFile {
  path: string;
  from: string | null;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "typechange" | "conflicted";
  binary: boolean;
  additions: number;
  deletions: number;
}

export interface LiveChanges {
  sessionId: string;
  ok: boolean;
  error?: string;
  since?: number;
  files: ChangedFile[];
  truncated?: boolean;
  additions: number;
  deletions: number;
}

export type UpdateState =
  | { status: "idle" | "checking" }
  | { status: "current"; version?: string }
  | { status: "downloading"; version?: string; percent?: number }
  | { status: "ready"; version?: string; notesUrl?: string }
  | { status: "error"; error: string };

export type WatchKind = "ticket-assigned" | "review-requested";

export interface Watch {
  id: string;
  kind: WatchKind;
  intervalSeconds: number;
  model: string;
  enabled: boolean;
  server?: string;
  /** Only items from this site, project key, or team. */
  scope?: string;
  /** The owner's own words for what to look for, in place of "assigned to me and still open". */
  instructions?: string;
  lastCheckedAt?: number;
  lastError?: string;
  /** Asked to run now; cleared once the check is done. */
  due?: boolean;
}

export type WatchPatch = { intervalSeconds?: number; model?: string; server?: string; scope?: string; instructions?: string };

export interface Draft {
  summary: string;
  verdict: "approve" | "comment" | "request-changes";
  comments: { path: string; line: number; body: string; onDiff: boolean }[];
}

export interface Ticket {
  key: string;
  title: string;
  url: string;
  state: "not-started" | "queued" | "planning" | "plan-ready" | "working" | "needs-you" | "in-review" | "review-ready" | "done" | "dropped";
  /** `own`: the owner opened it, so its review posts as comments. */
  pr?: { number: number; head: string; author?: string; trusted?: boolean; own?: boolean };
  /** Reviews and feedback on Pitlane's own PRs start before new tickets. */
  priority?: "review" | "feedback";
  draft?: Draft;
  /** The planning agent's plan, waiting for the owner. */
  plan?: string;
  plannedAt?: number;
  /** The owner started work on the plan: a queued ticket goes to the lead agent, not to planning. */
  approved?: boolean;
  reviewedSha?: string;
  branch?: string;
  sessionId?: string;
  prUrl?: string;
  reason?: string;
  /** The tracker's own status, and its category: only a "todo" ticket is queued by itself. */
  status?: string;
  stage?: "todo" | "started" | "done";
  /** The other project that already has this ticket. */
  elsewhere?: string;
  /** Put up next by the owner, so it starts even though the tracker shows it under way. */
  chosen?: boolean;
  firstSeenAt: number;
  updatedAt: number;
}

export type ProjectStatus = "ok" | "missing" | "moved-repo";
type Failure = { error: string; missing?: boolean; candidates?: string[] };

interface PitlaneApi {
  e2e: boolean;
  projects: {
    list(): Promise<Project[]>;
    add(path: string): Promise<Project | Failure>;
    open(id: string): Promise<{ ok: boolean }>;
    /** Shows the project in this window, or brings forward the window already showing it. */
    switch(id: string): Promise<{ ok: boolean } | Failure>;
    /** For each project id, how many things wait on the owner there. */
    attention(): Promise<Record<string, number>>;
    onAttention(handler: (counts: Record<string, number>) => void): () => void;
    status(id: string): Promise<ProjectStatus>;
    locate(id: string): Promise<Project | Failure | null>;
    chooseFolder(): Promise<{ path: string } | null>;
    update(id: string, patch: { theme?: ThemeId; localFiles?: string[] }): Promise<Project | Failure>;
    detectLocalFiles(id: string): Promise<string[]>;
  };
  links: { open(url: string): Promise<void> };
  updates: {
    state(): Promise<UpdateState | null>;
    onState(handler: (state: UpdateState) => void): () => void;
    install(): Promise<void>;
    check(): Promise<void>;
  };
  changes: {
    subscribe(sessionId: string): Promise<{ ok: boolean } | Failure>;
    unsubscribe(sessionId: string): Promise<void>;
    onUpdate(handler: (summary: LiveChanges) => void): () => void;
    fileDiff(sessionId: string, file: ChangedFile): Promise<{ ok: boolean; diff: string; hunks: string[]; error?: string }>;
    revert(sessionId: string, file: ChangedFile, hunk?: string): Promise<{ ok: boolean } | Failure>;
    keep(sessionId: string, file?: ChangedFile): Promise<{ ok: boolean } | Failure>;
  };
  watches: {
    servers(id: string): Promise<string[]>;
    create(id: string, kind: WatchKind, server?: string, instructions?: string): Promise<Project | Failure>;
    edit(id: string, watchId: string, patch: WatchPatch): Promise<Project | Failure>;
    remove(id: string, watchId: string): Promise<Project | Failure>;
    toggle(id: string, watchId: string): Promise<Project | Failure>;
    /** Checks the watch on the next pass, even a paused one, which stays paused. */
    check(id: string, watchId: string): Promise<Project | Failure>;
    /** Checks every watch that is on, on the next pass. */
    checkAll(id: string): Promise<Project | Failure>;
    /** For each watch, the other projects whose watch gets the same tickets. */
    overlaps(id: string): Promise<Record<string, string[]>>;
    /** The tracker keys this repository's history uses, as an "only from" value, or "". */
    suggestScope(id: string): Promise<string>;
  };
  reviews: {
    update(projectId: string, key: string, draft: Draft): Promise<Ticket | Failure>;
    post(projectId: string, key: string): Promise<{ ok: boolean; url?: string } | Failure>;
    discard(projectId: string, key: string): Promise<Ticket | Failure>;
  };
  tickets: {
    list(projectId: string): Promise<{ tickets: Ticket[]; pausedUntil: number | null }>;
    start(projectId: string, key: string): Promise<{ ok: boolean } | Failure>;
    unqueue(projectId: string, key: string): Promise<{ ok: boolean } | Failure>;
    approvePlan(projectId: string, key: string): Promise<{ ok: boolean } | Failure>;
    discardPlan(projectId: string, key: string): Promise<{ ok: boolean } | Failure>;
    onChanged(handler: (payload: { projectId: string; tickets: Ticket[]; pausedUntil: number | null }) => void): () => void;
  };
  onProjectChanged(handler: (payload: { project: Project }) => void): () => void;
  onOpenSession(handler: (payload: { sessionId: string }) => void): () => void;
  workspaces: {
    list(projectId: string): Promise<Slot[]>;
    park(projectId: string, slot: number, sessionId?: string): Promise<{ ok: boolean } | Failure>;
  };
  settings: {
    get(): Promise<{ defaultTheme?: ThemeId }>;
    set(patch: { defaultTheme?: ThemeId }): Promise<{ defaultTheme?: ThemeId }>;
  };
  sessions: {
    list(projectId: string): Promise<Session[]>;
    create(projectId: string, agent: AgentId): Promise<Session | Failure>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    stop(id: string): Promise<void>;
    clearEnded(projectId: string): Promise<number>;
    /** Forgets an ended session and throws away what its workspace kept. */
    delete(id: string): Promise<{ ok: boolean } | Failure>;
    attach(id: string): Promise<{ scrollback: string }>;
    detach(id: string): Promise<void>;
    pasteFiles(id: string, files: FileList | File[]): Promise<void>;
    onData(handler: (payload: { id: string; data: string }) => void): () => void;
    onChanged(handler: (payload: { projectId: string; sessions: Session[]; workspaces: Slot[] }) => void): () => void;
  };
}

declare global {
  interface Window {
    pitlane: PitlaneApi;
    /** End-to-end tests only: the terminal draws on a canvas, so its text is read from the buffer. */
    __pitlaneTerminalText?: () => string;
  }
}

export const api = () => window.pitlane;
export const isFailure = (value: unknown): value is Failure => Boolean(value && typeof value === "object" && "error" in value);
