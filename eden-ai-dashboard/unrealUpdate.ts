import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_UNREAL_ENGINE_DIR = String.raw`C:\Unreal Engine 5\UE_5.8`;
export type UnrealToolsStatus = 'look' | 'change' | 'closed' | 'missing';

export function unrealAnswerStatus(job: { unrealTools?: UnrealToolsStatus; summary?: string; files?: readonly unknown[] }): 'answered' | undefined {
  if ((job.unrealTools === 'look' || job.unrealTools === 'change') && job.summary?.trim() && !job.files?.length) {
    return 'answered';
  }
}

function editorRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq UnrealEditor.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 5000 }, (error, stdout) =>
        resolve(!error && /^"UnrealEditor\.exe",/im.test(stdout)));
  });
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export async function unrealUpdate(
  unreal: unknown, allowChange: unknown,
  { running = editorRunning, fileExists = isFile, engineDir = process.env.unrealEngineDir || DEFAULT_UNREAL_ENGINE_DIR } = {},
): Promise<{ status?: UnrealToolsStatus; args: string[]; prompt: string }> {
  if (unreal !== true) return { args: [], prompt: '' };
  const canChange = allowChange === true;
  const rules = [
    'Unreal editor tools (only while the owner has UE 5.8 open):',
    'Aura connects directly to the open project. Use the inspector for inspection. Use the editor tool to change the project only when the owner enabled changes for this job and the task calls for them.',
    'Without that per-job permission, keep the open project unchanged through every tool, including Ludus.',
    'Use Ludus only when the task names Ludus. It works through a relay, costs the owner credits and can take minutes.',
    'Never save, delete or rename assets unless the task says so and the owner enabled changes for this job.',
    'Never add Aura or Ludus as a dependency of a shipping plugin, including LevelGen and LevelGenPCG.',
    'Say in your report which editor tools you called.',
  ].join('\n');
  const off = (status: 'closed' | 'missing') => ({
    status, args: [], prompt: `${rules}\nAura is unavailable for this run. Keep the open project untouched.`,
  });
  if (!(await running())) return off('closed');
  const auraDir = path.join(engineDir, 'Engine', 'Plugins', 'Marketplace', 'Aura');
  const python = path.join(auraDir, 'PortablePython', 'Windows', 'python.exe');
  const script = path.join(auraDir, 'MCP', canChange ? 'unreal_editor.py' : 'unreal_inspector.py');
  // On Windows the npm CLI shim runs through cmd. Keep the TOML literals safe to pass through it.
  if (/[%!"'\r\n]/.test(auraDir) || !fileExists(python) || !fileExists(script)) return off('missing');
  return {
    status: canChange ? 'change' : 'look',
    args: ['-c', `mcp_servers.aura.command='${python}'`, '-c', `mcp_servers.aura.args=['${script}']`, '--approve-for-me'],
    prompt: `${rules}\nAura is enabled in ${canChange ? 'editor' : 'inspector (look only)'} mode for this run.`,
  };
}

// `codex exec` refuses --sandbox together with --approve-for-me (which already uses the workspace-write sandbox).
export function codexExecArgs(unrealArgs: string[] = []): string[] {
  const sandbox = unrealArgs.includes('--approve-for-me') ? [] : ['--sandbox', 'workspace-write'];
  return ['exec', '--json', ...sandbox, ...unrealArgs, '-'];
}
