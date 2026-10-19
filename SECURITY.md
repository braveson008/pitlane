# Security

Pitlane runs coding agents **unattended**. Read this before turning a watch on.

## What an unattended agent can do

A ticket's agent runs Claude Code in its `auto` permission mode, or Codex with approvals and its sandbox off. It works in a workspace that is a git worktree of your project, and its environment holds:
- the project's GitHub or GitLab token (from `gh auth token` / `glab`), so it can push its branch and open a PR;
- your shell's environment.

**Anyone who can assign you a ticket is writing text that an agent will act on.** Pitlane fences ticket text as data, not instructions, and tells the agent to touch only its own branch. But a fence is a request to the model, not a sandbox. Only turn the ticket watch on for trackers whose contributors you trust.

## What Pitlane enforces itself

- **Tracker polls are read-only.** They run `claude -p --permission-mode dontAsk`, with every built-in tool denied and only the tracker's audited read-only MCP tools allowed.
- **Reviews of other people's PRs run without your credentials.** The review agent gets no GitHub or GitLab token, empty `gh`/`glab` config directories, a workspace whose push URL is disabled, and `gh`, `glab`, `git push`, `curl` and `wget` denied. The PR's dependencies are not installed and your local files (`.env` and the like) are not copied in.
- **Review drafts are posted by Pitlane, not the agent,** and only after you approve twice. A second press while one is posting cannot post twice.
- **Strangers do not start work.** A review request from someone outside the repository's owners, members and collaborators is listed but not started. Feedback on Pitlane's own PRs is read only from team members, never from bots or passers-by.
- **Branches are guarded.** Session branches don't track your trunk, adopted branch names must be plain (`[A-Za-z0-9._/-]`), and branch names are quoted in the commands the agent is given.
- **Tokens stay in memory.** They are never written to disk. Git gets them through a credential helper set in the agent's environment only, which resets the helper list so your keychain neither answers for nor stores the project token.
- **Folder trust follows yours.** A workspace is trusted for Claude only when you already trust the project in Claude.
- **The app's own page.** Links an agent prints open in your browser, never inside Pitlane, and windows never navigate away from the app.

## Reporting a vulnerability

Please open a private security advisory on this repository rather than a public issue.
