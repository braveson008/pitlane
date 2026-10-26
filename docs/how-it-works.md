# How Pitlane works

This is for people who want to know what runs where before they let it work unattended, or who want to contribute.

## Processes

Pitlane is an Electron app. The **main process** (`electron/main.cjs` and `electron/lib/`) owns everything with side effects: the agent terminals, git, the watches, the ticket book and posting. The **window** (`src/`, React) only draws state and sends keys; it never runs a command itself, and everything it asks for is checked again in main.

```
 window (React)  ── IPC ──▶  main process
                               ├─ sessions      node-pty terminals running claude / codex
                               ├─ workspaces    git worktree pool per project
                               ├─ watches       tracker polls (claude -p) and PR searches (gh / glab)
                               ├─ ticket book   what was seen, queued, working, in review, done
                               ├─ dispatcher    starts what is up next
                               ├─ agent events  Claude hooks → needs-you and end of turn
                               └─ live changes  diff of a workspace against where its session began
```

## Sessions

Each session is a real pseudo-terminal (node-pty) running `claude` or `codex` in a workspace. Output is kept in a scrollback buffer, so a window that closes and reopens shows what the agent printed meanwhile. Agents started for tickets run unattended: Claude in its `auto` permission mode, Codex with approvals off.

Claude reports back through hooks that Pitlane sets with `--settings` for that session only: a **Notification** hook marks the session as needing you, and a **Stop** hook marks the end of a turn, which is when Pitlane looks for a pull request. The hooks write small JSON lines into Pitlane's data folder, which Pitlane watches.

## Workspaces

`electron/lib/workspaces.cjs` keeps one git worktree per running agent, with no limit, plus one clean spare. A workspace is *free*, *busy* (a session is using it), or *held* (its session ended with uncommitted work). To start a session on a branch, Pitlane takes a free workspace, switches it to the branch (`--no-track`, so it never follows your trunk), copies in your chosen local files, and installs dependencies if the lockfile changed. When the session ends, a clean workspace is reset and freed, and removed from disk if another clean one is already waiting; a dirty one is held until you park it, which commits the work locally with hooks off, or delete its session, which throws the work away.

Reviews of other people's PRs use a **detached** workspace: the PR head and its base are fetched by sha, nothing is installed, and the workspace is cleaned with `git clean -fdx` afterwards.

## Watches and the ticket book

A ticket watch runs, every few minutes:

```
claude -p --output-format json --model sonnet --permission-mode dontAsk \
  --no-session-persistence --disallowedTools <every built-in tool> \
  --allowedTools <the tracker's read-only MCP tools>
```

with a prompt asking for open tickets assigned to you (or, for a watch with instructions, for what the owner wrote, in their words), as JSON, optionally only from the watch's scope. Each ticket records which watches found it (`foundBy`), and a poll only drops or flags tickets its own watch found; tickets recorded before that are judged by the watches without instructions. A ticket is read in full by its key alone, so one that is not assigned to you can still be read before it starts. Each ticket carries its status and a stage taken from the tracker's own status category (`todo`, `started`, `done`); only `todo` tickets queue themselves, and the stage is checked again when the ticket is read in full just before it starts. `dontAsk` refuses any tool that was not explicitly allowed. An answer that is not a list, or an empty list right after a full one, is treated as an error rather than "everything was unassigned".

The **ticket book** (`electron/lib/tickets.cjs`) remembers every ticket a watch has seen, per project, and its state:

```
not-started ─enter─▶ queued ─▶ planning ─▶ plan-ready ─s s─▶ queued (approved) ─▶ working ─PR─▶ in-review ─merged─▶ done
                                               │ d d                                │              │
                                               ▼                                    ▼              ▼ feedback
                                          not-started                           needs-you    queued (no new plan)
```

A queued ticket goes to the lead agent when it is approved, has feedback, or already has a branch (`wantsWork` in `electron/lib/ticketFlow.cjs`); otherwise it is planned. A planning agent runs in a detached workspace at the trunk and writes `.pitlane/plan.md`, which is read before the workspace is reset (`electron/lib/plan.cjs`).

The first check of a watch only takes note (*not-started*). A ticket that disappears from your list while queued or with a plan waiting is *dropped*; one being planned or worked on is flagged; it never starts again on its own.

The **dispatcher** starts *queued* work in order (reviews, then feedback on Pitlane's own PRs, then approved work, then planning, oldest first within each) while the project has a free workspace and fewer than three unattended agents run in total. It runs one pass at a time.

## Pull requests and feedback

Every two minutes Pitlane looks at the PRs of tickets in review (one listing per project). Merged or closed means done. On an open PR it reads reviews, conversation comments, inline review comments and check runs newer than its last look, keeps only what the repository's owners, members and collaborators wrote, and sends the ticket back to work with that text if there is any. After three rounds on the same PR it stops and asks you.

## Credentials

Tokens come from `gh auth token` / `glab` for the project's account and live only in memory. Agents get them through environment variables, plus a git credential helper set with `GIT_CONFIG_COUNT`, which first resets the helper list so your keychain neither answers for the project nor stores its token. Review agents get none of this: empty `gh`/`glab` config directories, no token, push disabled on the workspace, and network and posting tools denied.

## Tests

- `npm test`: unit tests for every module in `electron/lib` and `src/lib`.
- `tests/m1-smoke.mjs` … `m4-smoke.mjs`: drive the real app with Playwright, using a fake agent, a fake `claude -p` and a fake `gh`. Each run takes screenshots of every theme and fails if any text on screen is cut off.
- `tests/packaged-smoke.mjs`: starts an agent in the packaged, signed app.

## Releases

`npm run dist:release` makes a signed, notarized DMG and zip. A build made without `PITLANE_UPDATE_URL` updates from this repository's GitHub releases through electron-updater. `electron/lib/updates.cjs` turns the updater's events into one state (`current`, `downloading`, `ready`, `error`) that the menu, the notification and every window's status line show; a ready update stops further checks and installs on restart or quit.
