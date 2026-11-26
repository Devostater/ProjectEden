export type CodeAI = 'claude' | 'codex';
type CodebaseSettings = { ai?: CodeAI; unreal?: boolean };

export function codebaseAI(cb: { ai?: unknown }): CodeAI {
  return cb.ai === 'codex' ? 'codex' : 'claude';
}

export function readSettings(input: unknown): CodebaseSettings {
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
