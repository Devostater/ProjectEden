# EDEN's first in-house test: the swarm builds and launches a product

Part of roadmap round 1 (#10, Claude's part #11). Planning only.

## 1. What the test is
EDEN's AI swarm builds and launches a real product, a **random level generator plugin for Unreal Engine 5 and Unity** (technical plan: `30-level-generator-plugin.md`, by Codex), and runs its business side (sales, devblog, social: `40-sales-devblog-social.md`, by Gemini). The owner acts as the studio head: sets goals, answers questions, approves merges and anything public.

It tests **EDEN**, not just the plugin. A launched plugin with a messy process is a partial pass.

## 2. What it exercises
| EDEN feature | How the test uses it |
|---|---|
| SWRMsync + issue task board | Every piece of work is an issue tagged for one AI |
| Per-AI copies + draft PRs | Each AI builds on its own branch; no shared files |
| Cross-AI review | Every PR gets a review from another AI before the owner merges |
| Gemini PR review action | Advisory review on every PR (once the key is set) |
| Project roadmap, Trail, Progress | A "Level Generator" project in Eden tracks blocks and AI steps |
| Toolbox | Engine paths, store links and keys (names only) for the project |
| Activity / error messages | Every failure must end with a plain "what to do" |
| Devblog from roadmap | Posts drafted from roadmap changes and the Trail |

## 3. Roles
| Who | Does | Approves / decides |
|---|---|---|
| Owner | Goals, engine installs, store and social accounts, anything public, merges | Everything that ships or is posted |
| Claude | Lead integrator: shared core, Unreal side, test harness, joins work, writes the test report | |
| Codex (ChatGPT) | Unity side, algorithm core review, test plans | |
| Gemini (Antigravity) | Store page, trailer and images, devblog and social drafts, market research | |
| Each AI | Reviews the other two AIs' PRs | |

Codex's plan may change the engine split; the overview reconciles it.

## 4. Stages and owner gates
1. **Plan** (this round): roadmap files merged. *Gate: owner approves the plan.*
2. **Prototype:** algorithm core generates levels from a seed, with the same result for the same seed. *Gate: owner sees sample levels.*
3. **Engine integration:** works in both engines with a sample scene each. *Gate: owner opens both samples.*
4. **Polish + docs:** editor UI, docs, demo video. *Gate: owner accepts the store package.*
5. **Store submission:** submitted to Fab and the Unity Asset Store. *Gate: owner submits (their accounts).*
6. **Launch:** devblog post, social posts, store pages live. *Gate: owner approves every public post.*
7. **Report:** results measured against section 5.

## 5. What gets measured
Recorded per stage, from GitHub, Eden's Trail and the AI usage panel:

| Measure | Source | Why |
|---|---|---|
| Calendar time and active AI time | Issue/PR timestamps, Trail | How fast the swarm really is |
| AI usage per AI (messages/tokens; cost if pay-per-use) | AI usage panel | Is a three-AI swarm affordable |
| Owner interventions: count and minutes | A log the owner keeps (one line per time they had to step in) | The main measure of autonomy |
| PRs: opened, merged, rejected; review findings that were real bugs | GitHub | Does cross-review catch real problems |
| Defects found after merge | Issues labelled bug | Quality of the swarm's work |
| Swarm breakdowns (an AI didn't start, got stuck, conflicted) | Activity, terminal tabs | Reliability of EDEN itself |

## 6. Pass / fail
- **Pass:** plugin accepted on at least one store; at least 80% of PRs merged after AI review with no owner code edits; no lost work; every swarm breakdown has a fix filed as an EDEN issue.
- **Partial:** plugin built but not submitted, or the owner had to step in on most tasks. Findings become EDEN issues before beta.
- **Fail:** the swarm can't finish a stage without the owner doing the work. Stop and fix EDEN first.

These thresholds are proposals for the owner to adjust before stage 2.

## 7. First lessons already (round 1 launch, 16 Nov)
- The Gemini CLI wasn't signed in, so its tab stopped at start. Fix: SWRMsync should check each AI's sign-in first and say which one needs it.
- Claude's tab exited without starting a session; cause not yet known. Fix: SWRMsync should keep a log of each tab's start-up output.
- `gh` isn't signed in, so AIs can't open PRs themselves; they print a link instead.

## 8. Decisions for the owner
1. Accept the pass/fail thresholds or change them.
2. Engines and versions to support (UE 5.x and Unity versions installed on this PC).
3. Budget ceiling for the test (AI usage, any paid assets or store fees).
