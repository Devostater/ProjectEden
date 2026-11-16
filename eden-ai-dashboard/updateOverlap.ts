// Overlapping code updates. Each update is made on its own copy of the code, so two finished updates can both
// change the same file. Once one of them is applied (or undone), the others may no longer fit, or may still fit
// but have had their checks run on code that no longer exists. This finds both cases right away, instead of
// only when the owner presses Apply on the next one.

export interface OverlapJob {
  id: string;
  codebaseId: string;
  status: string;
  diff?: string;
  stale?: boolean;
  olderBase?: string;
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
  stale: string[]; // no longer fit the code: they need to be made again
  olderBase: string[]; // still fit, but changed the same files, so their checks ran on the older code
}

// After `changed` was applied or undone: looks at every other finished update of the same codebase that is
// waiting to be applied. `fits` says whether a patch still applies to the code as it is now (git apply --check).
export function recheckWaiting(jobs: OverlapJob[], changed: OverlapJob, fits: (diff: string) => boolean): RecheckResult {
  const touched = new Set(filesInDiff(changed.diff || ''));
  const out: RecheckResult = { stale: [], olderBase: [] };
  for (const j of jobs) {
    if (j === changed || j.codebaseId !== changed.codebaseId || !j.diff || j.stale) continue;
    if (j.status !== 'ready' && j.status !== 'undone') continue;
    if (!fits(j.diff)) out.stale.push(j.id);
    else if (filesInDiff(j.diff).some((f) => touched.has(f))) out.olderBase.push(j.id);
  }
  return out;
}
