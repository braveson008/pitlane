<p align="center"><img src="build/icon.png" width="160" alt="Pitlane"></p>

# Pitlane

**Your coding agents, one calm window per project.**

Pitlane watches your tracker for the tickets assigned to you and hands each one to a coding agent ([Claude Code](https://claude.com/claude-code) or Codex). The agent works on its own branch in its own workspace, checks its own work, and opens the pull request. You watch it live, step in when it asks, and keep or revert its changes hunk by hunk.

It also reviews the pull requests your teammates ask you to review. It writes the review as a draft, and **nothing is posted until you approve it.**

<p align="center"><img src="docs/screenshots/night-city.png" width="820" alt="Pitlane's home screen in the Night City theme"></p>

## What it does

- **One window per project**, opened from its own Dock entry. The first screen is the sessions; anything waiting on you is at the top.
- **Live agent terminals.** Enter opens the agent's real terminal. Every key goes to the agent, Esc included. ⌘↑ goes home, ⌘K switches session.
- **Watches you control.** `w` opens them: add "Tickets assigned to me" (Jira or Linear through Claude's MCP tools, read-only) or "PRs that need my review" (`gh` or `glab`), narrow a watch to one project or team, change how often it checks and which model reads the tracker, check now, switch it off, or remove it.
- **Up next, in order.** What will start is numbered in the order it will start, and starts by itself when a workspace is free. Tickets that were already assigned when you switched a watch on are folded away under *Not started*; Enter puts one up next.
- **Its own branch, never a fresh clone.** Each project keeps a small pool of reusable workspaces (one per agent, up to three). Your own checkout is never touched.
- **Self-review before every PR.** A review subagent reads the diff against the ticket, and the project's tests run, before anything is pushed.
- **Feedback loops back.** When a teammate requests changes or comments, inline or not, or CI fails on one of its PRs, the ticket goes back to the agent with the feedback. After three rounds a person is asked instead.
- **Live Changes.** ⌘D shows what the agent changed since it started. Keep or revert a file or a single hunk.
- **Seven themes:** VT220, Acme, Night City, Green Screen, Daylight, Synthwave and Midnight. `t` cycles them.

| Watches you can edit | A review draft waits for you | Keep or revert what it changed |
|---|---|---|
| ![Watches](docs/screenshots/watch-edit.png) | ![Review draft](docs/screenshots/review-draft.png) | ![Live Changes](docs/screenshots/changes.png) |

| VT220 | Daylight | Synthwave | Green Screen |
|---|---|---|---|
| ![VT220](docs/screenshots/vt220.png) | ![Daylight](docs/screenshots/daylight.png) | ![Synthwave](docs/screenshots/synthwave.png) | ![Green Screen](docs/screenshots/green-screen.png) |

**Read more:** the [user guide](docs/guide.md) walks through every screen and key, and [how it works](docs/how-it-works.md) explains what runs where.

## Who it is for

Developers who already use Claude Code or Codex and want them working through the backlog while they do something else, without giving up control: you see every agent live, every change can be reverted, and nothing reaches a teammate until you say so.

## Install

Download the latest `.dmg` from [Releases](../../releases). Pitlane is macOS (Apple Silicon) only, signed and notarized, and updates itself from this repository's releases.

You need:
- [Claude Code](https://claude.com/claude-code) (or Codex), signed in;
- for tickets: a Jira or Linear MCP server added to Claude Code for the project;
- for pull requests: [`gh`](https://cli.github.com) or [`glab`](https://gitlab.com/gitlab-org/cli), signed in.

## Keys

| Where | Keys |
|---|---|
| Home | `enter` open · `n` new session · `w` watches · `a` show not-started tickets · `x` take a ticket out of up next · `s s` stop an agent · `C` clear ended sessions · `c` changes · `p` open PR · `x x` park a held session · `L` agents at once · `t` theme · `?` help |
| Watches | `a` add · `e` edit (`↑↓` field, `←→` change) · `space` on/off · `r` check now · `x x` remove · `esc` back |
| Session | everything goes to the agent · `⌘↑` home · `⌘K` switcher · `⌥⌘←/→` prev/next · `⌘D` changes |
| Changes | `k` keep · `r` revert · `R` revert hunk · `K` keep all · `X X` revert all · `esc` back |
| Review draft | `a a` approve & post · `e` edit · `v` verdict · `x` drop comment · `d d` discard |

## How it keeps your work safe

Read [SECURITY.md](SECURITY.md) before letting it run unattended. In short:

- **Your checkout is never touched.** Agents work in separate git worktrees under `~/Library/Application Support/Pitlane/workspaces/`.
- **Nothing is thrown away.** A workspace left with unfinished work is held until you park it, which commits the work locally.
- **Tracker polling is read-only.** Every tool except the tracker's audited read-only ones is refused.
- **Reviews of other people's code run without your tokens,** and their drafts are posted only after you approve them, twice.

## Build from source

```sh
npm install
npm run dev              # vite + electron
npm test                 # unit tests
npm run smoke            # builds, then drives the real app with a fake agent
node tests/m2-smoke.mjs  # workspaces and Changes (after a build)
node tests/m3-smoke.mjs  # watches, up next, the lead agent and PRs
node tests/m4-smoke.mjs  # teammate reviews and feedback on its own PRs
npm run dist:unsigned && node tests/packaged-smoke.mjs   # the packaged app
```

A signed release (`npm run dist:release`) reads the Apple notarisation values from a gitignored `.env`. Without `PITLANE_UPDATE_URL` it updates from this repository's GitHub releases.

## Licence

[Apache-2.0](LICENSE)
