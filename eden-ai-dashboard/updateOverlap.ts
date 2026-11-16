// Overlapping code updates. Each update is made on its own copy of the code, so after one finished update is
// applied (or undone), every other finished update waiting to be applied was checked against code that has
// since changed: its patch may no longer fit, and even if it fits, a change elsewhere (a shared type, an export,
// a config file) can break it. This finds that right away, instead of only when the owner presses Apply.

export interface OverlapJob {
  id: string;
  codebaseId: string;
  status: string;
  diff?: string;
  stale?: boolean;
  baseApplied?: string[]; // ids of this codebase's applied updates when this update's copy was made
}

// Git writes a path in quotes, with C-style escapes, when it has quotes, backslashes, control characters or
// (by default) non-ASCII letters, e.g. "a/caf\303\251.ts". This turns it back into text.
function unquote(p: string): string {
  if (!p.startsWith('"')) return p;
  const bytes: number[] = [];
  const body = p.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf-8'));
      continue;
    }
    const n = body[++i];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(({ n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7 } as Record<string, number>)[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf-8');
}

// The files a git patch touches (old and new names, without the a/ and b/ prefixes). Git puts a path in quotes
// only when it has special characters; a plain space is not quoted, so `diff --git a/my file.ts b/my file.ts` is
// read as the same name twice when it splits evenly, and renames also use their rename from/to lines.
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`;
const BOTH_QUOTED = new RegExp(`^(${QUOTED}) (${QUOTED})$`);
const FIRST_QUOTED = new RegExp(`^(${QUOTED}) (\\S.*)$`);
const SECOND_QUOTED = new RegExp(`^(.*?) (${QUOTED})$`);

export function filesInDiff(diff: string): string[] {
  const files = new Set<string>();
  const strip = (p: string) => unquote(p).replace(/^[ab]\//, '');
  for (const line of diff.split(/\r?\n/)) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^rename (?:from|to) (.+)$/))) files.add(unquote(m[1]));
    if (!line.startsWith('diff --git ')) continue;
    const rest = line.slice('diff --git '.length);
    if ((m = rest.match(BOTH_QUOTED)) || (m = rest.match(FIRST_QUOTED)) || (m = rest.match(SECOND_QUOTED))) {
      files.add(strip(m[1]));
      files.add(strip(m[2]));
      continue;
    }
    const half = (rest.length - 1) / 2; // `a/X b/X`: the same name twice
    if (Number.isInteger(half) && rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) {
      files.add(rest.slice(2, half));
      continue;
    }
    const cut = rest.indexOf(' b/'); // different names (a rename): the rename lines give the exact names too
    if (cut > 0) {
      files.add(strip(rest.slice(0, cut)));
      files.add(strip(rest.slice(cut + 1)));
    }
  }
  return [...files];
}

export interface RecheckResult {
  stale: string[]; // newly no longer fit the code: they need to be made again
  refit: string[]; // were marked stale but fit again (e.g. the update that blocked them was undone)
  current: string[]; // fit, and the applied updates are again exactly the ones they were checked with: their checks count again
  recheck: { id: string; sameFiles: boolean }[]; // fit, but their checks ran on other code; sameFiles = they change a file the applied/undone update changed
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// After `changed` was applied or undone: looks at every other finished update of the same codebase that is
// waiting to be applied, including ones already marked stale (an Undo can make them fit again).
// `fits` says whether a patch still applies to the code as it is now (git apply --check).
// `appliedNow` lists this codebase's applied updates after the change; an update whose baseApplied matches it
// was checked on the same set of applied updates (e.g. A applied then undone), so its checks count again.
export function recheckWaiting(jobs: OverlapJob[], changed: OverlapJob, fits: (diff: string) => boolean, appliedNow?: string[]): RecheckResult {
  const touched = new Set(filesInDiff(changed.diff || ''));
  const out: RecheckResult = { stale: [], refit: [], current: [], recheck: [] };
  for (const j of jobs) {
    if (j === changed || j.codebaseId !== changed.codebaseId || !j.diff) continue;
    if (j.status !== 'ready' && j.status !== 'undone') continue;
    if (!fits(j.diff)) {
      if (!j.stale) out.stale.push(j.id);
      continue;
    }
    if (j.stale) out.refit.push(j.id);
    if (appliedNow && j.baseApplied && sameSet(j.baseApplied, appliedNow)) out.current.push(j.id);
    else out.recheck.push({ id: j.id, sameFiles: filesInDiff(j.diff).some((f) => touched.has(f)) });
  }
  return out;
}
