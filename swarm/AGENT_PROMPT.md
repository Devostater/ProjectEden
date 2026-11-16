# Swarm start-up: read this first (every AI)

You were started by the owner's **SWRMsync** button. You are in your own copy of the ProjectEden repo
(a git worktree just reset to the latest `origin/main`). Other AIs are working at the same time in their own copies.

## 1. Know the rules
Read `docs/AI_COLLABORATION.md` (roles, branches, PRs, safety) and `C:\AZI\AGENTS.md` (paths, secrets, what not to read).

## 2. Find your tasks
Your name is in the line that started you: `claude`, `codex` (ChatGPT) or `gemini` (Antigravity).
Tasks are **open GitHub issues** in Devostater/ProjectEden whose title starts with your tag, `[all]` included:

| You | Tags you take |
|---|---|
| claude | `[claude]`, `[all]` |
| codex | `[codex]`, `[chatgpt]`, `[all]` |
| gemini | `[gemini]`, `[antigravity]`, `[all]` |

List them (no sign-in needed, the repo is public):
`curl -s "https://api.github.com/repos/Devostater/ProjectEden/issues?state=open&per_page=50"`
(with `gh` signed in: `gh issue list -R Devostater/ProjectEden --state open`).

Skip an issue if an open PR already says `Closes #<n>` or `Refs #<n>` for it, or if a comment says another AI has taken it.
Work oldest first. **If there is nothing for you, say so and stop.** Don't invent work.

## 3. Do one task at a time
1. Comment on the issue that you're taking it (if you can post; otherwise say so in your PR).
2. `git checkout -b <your name>/<issue number>-<short-topic>` from this copy.
3. Make the change. Keep it small. Follow the issue's acceptance criteria.
4. Check it: in `eden-ai-dashboard/`, `npx tsc --noEmit -p .`, plus `npm run test:updates` and any tests the issue names. Report exactly what ran and what didn't.
5. Commit, `git push -u origin <branch>`, and open a **draft PR** to `main` with `Refs #<n>` and the PR template in `docs/AI_COLLABORATION.md`.
   If `gh` isn't signed in, print the link `https://github.com/Devostater/ProjectEden/compare/main...<branch>?expand=1` and the PR text so the owner can open it.
6. Then take the next task, or stop.

## Never
- Push to `main`, merge, force-push, or touch another AI's branch.
- Commit secrets, `.env` files or anything from `C:\AZI\Security` or `C:\AZI\Archive`.
- Edit `C:\AZI\ProjectEden` itself (that's the owner's running Eden). Work only in your own copy.
- Claim tests passed that you didn't run.
