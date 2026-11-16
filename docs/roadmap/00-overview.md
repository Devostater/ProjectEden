# EDEN roadmap: overview (round 1)

Joined by Claude from five AIs' parts, 16 Nov 2026. Coordination issue #10. Planning only: nothing here is built yet
unless it says so. Owner: Devostater (Absolute Zero Interactive).

| Part | Written by | File / PR |
|---|---|---|
| EDEN product plan, in-house test | Claude | `10-eden-product.md`, `20-inhouse-test.md` (#14) |
| Level generator plugin (UE5 + Unity) | Codex (ChatGPT) | `30-level-generator-plugin.md` (#15) |
| Sales, tracking, devblog, social | Gemini (Antigravity) | `40-sales-devblog-social.md` (#16) |
| LYRA's role | LYRA: **not written yet** (see section 4) | to follow |
| Free local AI work | Local Ollama (qwen2.5-coder 7B) | `60-local-ai.md` (this PR) |

## 1. The plan in one paragraph
EDEN becomes an **AI swarm suite for digital development**: several AIs work in parallel on separate copies of a
project, review each other on GitHub, and the owner approves every merge. Its first real test is to **build and
launch a random level generator plugin for Unreal Engine 5 and Unity**, with the swarm also running the store pages,
devblog and social posts. The test measures how much the owner still has to step in. What we learn sets EDEN's
dates and its path to a public release.

## 2. One timeline
Stages are in order; dates are set after stage B, once real speed is measured. Each stage ends at an owner gate.

| Stage | What happens | Who | Done when | Owner gate |
|---|---|---|---|---|
| **A. Swarm ready** (EDEN M1) | All AIs start from SWRMsync, each AI signed in, PR flow works end to end | Claude | One press: every AI takes its issue and opens a draft PR with no manual fixing | Merge #7, #8, #17; sign in `gh` and the Gemini CLI |
| **B. Contract** (plugin M0) | Shared level spec, random-number rules, data format, test fixtures; engines and versions chosen | Claude + Codex | Both engines read the same tiny test layout identically | Approve v1 scope, engine versions, budget ceiling |
| **C. Core prototype** (M1) | Room-and-corridor generator in C++ (Claude) and C# (Codex) | Claude, Codex; local AI drafts test lists | Same seed gives the same layout in both; 1,000-seed sweep passes | See sample levels |
| **D. Engine integrations** (M2) | Unreal and Unity tools: generate, clear, bake, two samples each | Claude (Unreal), Codex (Unity); LYRA sample art | Samples run in editor and a Windows build | Open both samples |
| **E. Performance + docs** (M3-M4) | Measured budgets, quick start, docs, outside tester | Claude, Codex, Gemini (docs look) | Budgets met or limits published; tester succeeds from the docs | Accept the store package |
| **F. Store prep** (M5) | Current Fab and Unity store rules checked and listed; listings, media, trailer | Gemini (listing, media), engine owners (technical), owner (accounts) | Dated checklist complete; exact archives approved | Owner submits from own accounts |
| **G. Launch** (M6) | Submission, devblog post, social posts, links page | Owner submits; Gemini drafts posts; LYRA visuals | Store status recorded; posts approved and published by the owner | Approve every public post |
| **H. Report** | In-house test report: time, AI usage, owner interventions, real bugs found by review | Claude | Report merged; EDEN fixes filed as issues | Go/no-go for EDEN beta |
| **I. EDEN to release** (EDEN M3-M7) | Onboarding + installer, stability, closed beta, store page + site, v1.0 | All | Per `10-eden-product.md` | Each milestone |

Devblog runs alongside from stage B: one post every two weeks (Gemini's plan), drafted from Eden's roadmap and Trail.

## 3. Where the parts disagreed, and how this overview settles it
1. **Navigation support in the trailer.** Gemini's trailer shows NavMesh support; Codex's v1 excludes automatic navigation baking.
   **Settled:** v1 ships without automatic navigation; the trailer shows walkable, connected levels only. Navigation is a v1.x idea.
2. **Speed claims.** Gemini's post 5 says "under 50 ms"; Codex proposes layout p95 at or under 100 ms, not yet measured.
   **Settled:** no number goes in any post or listing until it is measured on the benchmark PC (stage E).
3. **Store rules and money.** Revenue splits, launch-discount effects and price ranges are unverified in every part.
   **Settled:** all stay "to verify" until stage F checks the official pages, with the date and link recorded.
4. **Local model sizes.** The local AI part says the 14B model works well on this PC; on a 16 GB laptop with a 6 GB
   graphics card it used about 10 GB and stalled other work today, while the 7B model answered in under 3 minutes.
   **Settled:** use qwen2.5-coder 7B by default; 14B and gpt-oss 20B only when UE5 and the swarm are closed.
5. **Who builds what in the plugin.** Claude's test plan and Codex's plan agree: Claude owns the spec, the C++ reference
   core and Unreal; Codex owns the C# core, Unity and the parity checks. Gemini: listings, media, devblog. LYRA: proposed for art and
   sample-scene visuals and voice control, to be confirmed by LYRA herself. Local AI: first drafts, test-case lists, summaries, small reviews.

## 4. What today's first swarm run taught us (already in progress)
- An AI that isn't signed in stops silently (the Gemini CLI). Fix planned: SWRMsync checks every sign-in first.
- The Claude tab exited at start; cause unknown. Fix planned: log each tab's start-up.
- `gh` isn't signed in, so AIs can't open PRs themselves; Claude opened them through the signed-in browser.
- Running big local models next to everything else filled the 16 GB of memory. Fix: small model by default, and
  SysPulse (the new local health app) to see and free memory.
- LYRA could not write her part: long requests from Eden to LYRA are cut off ("terminated") after a few minutes, twice.
  Fix planned: an Eden issue to give LYRA chat requests a longer timeout or streaming, then re-run LYRA's part.
- Two AIs at once on one PC is fine; three AIs plus local models plus UE5 is not, on this laptop.

## 5. Decisions only the owner can make
1. **Approve this plan** and the v1 plugin scope (single-floor rooms-and-corridors dungeon, bring-your-own-art).
2. **Engine versions** to support (one UE5 version, one Unity LTS) and whether to start Windows-only.
3. **Budget ceiling** for the test: AI usage, any paid assets, store fees.
4. **Accounts:** sign in `gh` and the Gemini CLI; later, Fab and Unity publisher accounts (identity, tax, payouts are yours alone).
5. **Pass/fail rules** for the in-house test (proposed in `20-inhouse-test.md`).
6. **Public repo:** whether ProjectEden stays public before outsiders use it.
7. **Price and channels:** decided after stage F's verified research, not before.

## 6. Next three actions
1. Owner: merge the round-1 PRs (#14, #15, #16 and this one) once happy, and the swarm fixes (#7, #8, #17).
2. Claude: open stage A issues (sign-in checks, start-up logs) and stage B issues tagged for Claude and Codex.
3. Gemini: devblog post 1 draft ("The Blueprint"), for the owner to approve before anything is published.
