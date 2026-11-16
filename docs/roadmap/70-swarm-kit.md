# Swarm Kit: the AI swarm as a tool other developers can use

Added to the roadmap by the owner's request, 16 Nov 2026. Written by Claude; for Codex and Gemini to review.
Planning only. Facts marked **[checked]** come from this repo; everything else is a proposal.

## 1. The idea
EDEN's swarm workflow (several AIs on separate copies, GitHub issues as the task board, draft PRs, cross-AI review,
owner approves every merge) is useful far beyond this studio. **Swarm Kit** packages it so any developer can add an
AI swarm to *their own* project, without running all of EDEN.

**Who it's for:** solo developers and small teams who already pay for 2+ AI coding tools (Claude Code, Codex,
Gemini CLI) and want them to work together on a real codebase, safely.

**What they get:** one command to start the swarm on their repo; each AI takes tagged issues, works on its own branch,
opens draft PRs and reviews the others; a shared log shows every AI's progress; nothing merges without the human.

## 2. What already exists and can be reused [checked]
| Piece | Today, in this repo | For Swarm Kit |
|---|---|---|
| Launcher | `swarm/SWRMsync.bat` + `launch.ps1` (sign-in checks, lock, shared log, PR #21) | Becomes a cross-platform CLI |
| Agent instructions | `swarm/AGENT_PROMPT.md` (tasks from issues, branch + draft PR, never merge) | A template the user's repo gets on `init` |
| Per-AI copies | git worktrees in `%USERPROFILE%\.eden-swarm\<name>` | Same idea, per project |
| Collaboration rules | `docs/AI_COLLABORATION.md` | Shipped as a default the user can edit |
| AI review on PRs | `.github/workflows/gemini-pr-review.yml` + tested script (PR #8) | Optional reviewer action, any provider |
| Change safety | Code updates: copy, checks, restore point, overlap re-checks (PR #7) | Later: optional "apply with restore point" mode |

## 3. Product shape (recommended order)
1. **CLI first** (`swarm init`, `swarm check`, `swarm start`, `swarm log`): works in any git repo on Windows, macOS
   and Linux. `init` adds the agent instructions, collaboration rules and an optional review workflow; `check`
   is the sign-in preflight; `start` makes the per-AI worktrees and opens one terminal tab per ready AI plus the
   live log; `log` shows the shared log. Language: Node (the AI CLIs already need it).
2. **GitHub Action**: the advisory AI review (generalized from #8: Claude, OpenAI or Gemini, whichever key the repo has).
3. **MCP server**: exposes the swarm (task board, log, start/stop an agent) as tools, so any MCP-capable AI or IDE can
   see and steer the swarm.
4. **Editor and engine panels**: a VS Code panel first (task board + log + start), then UE5 and Unity editor panels.
   The level generator plugin (#15) teaches us Fab and Unity store packaging first, which these panels reuse.

Not in v1: hosting AIs in the cloud, billing users for AI usage (they use their own subscriptions), auto-merge.

## 4. Milestones
| # | Milestone | Done when | Depends on |
|---|---|---|---|
| K1 | **Extract** | SWRMsync logic lives in a `swarm-kit/` folder with no Eden or AZI paths baked in; EDEN uses it itself | #21 merged; EDEN M1 (swarm works end to end) |
| K2 | **CLI v0** | `swarm init/check/start/log` work on Windows in a fresh test repo (not this one) | K1 |
| K3 | **Cross-platform** | Same commands pass on macOS and Linux (CI matrix) | K2 |
| K4 | **Docs + example repo** | A stranger follows the README to a first AI draft PR in under 20 minutes | K2 |
| K5 | **Review Action** | Marketplace-ready action, provider-agnostic, secret scan before sending | #8 learnings |
| K6 | **MCP server** | An MCP client lists issues, reads the log and starts an agent | K2 |
| K7 | **Editor panels** | VS Code panel; then UE5 and Unity panels | K6; plugin store experience from #15 |
| K8 | **Public release** | License chosen, repo public, launch post (Gemini's devblog plan) | K4, owner decisions |

Best timing (proposal): start K1-K2 right after the in-house test's stage A, because the in-house test itself is the
first real user of Swarm Kit. K3-K8 after the plugin launch.

## 5. Safety rules that ship by default
- AIs never push to the default branch, never merge, never force-push; the human merges.
- Sign-in preflight; one launch at a time; every AI's session end is logged with its exit code.
- No secrets in the shared log, PRs or review prompts; the review action scans diffs before sending them out.
- Each AI works only in its own worktree; the user's working copy is never touched.

## 6. Risks
- **Provider terms:** automated use of consumer AI subscriptions may be limited by each provider's terms. **To verify** for Claude, ChatGPT/Codex and Gemini before selling or promoting it.
- **CLI churn:** flags and login flows of the AI CLIs change; keep the kit thin, test each CLI version in CI.
- **Cost surprises:** three AIs at once use three plans' limits; show usage and let users cap agents.
- **Support load:** strangers' repos are messy; ship a `swarm doctor` diagnostic and clear error messages.

## 7. Decisions only the owner can make
1. Open source (and which license) or paid, or free core with a paid EDEN integration.
2. The name (Swarm Kit is a working title).
3. Whether it is released under Absolute Zero Interactive / Devostater, and on which channels (npm, GitHub Marketplace, VS Code Marketplace, Fab, Unity).
4. When: after the plugin launch (recommended) or in parallel.
