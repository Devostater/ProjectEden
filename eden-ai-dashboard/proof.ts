import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stopProcessTree, wasProcessTreeStopped } from './processTree';

export interface ProofResult {
  command: string;
  ok: boolean;
  output: string;
  exitCode: number | null;
  timedOut?: boolean;
  stopped?: boolean;
  startedAt: string;
  finishedAt: string;
  head?: string;
  touches?: string[];
}

export function runProof(command: string, { cwd, minutes, onChild }: { cwd: string; minutes: number; onChild?: (child: ChildProcess) => void }): Promise<ProofResult> {
  const startedAt = new Date().toISOString();
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number | null, stopped = false) => {
      clearTimeout(timer);
      const prefix = timedOut ? `Stopped: it was still running after ${minutes} minute${minutes === 1 ? '' : 's'}.\n` : stopped ? 'Stopped before it finished.\n' : '';
      resolve({
        command, ok: exitCode === 0 && !timedOut && !stopped, exitCode, startedAt, finishedAt: new Date().toISOString(),
        output: prefix + output.slice(-(6000 - prefix.length)),
        ...(timedOut ? { timedOut: true } : stopped ? { stopped: true } : {}),
      });
    };
    const add = (chunk: string) => { output = (output + chunk).slice(-6000); };
    try {
      const child = spawn(command, { cwd, shell: true, windowsHide: true, env: { ...process.env, CI: '1', EDEN_PROOF: '1' } });
      child.stdout?.setEncoding('utf8').on('data', add);
      child.stderr?.setEncoding('utf8').on('data', add);
      child.once('error', (err) => { add(err.message); finish(null); });
      child.once('exit', () => {
        if (!wasProcessTreeStopped(child)) return;
        // A failed system kill can leave descendants holding the shell's pipes open.
        child.stdout?.destroy();
        child.stderr?.destroy();
      });
      child.once('close', (code, signal) => finish(code, wasProcessTreeStopped(child) || !!signal));
      timer = setTimeout(() => {
        if (wasProcessTreeStopped(child)) return;
        timedOut = true;
        stopProcessTree(child);
      }, minutes * 60_000);
      try {
        onChild?.(child);
      } catch (err) {
        add(String(err));
        stopProcessTree(child);
      }
    } catch (err) {
      add(String(err));
      finish(null);
    }
  });
}

const slashes = (value: string) => value.replaceAll('\\', '/');
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function proofFilesTouched(command: string, files: string[]): string[] {
  return files.filter((file) => new RegExp(`(?:^|[\\s"';&|(<>=])(?:\\./)?${escapeRegex(slashes(file))}(?=$|[\\s"';&|)<>])`, 'i').test(slashes(command)));
}

export function proofIssue({ proof, job, head }: { proof?: string; job: { proof?: ProofResult; proofRunning?: boolean; olderBase?: string }; head?: string }): string | undefined {
  if (!proof) return;
  if (job.proofRunning) return 'The proof is still running.';
  if (!job.proof) return 'This update has no proof yet. Press "Run proof".';
  if (job.proof.command !== proof) return 'The proof command changed after this proof ran. Run the proof again.';
  if (!job.proof.ok) {
    if (job.proof.stopped) return 'The proof was stopped.';
    if (job.proof.timedOut) return 'The proof ran out of time.';
    return 'The proof did not pass.';
  }
  if (job.olderBase || !head || head !== job.proof.head) return 'The code changed after this proof ran. Run the proof again.';
}

export interface PackageState {
  state: 'fresh' | 'older' | 'missing';
  file?: string;
  newer?: string;
}

export function packageState({
  dir, pattern, sourceFiles,
  readFiles = (folder: string) => fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name),
  fileTime = (file: string) => {
    try {
      const stat = fs.statSync(file);
      return stat.isFile() ? stat.mtimeMs : undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  },
}: { dir: string; pattern: string; sourceFiles: string[]; readFiles?: (dir: string) => string[]; fileTime?: (file: string) => number | undefined }): PackageState {
  const normalized = slashes(pattern);
  const folder = path.posix.dirname(normalized);
  const name = path.posix.basename(normalized);
  const matches = new RegExp(`^${name.split('*').map(escapeRegex).join('.*')}$`, process.platform === 'win32' ? 'i' : '');
  let candidates: string[];
  try {
    candidates = name.includes('*') ? readFiles(path.join(dir, folder)).filter((file) => matches.test(file)) : [name];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return { state: 'missing' };
  }
  const packages = new Set(candidates.map((file) => path.posix.join(folder, file)));
  const key = (file: string) => process.platform === 'win32' ? file.toLowerCase() : file;
  const packageKeys = new Set([...packages].map(key));
  let oldest: { file: string; time: number } | undefined;
  for (const file of packages) {
    const time = fileTime(path.join(dir, file));
    if (time !== undefined && (!oldest || time < oldest.time)) oldest = { file, time };
  }
  if (!oldest) return { state: 'missing' };
  for (const source of sourceFiles) {
    const file = slashes(source);
    if (packageKeys.has(key(file))) continue;
    const time = fileTime(path.join(dir, file));
    if (time !== undefined && time > oldest.time) return { state: 'older', file: oldest.file, newer: source };
  }
  return { state: 'fresh', file: oldest.file };
}
