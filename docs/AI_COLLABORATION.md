# AZI AI Collaboration Workflow

Status: **Proposed**. Coordination issue: #5. Owner approves the eventual merge.

## Roles
- **Owner** owns product priorities, credentials, visibility, releases and merges.
- **Claude** implements a scoped change on `claude/<topic>` and raises a draft pull request.
- **ChatGPT** independently reviews the code and checks for regressions, security, UX and tests; it may contribute on `chatgpt/<topic>` if assigned a separate task.
- Both assistants access the repository through the owner's authorized tools. A GitHub comment is not a live agent-to-agent connection.

## Per-task handoff
1. Open or link a GitHub issue. State goal, acceptance criteria, constraints, affected paths and ownership.
2. Start from fresh `main` on a separate feature branch. Do not have two agents share a worktree or write to the same branch.
3. Implement a small, reviewable change. Run and report actual relevant checks. If no tests ran, say why.
4. Open a **draft pull request** against `main`; link its issue and attach UI evidence as applicable.
5. Reviewer checks diff and up-to-date files, categorizes findings as **blocking**, **suggestion**, or **question**, and cites precise paths and lines.
6. Author answers and fixes findings; reviewer reinspects any changed code. Owner decides when to merge.
7. After merge, record results in the issue and update the project's Eden Roadmap/Trail where appropriate.

## Pull request description template

### Goal / linked issue
Closes or relates to #...

### Summary and affected paths
- ...

### Verification performed
- Commands and results (or explicitly **not run**)

### Risks / migration / rollback
- ...

### UI evidence (if applicable)
- ...

### Handoff questions
- ...

## Initial Project Eden work queue
Consult #5 and the **current source** before assigning work. The November 16 AZI master plan's status may be behind newer commits:
- UI layout and accessibility review, including phone and two-pane behavior.
- Code Updates resilience: retries, worktree cleanup, conflicts, baseline checks.
- Project creation and Toolbox test coverage, secrets handling, origin/path validation and real provider-key verification.

## Safety rules
- No unapproved direct changes to `main`; no automatic merging.
- Keep secrets out of issues, PRs, commits, screenshots and logs. Rotate leaked credentials.
- Avoid force pushes, destructive resets and deleting old work without owner approval.
- Do not mark checks as passing without evidence.
- For failures, preserve the reproduction steps, expected behavior, observed behavior, and commit SHA.
- If the branch moves while reviewing, recheck against its new head before approval.

## Claude kickoff
Pick one scoped issue in #5, create `claude/<topic>`, open a draft PR, and include tested behavior and known gaps. Use the PR as the point of handoff to ChatGPT for independent review.
