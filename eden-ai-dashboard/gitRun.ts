// Runs git for Code updates and gives back what it printed. A git error becomes a short message.
import { spawnSync } from 'child_process';

// Git on Windows stops at 260-character paths unless core.longpaths is on. The working copy of an update
// lives in a longer folder than the codebase itself (%USERPROFILE%\.eden-hub\updates\<id>), so a path that is
// fine in the project could fail there ("Filename too long"), or be left out with only a warning and then show
// up as a change the AI made. Deep folders are normal in Unreal projects. On other systems this does nothing.
const ALWAYS = ['-c', 'core.longpaths=true'];

export function git(args: string[], cwd: string, input?: string, env?: NodeJS.ProcessEnv): string {
  const r = spawnSync('git', [...ALWAYS, ...args], { cwd, encoding: 'utf-8', input, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim().split('\n').slice(-3).join(' '));
  return r.stdout;
}
