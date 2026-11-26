import path from 'node:path';
import { git } from './gitRun';
import { runnerHoldText } from './src/runnerHoldText';

const roots = new Map<string, { root?: string; until: number }>();

function repoTop(dir: string) {
  const cached = roots.get(dir);
  if (cached && cached.until > Date.now()) return cached.root;
  let root: string | undefined;
  try { root = git(['rev-parse', '--show-toplevel'], dir).trim() || undefined; } catch {}
  roots.set(dir, { root, until: Date.now() + 60_000 });
  return root;
}

export function sameWorkFolder(a: string, b: string, topLevel: (dir: string) => string | null | undefined = repoTop) {
  const windows = process.platform === 'win32' || [a, b].some((dir) => /^[a-z]:[\\/]|^\\\\/i.test(dir));
  const paths = windows ? path.win32 : path;
  const key = (dir: string) => windows ? paths.resolve(dir).toLowerCase() : paths.resolve(dir);
  const inside = (parent: string, child: string) => {
    const rel = paths.relative(parent, child);
    return rel !== '..' && !rel.startsWith('..' + paths.sep) && !paths.isAbsolute(rel);
  };
  if (inside(key(a), key(b)) || inside(key(b), key(a))) return true;
  const first = topLevel(paths.resolve(a));
  const second = topLevel(paths.resolve(b));
  return !!first && !!second && key(first) === key(second);
}

let lookup: ((dir: string) => string[]) | undefined;
const changes = new Set<{ dir: string; label: string }>();

export function setRunnerLookup(fn: typeof lookup) {
  lookup = fn;
}

export function runnersWorkingIn(dir: string): string[] {
  try { return lookup?.(dir) ?? []; } catch { return []; }
}

export function runnerHold(dir: string, what: Parameters<typeof runnerHoldText>[1]) {
  return runnerHoldText(runnersWorkingIn(dir), what);
}

export function applying<T>(dir: string, label: string, fn: () => T): T {
  const change = { dir, label };
  changes.add(change);
  let pending = false;
  try {
    const result = fn();
    if (result instanceof Promise) {
      pending = true;
      return result.finally(() => changes.delete(change)) as T;
    }
    return result;
  } finally {
    if (!pending) changes.delete(change);
  }
}

export function applyingIn(dir: string) {
  for (const change of changes) {
    if (sameWorkFolder(dir, change.dir)) return change.label;
  }
}
