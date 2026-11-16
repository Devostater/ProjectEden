# Roadmap round 1: briefs for each AI

Coordination issue: #10. Each AI has its own issue pointing at its section here.

**Shared rules for this roadmap round**
- Write only your own file(s) under \`docs/roadmap/\`. Don't edit another AI's file; suggest changes as PR review comments.
- Planning only: no product code in this round.
- Be concrete: milestones with a clear "done when", owner (which AI or the owner), dependencies, and risks. Mark guesses as guesses; don't invent prices, dates, store rules or numbers you haven't checked. Say what you verified and where.
- Keep each file under about 300 lines. Plain language: the owner is not a programmer.
- Branch \`<you>/<issue>-roadmap\`, draft PR with \`Refs #<your issue>\` and \`Refs #10\`.


---

## claude: EDEN product plan, first in-house test, and the joined overview

1. `docs/roadmap/10-eden-product.md`: EDEN as an AI swarm agent suite / IDE for digital development.
   - What exists today (check the code and `C:\AZI\AI handoff\MASTER_PLAN.md`; the Project EDEN roadmap inside Eden already has Product / Store page / Devblog / Website / Support blocks).
   - What "version 1" is, what is cut, and the milestones to a public release.
   - How the swarm works as a product feature: SWRMsync, GitHub issues as the task board, PR review between AIs, Code updates, project roadmaps, Trail.
   - Reliability and safety work still needed before strangers use it.
2. `docs/roadmap/20-inhouse-test.md`: the first in-house test: EDEN's AI team builds and launches the level generator plugin.
   - Which EDEN features the test exercises, what gets measured (time, usage/cost, how often the owner had to step in, defects found), and pass/fail criteria.
   - Roles per AI, the handoffs, and what the owner approves at each stage.
3. After the Codex and Gemini PRs exist: review both, then write `docs/roadmap/00-overview.md`: one timeline across all parts, dependencies between them, and the decisions only the owner can make.

---

## codex: random level generator plugin for UE5 and Unity (technical plan)

`docs/roadmap/30-level-generator-plugin.md`: the technical and release plan for a **random (procedural) level generator plugin** sold for **Unreal Engine 5** and **Unity**.
- Scope of v1: what kinds of levels (e.g. rooms-and-corridors dungeon, grid/tile, wave-function-collapse) and the 2-3 features that make it worth buying. Recommend one v1 scope and say why.
- Architecture: what is shared between engines (algorithm core, seeds, data format) and what is engine-specific (editor UI, assets, packaging). Language choices for each.
- Milestones from prototype to store submission, each with "done when" and how it is tested (determinism by seed, performance budgets, sample scenes).
- Store requirements for the Unreal marketplace (Fab) and the Unity Asset Store: what you verified from their current published rules (cite the page), and what is still unknown.
- What the owner must provide (engine versions installed, accounts, art) and what the AIs can do alone.
- Risks: licensing of algorithms/assets, engine version support, support load after launch.
Then review the Claude and Gemini roadmap PRs.

---

## gemini: sales, project tracking, devblog and social media plan

`docs/roadmap/40-sales-devblog-social.md`: how the level generator plugin (and later EDEN itself) reaches buyers, run as much as possible through EDEN.
- **Sales:** where it sells (engine stores, own site), pricing approach and how to test it, launch timing, what a store page needs (screenshots, trailer, demo scene). Don't invent prices or sales figures: give ranges only with a source, or mark them as to-be-researched.
- **Project tracking:** what the owner sees each week (roadmap progress, sales, reviews, support requests) and where the numbers come from.
- **Devblog:** cadence, the first 6 post topics drawn from the real build (the AI swarm building a plugin is the story), and how posts are drafted from Eden's roadmap and Trail.
- **Social media:** which 2-3 channels fit a solo studio selling dev tools, a links page, a posting routine, and what can be automated safely versus what the owner posts by hand.
- **Media you can prototype:** image/video/audio ideas for the store page and trailer (this is your multimodal strength); list what you'd need.
- What needs the owner's accounts or approval (store accounts, social accounts, anything posted publicly).
Then review the Claude and Codex roadmap PRs.
