# Tasks for __DISPLAY__

The autopilot (`autopilot\run.ps1`) does the open tasks from top to bottom with Codex. It marks a task `[x]`
only after `autopilot\proof.ps1` passed, and `[!]` when a task failed its proof three times.

How to write a task: one line with an id and what to build, then indented lines with the details and what the
automation test must check. Example:

> - [ ] T01 Add a setting for the greeting text
>   The automation test checks the default text and a changed text.

Write the tasks under this line.
