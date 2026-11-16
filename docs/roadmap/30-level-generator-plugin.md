# Procedural level generator: technical and release plan

Planning proposal for roadmap round 1, Codex section. No implementation or benchmark results are claimed.

## Evidence and boundaries

Read `swarm/tasks/roadmap-round-1.md` and `docs/AI_COLLABORATION.md` in this checkout.
Also read `docs/roadmap/10-eden-product.md` and `20-inhouse-test.md` using
`git show origin/claude/11-roadmap:<path>` from the locally available remote-tracking branch.
These are planning drafts, not evidence that the plugin or EDEN release gates already pass.
No web access was used. No current store requirements were verified; every store rule below is **to verify**.
The numbers below are proposed acceptance budgets, not measured performance or store requirements.

## Recommended v1

Build a single-floor, rectangular grid dungeon made of rooms and connecting corridors.
Generate the layout first, then place the buyer's modular meshes or prefabs on that grid.
Use binary space partitioning: repeatedly split an area, place a room within each section,
and connect the sections into one reachable layout. Optional extra connections create loops.
This is a bounded, explainable first product with straightforward connectivity tests.
Wave-function-collapse, open worlds and arbitrary 3D rooms would multiply constraint and support work.

Three reasons to buy it:
1. Reproducible layouts: enter a seed, save a preset, preview and regenerate the same dungeon.
2. Usable layout controls: room sizes, room count target, corridor width, loop rate,
   and reachable start/exit markers, with clear messages for impossible combinations.
3. Bring-your-own-art workflow: assign floor, wall and doorway pieces; preview,
   clear only generated objects, or bake a layout into ordinary editable scene objects.

Ship editor generation and an explicit runtime Generate call, plus a completion event.
Runtime generation may take a short loading pause; do not promise seamless generation during play.
Include neutral, owned or permissively licensed demonstration art and two samples per engine:
minimal integration and a small themed dungeon using the same underlying layout.
Support one documented module size convention, adjustable cell size, and 90-degree rotations.

Exclude terrain, stacked floors, streaming, multiplayer replication, quests, enemy AI,
automatic navigation baking, custom mesh synthesis and guarantees of gameplay balance.
Start/exit markers and connected cells do not guarantee every buyer's character fits their art.
Documentation must explain corridor clearance, collider setup and optional navigation setup.
Choose one UE5 minor version and one Unity LTS version at kickoff; publish exact tested patches.
Start with Windows editor and Windows desktop builds. Other platforms require separate evidence.
Commercial objective is both stores; use sequential submission if one package is ready first.

## Shared core and engine boundaries

Share the algorithm specification, versioned data schema, reference fixtures and expected hashes.
Implement that small specification twice: portable C++ in Unreal and managed C# in Unity.
This avoids a native-library bridge and its Unity platform packaging burden in v1.
It does create a parity obligation: neither implementation may silently change the rules.
Revisit a single compiled native core only after profiling or maintenance evidence justifies it.

The engine-free core accepts seed, algorithm version and validated settings. It returns integer
cell coordinates, room IDs, corridor connections, tile roles and start/exit markers.
It never creates engine objects, loads art, calls editor APIs or uses engine random generators.
Use a fully specified unsigned 32-bit PRNG, explicit overflow behavior and bounded-integer sampling.
Fix draw order, traversal order and tie-breaking; avoid float-dependent layout decisions.
Reject unsupported ranges and impossible settings with bounded attempts and a useful error.

Store layouts/presets in a versioned JSON interchange format with explicit units and coordinate axes.
Use a canonical sorted layout representation for hashes; ordinary JSON property order is not a contract.
The same seed, algorithm version and settings must give identical canonical output in both engines.
An algorithm change gets a new version; keep old fixtures and publish migration behavior.
An exported layout preserves a result even if a future algorithm version changes generation.
Asset placement is engine-specific and is not part of the cross-engine layout hash.

| Part | Unreal Engine 5 | Unity |
|---|---|---|
| Core implementation | Engine-independent C++, wrapped by a runtime module | Plain C#, separate from Unity object APIs |
| Runtime integration | C++ actor/component; Blueprint settings, Generate call and completion event | C# component, serializable settings asset, Generate API and event |
| Art placement | Static meshes, instanced meshes where suitable, collision choices | Prefabs, shared materials and suitable instancing/batching |
| Editor workflow | Separate editor module, details UI, preview, undo and bake | Editor-only assembly, inspector/window, preview, undo and bake |
| Package | Plugin source, descriptors, docs and sample content | Asset package with runtime/editor separation, docs and sample scenes |

Adapters convert grid coordinates to engine units and axes; test rotation and doorway alignment.
Use engine main threads for object creation. Keep editor dependencies out of packaged runtime builds.
Track generated objects so Clear/Regenerate cannot remove unrelated scene content.
Set object-count limits and provide progress/error feedback before expensive placement.

## Team split and handoffs

**The Claude: core + Unreal, Codex: Unity split in `20-inhouse-test.md` fits this plan.**
Clarification: Claude owns the shared specification, reference core implementation in C++, fixtures,
and Unreal adapter. Codex owns the matching C# core and Unity adapter, reviews the algorithm,
and checks parity. A shared core here means shared behavior and evidence, not one shipped binary.
Agree the schema and PRNG before independent engine integration begins.
Gemini drafts store copy, media and documentation presentation from demonstrated capabilities.
Each change gets an issue, separate branch/worktree, draft PR and independent review;
the owner merges and approves releases as described in the collaboration workflow.
This planning task only creates this document; it does not open PRs or perform later roadmap reviews.

## Milestones and acceptance tests

Run core tests automatically; record engine builds and manual sample checks with exact versions.
Archive seed, settings, algorithm version, machine, timings and logs for every failure.
Dates follow the prototype measurements and owner's available time.

| Stage | Owner and dependency | Done when | How it is tested |
|---|---|---|---|
| M0: contract | Claude + Codex; owner accepts scope and versions | Schema, random sequence, coordinate convention, limits and fixture format agreed; support matrix and benchmark PC recorded | Both implementations read a tiny hand-authored layout; compare PRNG test vectors and adapter axis conversions |
| M1: core prototype | Claude implements reference; Codex ports/reviews; M0 | Both cores generate connected rooms/corridors, valid start/exit and matching layouts; invalid inputs fail clearly | Repeat 100 fixed seeds 10 times per implementation; compare canonical hashes between engines; sweep 1,000 additional seeds for bounds, connectivity and overlaps; test minimum/maximum and impossible settings |
| M2: engine integrations | Claude Unreal, Codex Unity; M1 | Generate, clear, regenerate and bake work; both sample scenes per engine run in editor and Windows player | Reopen samples, rebuild from a clean project, test collision/door alignment and start-to-exit traversal; verify undo and preservation of unrelated objects; run an explicit runtime generation call |
| M3: performance and reliability | Both engine owners; M2 | Proposed budgets below pass or scope/limits are explicitly revised and approved; no unresolved crash/data-loss defects | Profile each engine separately; repeat generation/clear 100 times; compare memory and generated object counts after warmup; rerun seed fixtures and packaged builds |
| M4: buyer-ready candidate | Both engine owners + Gemini; M3 | Quick start, API reference, limitations, troubleshooting, licenses and two samples per engine complete; an outside tester succeeds | Fresh import with no private dependencies; tester follows docs to assign their own modules and generate/bake a level; capture missing steps; verify release archive contents |
| M5: store preflight | Gemini checklist, engine owners package, owner accounts/rights; M4 | Current official rules reviewed, dated checklist saved, validator/build issues resolved, owner approves exact archives and listings | Check each requirement against the official pages; install exact candidate archives into clean supported engine projects; compare copy/screenshots with actual features |
| M6: submission | Owner submits; M5 | Both submissions have receipts/status recorded and exact submitted versions retained | Reproduce uploads from retained archives; record reviewer feedback and retest any fixes; store acceptance is a separate external gate |

Proposed benchmark workload per engine: 128 x 128 cells, up to 40 rooms, one documented art kit.
Record CPU, RAM, OS, engine patch, build configuration and rendering settings at M0.
Measure release/player code after warmup over the same 100 seeds; report median, 95th percentile
and worst case. Measure layout time separately from asset loading and scene construction.
Initial targets: layout p95 <= 100 ms and <= 32 MiB extra core working memory;
warm scene construction p95 <= 2 seconds with <= 5,000 generated objects/instances.
Record cold asset-load time separately; never hide it within a warm-cache claim.
These are loading-screen budgets, not a promise of no frame stalls.
A 256 x 256 stress case must finish or reject cleanly within a configured work limit.
Use profiler/allocation evidence and stable retained counts after cleanup to investigate leaks.
Benchmark actual visuals and collision: empty placeholder scenes alone cannot pass M3.
Publish tested limits; reduce maximum supported settings if targets cannot be met.

Determinism checks cover repeated calls, editor restarts and editor versus packaged player.
Include seed zero, maximum seed, narrow corridors, crowded settings and malformed saved data.
Use sorted output and exact integer comparison, not screenshots, for cross-engine parity.
Samples are also visual acceptance evidence: inspect seams, scale, walls, lighting and missing assets.
Successful store submission does not imply acceptance or a public launch.
Claude's EDEN test requires acceptance on at least one store; record both outcomes independently.

## Store readiness: all current rules to verify

Known from this task: intended channels are Fab for Unreal and the Unity Asset Store.
Everything below is a preparation checklist, not a claim about today's mandatory rules.
Official starting pages are listed for the future connected verification step; they were not opened.
If a link moves, navigate from the official seller portal and record its replacement.

| Store / official starting page | To verify before submission |
|---|---|
| Fab: [publisher getting started](https://dev.epicgames.com/documentation/en-us/fab/publisher-get-started-in-fab) | Seller onboarding, identity/tax/payment details, agreements, fees/revenue terms and supported countries |
| Fab: [asset file format and structure requirements](https://dev.epicgames.com/documentation/en-us/fab/asset-file-format-and-structure-requirements-in-fab) | Correct code-plugin category, source/binary expectations, descriptor fields, folder layout, size limits, supported UE versions/platforms, dependencies and sample-project delivery |
| Fab: [publishing assets](https://dev.epicgames.com/documentation/en-us/fab/publishing-assets-for-sale-or-free-download-in-fab) | Listing fields, media dimensions, documentation/support links, licensing options, content/AI disclosures, review process and update/resubmission rules |
| Unity: [Asset Store submission guidelines](https://assetstore.unity.com/publishing/submission-guidelines) | Supported Unity versions, package format/folders/namespaces, compilation warnings, dependencies, documentation, samples, render-pipeline disclosures, platform claims and any validators |
| Unity: [publisher portal](https://publisher.assetstore.unity3d.com/) | Seller eligibility, tax/payment setup, agreements/fees, listing media, price rules, licensing, review steps, update/support obligations and content/AI disclosures |

At M5, engine owners verify technical rules and Gemini prepares the listing checklist;
the owner verifies account, commercial and rights requirements. Record page title, URL,
access date, applicable rule and evidence of compliance. Recheck before actual upload.
Do not assume legacy Unreal Marketplace rules still apply to Fab or that the two stores
accept identical archives, licenses, version ranges or bundled third-party content.
Use owned demonstration assets; review redistribution rights before including any purchased asset.
Keep dependency licenses, attribution notices and a provenance list in both candidates.
Avoid promised review turnaround times or launch dates until status is known.

## Owner inputs and approvals

Before M0: confirm target buyer, this v1 scope, installed engine versions, available test PC,
Windows-only starting matrix, time/budget ceiling and who can test outside the swarm.
Provide a product name and any existing art/module kit, with proof of redistribution rights;
otherwise authorize simple original demonstration art. Decide support contact and maintenance capacity.
Before M5: provide seller accounts and complete identity/tax/payment steps directly in each portal;
choose price/license approach after current terms are checked, approve media and exact release archives.
The owner approves merges, submissions, public posts and any paid purchases.
Keep credentials out of code, generated packages, logs and shared screenshots.

AIs can draft specifications, implement both engines, generate fixtures, run available local checks,
prepare packages/docs/media and triage feedback within assigned worktrees.
They must report unavailable engines, missing build tools or unrun checks; they cannot claim those pass.
The owner supplies account access and commercial decisions, and validates the editor workflow personally.
After submission, reserve capacity for reviewer fixes and buyer support before adding features.

## Main risks and responses

- **Two implementations drift:** freeze the contract early; require cross-engine fixture parity on changes.
- **Licensing:** write original code from documented ideas; audit copied code, libraries, fonts and art.
  Algorithm ideas and source-code licenses are different questions; unresolved rights block packaging.
- **Engine upgrades:** advertise exact tested versions, cap the support matrix and retest before widening it.
  Unity render pipelines and Unreal plugin compilation can multiply maintenance work.
- **Art breaks traversal or performance:** document dimensions/collision, validate kit assignments,
  and separate layout correctness from visual placement acceptance.
- **Unbounded generation or excessive objects:** validate limits, bound retries, profile real kits,
  and fail with a seed/settings report that buyers can send to support.
- **Store rejection or changing rules:** finish M5 before promising launch; keep engine releases independent.
- **Support exceeds one owner's time:** ship reproducible bug-report fields and troubleshooting docs;
  define supported versions and response expectations before sale, without inventing service guarantees.
- **Swarm overhead hides product quality:** preserve issues, review evidence, benchmark results and owner
  intervention logs for Claude's in-house report. A working process alone does not pass plugin acceptance.
