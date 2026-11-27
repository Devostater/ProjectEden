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

Start Eden shows a built copy of the pages (`dist`). Each time the hub starts or restarts, the keeper (`scripts/hub-supervisor.mjs`) builds the pages again if the code has changed since the last build, for example after a Code update or a pull from GitHub. So an applied hub update shows after **Restart Eden now**. If the build fails, the last working pages stay and the reason is in `.eden-logs\hub.log`. Only `npm run dev` reloads pages live.

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

## All projects (Dashboard)

The Dashboard's **All projects** panel has one card for every project in `C:\AZI` (the table in `C:\AZI\AGENTS.md`). Each project keeps its own folder and git repo; the panel only reads them and never commits, pushes or syncs. A card shows the git branch and changed files, a **local only** or **GitHub** mark, the `autopilot\TASKS.md` progress and the runner's state, a **Folder** button, and the project's launchers (PassGuard, SysPulse). Launchers start hidden with a log in `.eden-logs\hub\`, and a server launcher checks its port first so a second copy never starts.

**Reel** also has: **Open Reel Studio** (port 7870), **Music Maker** (`tools\music-maker.ps1`), **Run a step** (`python -m director <step> projects\<name>`, one at a time, waits while a runner works in Reel) and **Finished videos** (`projects\<name>\out\`, played on the page).

Only from the hub on this PC. The list lives in `hub.ts` (`HUB_PROJECTS`). `EDEN_HUB_ROOT` (default `AZI_ROOT`, then `C:\AZI`) sets where the projects are, so a test hub can point `AZI_ROOT` at a scratch folder and still show the real projects. Code: `hub.ts`, `src/components/AllProjectsPanel.tsx`, `test/hub.test.ts`.

## Runners

On the computer running Eden, open **Code updates → Construction → Runners** to start, stop, and watch local autopilots. Copy `.eden-runners.example.json` to `.eden-runners.json` next to this README and adjust the entries for your machine. Eden reads this local, ignored file when it checks status or starts a runner.

Each entry has a unique lowercase `id` (letters, digits, and hyphens), `name`, working directory `cwd`, and shell `command`. Optional `tasksFile` and `logFile` paths resolve relative to `cwd`. The progress bar counts `- [x]` as done and shows the first unfinished task (`- [ ]` or `- [!]`). Optional `needsClosed` lists process names to check before launch. Set `"args": "issueNumbers"` for a runner that accepts space- or comma-separated issue numbers. The registry's `maxRunners` defaults to 3.

Eden starts runners in hidden processes and appends their output to `.eden-logs/runners/<id>.log`. **Show log** displays the last 40 lines of captured output and of the optional project log. Closing the browser leaves runners active. **Stop** terminates the process tree. A hub restart marks active runners **Stopped by restart** and requires a manual start.

**One writer per folder.** While a runner works in a folder, Eden does not change that folder: Apply, Undo, "Save to GitHub now" and Sync (pressed or automatic) wait and name the runner. A runner cannot be started while Eden is changing its folder, and two runners cannot work in the same folder at once. Folders count as the same when one is inside the other or both are in the same git repository.

A runner that was started outside Eden (a double-click, a shortcut) is only seen if its entry names a `lockFile` (a path relative to `cwd`) and the script keeps that file while it works. The file is JSON with the script's process id, for example `{ "pid": 1234, "image": "powershell.exe" }`; `image` is optional and guards against a reused process id on Windows. Eden then shows the runner as **Running outside the hub**, does not start a second copy and does not stop it. A runner started outside Eden with no lock file is not seen.

## Unreal plugin starter

Choose **Unreal plugin (UE 5.8, with autopilot)** in New project. It creates an Unreal host project, a plugin with one automation test, and an autopilot task list. Eden adds the project to Code updates with Codex and registers its runner. Press Start to run it. The project stays on this PC unless you tick the GitHub box.

The proof script `autopilot\proof.ps1` checks Fab's rules, builds the project, runs the automation tests and Epic's packaging build, and makes the upload zip. A task is done only after the proof passes.

Eden asks for the publisher name for the generated plugin's copyright lines. The publisher name is never stored in this repository. The starter files live in `templates/unreal-plugin/`.
