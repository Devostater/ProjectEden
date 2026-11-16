# AI handoff — 16 Nov 2026

For: the Claude session running on Victus in the AZI folder.
From: the cloud session that fixed Eden's startup today (https://claude.ai/code/session_01Rs5n92Bu8PCRFaQCDmadPA).

## Where things are now

- **AZI** is the one home for all projects, files, notes and chats. It was moved out of OneDrive today. The owner says every project is organised with its own files and GitHub repo, and Eden is working.
- **GitHub repos** (all under Devostater): ProjectEden, Project-Nova, aistudio-nova-news.
- **ProjectEden `main`** is up to date as of commit `9e83432`. Branches `eden-ai-hub`, `eden-ai-hub-3irulx` and `claude/sleepy-bohr-7wuqm6` are all merged into `main` and can be deleted.
- **Old copies that are now stale** and should not be run or edited: `D:\Reginald\eden-ai-dashboard` and `C:\Users\devos\Documents\GITHUB\ProjectEden` (if they still exist). The live checkout is the one GitHub Desktop points at inside AZI.
- **API keys are gone** from every copy; the owner will add them again later. Eden reads them from `eden-ai-dashboard\.env.local`.
- **NOTES_26** moved from the OneDrive desktop into AZI.

## What changed in Eden today (all on `main`)

1. `scripts/hub-supervisor.mjs` — a leftover `.eden-logs\supervisor.pid` no longer blocks startup unless the hub is actually answering. Fixes "won't start after an emergency stop".
2. `restart.ts` + supervisor — "Stop the server" exits with code 64 so the supervisor stops for real and clears its lock. Exit 0 still means "restart me".
3. `Start Eden.bat` — runs from its own folder (not a fixed `D:\Reginald`), prints folder / Node version / branch / commit, warns about local changes, installs `node_modules` if missing, runs `tsc --noEmit` first and stops with the file and line on syntax errors (TS1xxx), and adds a **Start Eden** shortcut to the desktop on first run.
4. Supervisor `openApp()` — opens `http://localhost:PORT` in a Chrome app window instead of a hard-coded Chrome app ID (which could open LYRA's app). LYRA only starts from Eden's LYRA panel.

Unresolved: before these fixes the hub died with a `TransformError` (syntax error in a .ts file) on the owner's PC while `main` was clean. That was almost certainly a stale local copy, not `main`. If it comes back, `Start Eden.bat` now names the file.

## The job: clean up the archive

The owner has an **archive folder inside AZI** that holds ALL old files, including redundant copies of things that now live in the organised project folders. Goal: make the archive hold only what is not already current, without losing anything unique.

Suggested approach (confirm the archive path with the owner first):

1. **Inventory, don't delete yet.** Walk the archive and the current project folders. Hash file contents (SHA-256) and group by hash. Skip `node_modules`, `.git`, `dist`, `.eden-logs`.
2. **Classify every archive file** as one of:
   - **exact duplicate** — same hash exists in a current project folder → safe to delete from the archive;
   - **older version** — same relative path or name in a current folder but different content → show a diff summary; default is keep the current one, delete the archive copy, unless the archive copy is newer or larger in a way that suggests lost work;
   - **unique** — nothing like it in the current folders → keep, and suggest which project it belongs to.
3. **Write the report** to `AZI\Handoff\archive-cleanup-report.md` with counts and the full list per class, then ask the owner before deleting anything. Prefer moving to `AZI\Archive\_to-delete\` over deleting outright so it can be undone.
4. Special cases: `.env*`, `*.key`, `*.pem` — none should exist (keys are gone) but flag any found. Large media (`.mp4`, `.glb`, images over 10 MB) — list separately; dedupe by hash only.
5. After cleanup, in each project folder run `git status` and commit/push anything the move left uncommitted so GitHub matches the disk.

## Also worth doing while there

- Remove the old Eden desktop icons and anything Eden/LYRA-related in `shell:startup`, so only the new **Start Eden** shortcut remains.
- Delete the stale copies in `D:\Reginald` and `C:\Users\devos\Documents\GITHUB` once the owner confirms nothing unique is left in them (the hash inventory above answers that).
- Delete the merged ProjectEden branches on GitHub.
