<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a4d7dae2-92b7-4785-8544-a81d48c12246

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

On this PC, use **Start Eden** (`Start Eden.bat`) instead. It checks the code first and keeps Eden running.

### Unreal tools for Codex jobs

Add the optional `"unreal": true` field to the relevant codebase object in `.eden-codebases.json`, then restart Eden. In Construction, select that codebase and tick **Run this job with Codex**. Eden checks for an open Unreal Editor and the Aura plugin files at launch. Set `unrealEngineDir` in Settings if Unreal is installed outside the default `C:\Unreal Engine 5\UE_5.8`.

Codex uses Aura's inspector by default. Tick **Let the AI change the open Unreal project** for each job that needs write access. Aura changes go directly into the open project, outside Eden's worktree review and Undo.

## Projects in C:\AZI (New project + GitHub sync)

Every project lives in its own folder in `C:\AZI` with a **private** GitHub repo. Eden sets that up and keeps it in sync.

**Start a project** (any of these):
- **Projects → New AZI project**, or say or type **"new project Star Courier"** in the command box. The form opens with the name filled in.
- **LYRA → 🌿 EDEN page → 📁 AZI projects → ➕ New project** (works from the tablet too).

Eden then: makes `C:\AZI\<Name>` (README, CLAUDE.md, a `.gitignore` that keeps secrets and builds out) → moves any key or `.env` files to `C:\AZI\Security\Keys\<Name>` → first commit (files over 50 MB stop it) → creates the private GitHub repo and pushes → adds it to Projects and Code updates → checks this PC and GitHub match → shows **✅ Ready / ⚠️ Partly ready** (with what to do next) and writes a note in `C:\AZI\AI handoff`.
A folder that already exists? Tick **Use the existing folder**: it gets set up, never replaced.

**Keep it in sync:**
- A project's **Sync** button shows its state (🟢 Up to date · ↑ to push · ↓ to pull · N uncommitted). Click it to pull and push, optionally committing your changes with a message.
- Sidebar → **GitHub**: every repo in `C:\AZI` (🟢 synced, 🟠 needs a sync, ⚪ not on GitHub, 🔵 GitHub only: click to copy it in) with 🔒 private / 🌐 public, plus **Sync all** and **Auto** (off / when Eden starts / daily / both).
- Sync never force-pushes, and only commits when you give it a message.

**Needs:** a GitHub token with the `repo` scope in Settings → Connect AI (or `gh auth login`). Without one, projects are still made on this PC, and the report says how to publish them from GitHub Desktop.

Code: `newproject.ts` (server), `src/components/ProjectsView.tsx` and `Sidebar.tsx` (UI), `src/commands.ts` (voice). Spec and log: `C:\AZI\AI handoff\2026-11-16-eden-new-project-plugin.md`.

## Roadmaps and the project Toolbox

**Roadmap ("Under construction").** Each project page has long-term goals made of building blocks. Click a block to move it Planned → Building → Done. This is planning, not AI work. The Dashboard's first panel shows every project's roadmap and the overall progress. New roadmaps start from 🚀 Release, 🔧 Feature or Blank. Code: `src/components/Roadmap.tsx`, `POST /api/projects/:id/roadmap`.

**Toolbox (per project).** Tools, keys and links that belong to one project only:
- **Tools:** a name and a command (and an optional subfolder). They run in the project's folder in `C:\AZI`, with a Run button and the output on the page.
- **Connections:** keys and endpoints for this project (pick a service such as Azure AI to add its key names). Values are saved to `C:\AZI\Security\Keys\<project folder>\.env` and never shown again; the page only lists the names.
- **Isolation:** a tool gets its own project's keys plus `AZI_PROJECT` and `AZI_PROJECT_DIR`. Eden's own keys (GitHub, Gemini, Claude, OpenAI) are removed from its environment, and another project's keys are never loaded.
- **Links:** docs, dashboards, portals.
- Changing tools or keys and running tools only works from this PC, and not from another website open in the browser.

- **AI for this project's cards:** choose "The team's usual AIs" or one of the project's own connections (Azure AI, OpenAI, Claude, Gemini). The card is then answered by that service with the project's keys, and the result is marked "via … (this project's own connection)". It is strict by default: if the connection fails, the card waits and nothing is sent to another AI; tick "If it fails, use the team's AIs" to allow a backup. **Test** sends one tiny message to check it. Web search, heavy graphics (Unreal) and Plan with Chief still use the team's AIs.

Code: `toolbox.ts` (`generateForProject`), `cardRunner.ts`, `src/components/Toolbox.tsx`. Azure needs `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` (optional `AZURE_OPENAI_API_VERSION`).

**Bottom bar (project page).** Flow · Workload · Progress · **Roadmap** · **Toolbox** · **Preview**. Preview browses the project folder and shows files the way they read best (Markdown, images, video, audio, PDF, JSON, CSV tables, code) plus the latest tool output. It is read-only, and secrets, Eden/LYRA state and LYRA's browser profile are never shown. **Large screen** (top right of the bar) fills the window with any tab; Esc returns.
