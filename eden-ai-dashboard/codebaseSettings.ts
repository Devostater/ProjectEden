export type CodeAI = 'claude' | 'codex';
export const DEFAULT_PROOF_MINUTES = 30;
export type CodebaseSettings = { ai?: CodeAI; unreal?: boolean; proof?: string; proofMinutes?: number; packageFiles?: string; packageFrom?: string };

export function codebaseAI(cb: { ai?: unknown }): CodeAI {
  return cb.ai === 'codex' ? 'codex' : 'claude';
}

export function readSettings(input: unknown, id?: string): CodebaseSettings {
  if (!input || typeof input !== 'object') return {};
  const settings: CodebaseSettings = {};
  if ('ai' in input) {
    if (input.ai !== 'claude' && input.ai !== 'codex') throw new Error('Choose Claude or Codex for code changes.');
    settings.ai = input.ai;
  }
  if ('unreal' in input) {
    if (typeof input.unreal !== 'boolean') throw new Error('The Unreal project setting must be on or off.');
    settings.unreal = input.unreal;
  }
  if ('proof' in input) {
    if (typeof input.proof !== 'string' || /[\r\n\0\u2028\u2029]/.test(input.proof) || input.proof.trim().length > 500) {
      throw new Error('Enter a proof command on one line, up to 500 characters.');
    }
    settings.proof = input.proof.trim() || undefined;
    if (id === 'hub' && settings.proof) throw new Error('The hub uses its type check, tests and build as its proof.');
  }
  if ('proofMinutes' in input) {
    if (input.proofMinutes === '') settings.proofMinutes = undefined;
    else if (typeof input.proofMinutes === 'number' && Number.isInteger(input.proofMinutes) && input.proofMinutes >= 1 && input.proofMinutes <= 240) {
      settings.proofMinutes = input.proofMinutes;
    } else throw new Error('Enter a time limit from 1 to 240 whole minutes.');
  }
  if ('packageFiles' in input) {
    const value = typeof input.packageFiles === 'string' ? input.packageFiles.trim() : null;
    if (value === null || value.length > 200 || /[<>:"?|\x00-\x1f]|\.\./.test(value) || /^[\\/]|[\\/]$/.test(value) || /\*.*[\\/]|\*.*\*/.test(value)) {
      throw new Error('Enter an upload package path within this folder, up to 200 characters, with at most one * in the file name.');
    }
    settings.packageFiles = value || undefined;
  }
  // The folder the package is made from. Only its files count as "the source" for the package's age: without it
  // a ticked task list or an edited README would make a fresh package look old.
  if ('packageFrom' in input) {
    const value = typeof input.packageFrom === 'string' ? input.packageFrom.trim() : null;
    if (value === null || value.length > 200 || /[<>:"?|*\x00-\x1f]|\.\./.test(value) || /^[\\/]|[\\/]$/.test(value)) {
      throw new Error('Enter the folder the package is made from, within this folder, up to 200 characters.');
    }
    settings.packageFrom = value || undefined;
  }
  return settings;
}

// Sets who does a job from the codebase's setting as it is now. Used again when a job starts, so an update that
// waited in the queue follows a setting that was changed meanwhile (and never runs on Claude for a Codex codebase).
export function followCodebaseAI(job: { codex?: boolean; local?: boolean; allowUnrealChanges?: boolean }, cb: { ai?: unknown; unreal?: unknown }) {
  if (codebaseAI(cb) === 'codex') {
    job.codex = true;
    delete job.local;
    if (cb.unreal !== true) delete job.allowUnrealChanges;
  } else {
    delete job.codex;
    delete job.allowUnrealChanges;
  }
}

export function notSignedIn(ai: CodeAI): string {
  return ai === 'codex'
    ? 'ChatGPT is not signed in, so Codex cannot make this change. Sign in to ChatGPT in Account → Connections first. It was not given to Claude.'
    : 'Code updates use Claude Code. Sign in to Claude in Account → Connections first.';
}

// Older hubs ignore this entry, but still need its folder to read the file.
export function savedHubSettings(hub: { id: string; dir: string } & CodebaseSettings) {
  return {
    id: hub.id,
    dir: hub.dir,
    ...(codebaseAI(hub) === 'codex' ? { ai: 'codex' as const } : {}),
    ...(hub.unreal === true ? { unreal: true } : {}),
  };
}

export function restoreHubSettings<T extends { id: string; dir: string } & CodebaseSettings>(hub: T, saved?: { ai?: unknown; unreal?: unknown }) {
  return {
    ...hub,
    ...(saved?.ai === 'codex' ? { ai: 'codex' as const } : {}),
    ...(saved?.unreal === true ? { unreal: true } : {}),
  };
}
