# __NAME__: rules for every AI

- The product is the plugin in `Plugins\__NAME__`. The host project around it only exists to build and test it.
- You cannot run Unreal Engine from an AI sandbox. Write the code and an automation test for it. The proof is
  `autopilot\proof.ps1`. The hub or the autopilot runs it, never you.
- A task is done when its proof passed, not when the code is written or saved to git.
- Every behaviour needs an automation test whose name starts with `__NAME__.`.
- Never edit `autopilot\run.ps1` or `autopilot\proof.ps1` as part of a task, and never mark a task done yourself.
- Never use `git add -A`. Save only the files your task changed. Build output (`Binaries`, `Intermediate`,
  `Saved`, `DerivedDataCache`) and editor tool data (`.Aura`, `.ludus`) never go into git.
- One writer at a time. While the autopilot is working (`autopilot\runs\runner.lock` exists), nobody else
  changes files here. If the autopilot itself started you for a task, that lock is yours: do the task.
- No keys, tokens or passwords in this folder.

## Fab's rules (the proof checks these)
- Every source file, header and `.Build.cs` in the plugin starts with this exact line:
  `// Copyright __YEAR__ __PUBLISHER__. All Rights Reserved.`
- File and folder names in the plugin: English letters, digits and underscores only. No hyphens, no spaces.
- The plugin may depend on plugins that ship with the engine, never on another user-made plugin. Editor AI tools
  such as Aura and Ludus belong to the owner's editor: never add them to the `.uplugin`.
- Every header includes what it uses. The packaging build compiles each file on its own (strict includes), so a
  missing include that the normal build hides fails the proof.
- Keep `EngineVersion`, `CreatedBy`, the `FabURL` key and `PlatformAllowList` in every module of the `.uplugin`.
- A bought plugin is installed into the engine, not into a project. Never use a path that only works inside this
  host project: find the plugin's own files through the plugin manager.
