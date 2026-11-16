# EDEN: product plan (AI swarm suite for digital development)

Part of roadmap round 1 (#10, Claude's part #11). Planning only. Facts marked **[checked]** were read from the code, Eden's own Project EDEN roadmap, or `MASTER_PLAN.md` on 16 Nov 2026. Everything else is a proposal.

## 1. What EDEN is
A desktop hub where a small studio (today: one owner) runs a **team of AIs** that plan, build, review and ship digital products, with the owner approving every change. The AIs come from the subscriptions the owner already pays for (Claude, ChatGPT/Codex, Gemini) plus free local models (Ollama), so there is no per-token bill by default.

**Who it is for (v1):** solo developers and tiny studios who already use 2+ AI subscriptions and want them working together on real projects, safely, without becoming DevOps engineers.

**What makes it different (proposal):**
- Several AIs work **in parallel on separate copies** and **review each other** before the owner merges (SWRMsync + GitHub PRs).
- **Nothing changes real code without approval:** Code updates show every line first, and Apply/Undo use restore points **[checked]**.
- **Projects are run as roadmaps of building blocks**, not chat logs **[checked: Roadmap, Trail, Progress views]**.
- Plain language and accessibility first (text size, large controls), because the first user is not a programmer.

## 2. What exists today **[checked]**
From the Project EDEN roadmap in Eden (Product goal: 6 done, 1 building, 6 planned):

| Done | Building | Planned |
|---|---|---|
| AI team, chat, Nexus rooms | Roadmap and progress visuals | Onboarding for new users |
| Projects, boards, workflows | | Settings and keys tidy-up |
| Code updates (reviewed AI changes) | | Stability and error reporting |
| AZI projects: new project, GitHub sync | | Installer / download for other PCs |
| LYRA link and tablet launch | | Beta testers |
| Voice and typed commands | | Version 1.0 |

Since the roadmap was written, also built: project side panel, Trail, Preview, Toolbox, themes, custom dashboard, profile, and the **swarm workflow**: GitHub issues as the task board, `claude/` `chatgpt/` `gemini/` branches, draft PRs, cross-AI review, SWRMsync (#9), Gemini PR review action (#8, not yet configured).

The Store page, Devblog, Website and Support goals in Eden are all still at "planned" **[checked]**.

## 3. Version 1: what ships, what is cut
**In v1 (proposal):**
1. Swarm core: SWRMsync, issue task board, per-AI copies, draft PRs, cross-review, owner merge. Works with Claude + Codex + Gemini CLIs.
2. Code updates with overlap protection (#7) and restore points.
3. Projects with roadmap, Trail and progress; weekly owner summary.
4. Onboarding: a first-run wizard that checks each AI is installed **and signed in** (today a missing sign-in silently stops an AI: found on the first SWRMsync run, Gemini CLI).
5. Installer for Windows; settings with one GitHub token of minimal scope.
6. Stability: one error log, clear "what to do" messages (already started in Activity).

**Cut from v1 (later):** LYRA tablet features for other users, Nexus rooms polish, mobile app, multi-user teams, cloud hosting, macOS/Linux.

## 4. Milestones to public release
Each milestone is done when the listed check passes. Owner approves each.

| # | Milestone | Done when | Depends on |
|---|---|---|---|
| M1 | **Swarm works end to end** | One SWRMsync press: all three AIs start, take their issue, open a draft PR, and review each other, with no manual fixing. | #7, #8 merged; CLIs signed in |
| M2 | **In-house test** (see `20-inhouse-test.md`) | The level generator plugin is built by the swarm to its own "done" list, and the test report is written. | M1 |
| M3 | **Onboarding + installer** | A clean Windows PC (or new user account) goes from download to a first working swarm task in under 30 minutes, guided only by the wizard. | M1 |
| M4 | **Stability pass** | 2 weeks of daily use with no lost work, and every error in Activity has a plain fix message. | M1 |
| M5 | **Closed beta** | 5-10 outside testers have used it for 2 weeks; feedback triaged into issues. | M3, M4 |
| M6 | **Store page + site live** | Store page, landing page, docs and support form are live (Gemini's plan, `40-…`). | M5 |
| M7 | **Version 1.0 release** | Beta blockers fixed, release notes published, pricing decided by the owner. | M5, M6 |

No dates are given yet: the in-house test (M2) is the first real measure of how fast the swarm works, so dates are set after it.

## 5. Reliability and safety before strangers use it
- **AI sign-in checks** before starting the swarm (Gemini CLI wasn't signed in on first run).
- **Secrets:** keys stay in the OS / `Security\Keys`; nothing secret in repos, PRs or logs; Gemini PR review scans diffs before sending (#8).
- **Permission model:** AIs ask the owner for risky actions; merges always by the owner.
- **Usage limits:** three AIs at once can hit plan limits; EDEN should show usage per AI and pause politely (partly built: AI usage panel, 5-hour-limit handling).
- **Tests and CI:** route-level tests for Code updates and project creation; a CI job for type check + tests on every PR.
- **Public repo:** ProjectEden is public; decide before beta whether it stays public (owner decision).

## 6. Risks
- Depends on third-party CLIs (Claude Code, Codex, Gemini) whose flags and login flows change; keep the launcher thin and tested.
- Plan terms of each AI provider may limit automated use; check each provider's current terms before selling (not yet checked).
- One owner: support load after launch could swamp development; plan support (Gemini's file) before M7.

## 7. Decisions only the owner can make
1. Who v1 is for (solo devs vs. small teams) and whether it is paid, free, or open source.
2. Whether ProjectEden stays a public repo.
3. Which AIs are required vs. optional in v1.
4. Go/no-go after the in-house test.
