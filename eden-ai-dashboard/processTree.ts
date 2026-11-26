// Stops a job the hub started, with everything that job started itself.
//
// The hub runs the AI for a Code update, project tools and Terminal commands through a shell, so the real work
// (Codex, Claude, a build, a packaging script) is a child of that shell. On Windows, child.kill() ends only the
// shell: the hub then said "stopped" while the work went on unseen, still spending the plan or building.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export function stopProcessTree(child: Pick<ChildProcess, 'pid' | 'kill'>): void {
  if (process.platform !== 'win32' || !child.pid) {
    child.kill();
    return;
  }
  const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  // /T takes the whole family, /F does not wait to be asked twice. If taskkill cannot run, end at least the shell.
  spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
}
