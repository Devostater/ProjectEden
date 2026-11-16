// Overlapping code updates. Each update is made on its own copy of the code, so after one finished update is
// applied (or undone), every other finished update waiting to be applied was checked against code that no
// longer exists: its patch may no longer fit, and even if it fits, a change elsewhere (a shared type, an export,
// a config file) can break it. This finds that right away, instead of only when the owner presses Apply.

export interface OverlapJob {
  id: string;
  codebaseId: string;
  status: string;
  diff?: string;
  stale?: boolean;
}

// The files a git patch touches (old and new names, without the a/ and b/ prefixes).
export function filesInDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    files.add(m[1]);
    files.add(m[2]);
  }
  return [...files];
}

export interface RecheckResult {
  stale: string[]; // newly no longer fit the code: they need to be made again
  refit: string[]; // were marked stale but fit again (e.g. the update that blocked them was undone)
  recheck: { id: string; sameFiles: boolean }[]; // fit, but their checks ran on older code; sameFiles = they change a file the applied/undone update changed
}

// After `changed` was applied or undone: looks at every other finished update of the same codebase that is
// waiting to be applied, including ones already marked stale (an Undo can make them fit again).
// `fits` says whether a patch still applies to the code as it is now (git apply --check).
export function recheckWaiting(jobs: OverlapJob[], changed: OverlapJob, fits: (diff: string) => boolean): RecheckResult {
  const touched = new Set(filesInDiff(changed.diff || ''));
  const out: RecheckResult = { stale: [], refit: [], recheck: [] };
  for (const j of jobs) {
    if (j === changed || j.codebaseId !== changed.codebaseId || !j.diff) continue;
    if (j.status !== 'ready' && j.status !== 'undone') continue;
    if (!fits(j.diff)) {
      if (!j.stale) out.stale.push(j.id);
      continue;
    }
    if (j.stale) out.refit.push(j.id);
    out.recheck.push({ id: j.id, sameFiles: filesInDiff(j.diff).some((f) => touched.has(f)) });
  }
  return out;
}
