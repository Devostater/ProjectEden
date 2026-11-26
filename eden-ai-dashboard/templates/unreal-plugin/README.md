# __DISPLAY__

__PURPOSE__

An Unreal Engine 5.8 plugin, made from EDEN's "Unreal plugin" starter on __DATE__.

## What is here
| Path | What |
|---|---|
| `Plugins\__NAME__\` | The plugin. This is the product. |
| `__NAME__Host.uproject`, `Source\`, `Config\` | A small host project that only exists to build and test the plugin. |
| `autopilot\TASKS.md` | The task list for the autopilot. |
| `autopilot\run.ps1` | The autopilot: does the open tasks with Codex, one at a time. |
| `autopilot\proof.ps1` | The proof. See below. |
| `dist\` | The upload package, written by the proof. Not saved to git. |

## The proof
A change is done when the proof passed, not when the code is written.

    powershell -NoProfile -ExecutionPolicy Bypass -File autopilot\proof.ps1

It ends with `PROOF PASSED` or `PROOF FAILED` and the reason. It checks, in this order:

1. Fab's rules that can be read from the files: the copyright line, file names, the `.uplugin` fields, dependencies.
2. The host project builds with the plugin.
3. The plugin's automation tests pass.
4. Epic's own packaging build passes (`RunUAT BuildPlugin` with strict includes). Fab runs this on every upload.
5. The upload package `dist\__NAME__-<version>.zip` is written from the plugin's files.

Other ways to run it:

- `-Quick` does steps 1 to 3 only. It is faster and it is not the proof.
- `-CheckPackage` builds nothing. It checks that the zip is there, complete and newer than every plugin file. Run it right before an upload.

Close the Unreal editor on this project first: an open editor locks the plugin's files. Another Unreal build may run at the same time; the proof waits for its turn.

## Working on it
- From EDEN: Code updates, pick this project, describe the change. EDEN runs the proof on a copy and holds Apply until it passed.
- With the autopilot: write tasks in `autopilot\TASKS.md`, then press Start on this project's runner in EDEN. A task is marked done only after the proof passed.
- By hand: open `__NAME__Host.uproject` in Unreal Engine 5.8.

## Before an upload to Fab
1. In `Plugins\__NAME__\__NAME__.uplugin`: fill in `Description`, `CreatedByURL`, `DocsURL` and `SupportURL`, and raise `Version` and `VersionName`.
2. Create the product in the Fab Publisher Portal as a draft. Put its ID into `FabURL` as `com.epicgames.launcher://ue/Fab/product/<ID>`. The ID is the end of the product's address in the portal.
3. Run the proof. Upload the zip it writes. Run the proof with `-CheckPackage` right before the upload if anything was touched since.
4. On the Fab form, say that AI tools were used if they were. Fab asks for this.

Fab installs a bought plugin into the engine (under `Engine\Plugins`), not into a project. A buyer adds it from their Fab library and switches it on in the editor under Edit, Plugins.

## Good to know
- Keep this folder's path short. Unreal's build tools stop at 260 characters.
- This project stays on this PC unless you choose to put it on GitHub.
- Rules for AIs working here are in `AGENTS.md`.
