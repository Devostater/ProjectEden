// Stops a job the hub started, with everything that job started itself.
//
// The hub runs the AI for a Code update, project tools and Terminal commands through a shell, so the real work
// (Codex, Claude, a build, a packaging script) is a child of that shell. child.kill() ends only the shell: the
// hub then said "stopped" while the work went on unseen, still spending the plan or building.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

// Every process this one started, and theirs, deepest first. Not used on Windows (taskkill does it there).
function descendants(pid: number): number[] {
  let table: string;
  try {
    table = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  } catch {
    return []; // no usable ps: the caller still ends the process itself
  }
  const startedBy = new Map<number, number[]>();
  for (const line of table.split('\n')) {
    const [id, parent] = line.trim().split(/\s+/).map(Number);
    if (id > 0 && parent > 0) startedBy.set(parent, [...(startedBy.get(parent) || []), id]);
  }
  const found: number[] = [];
  const walk = (parent: number) => {
    for (const id of startedBy.get(parent) || []) {
      walk(id);
      found.push(id);
    }
  };
  walk(pid);
  return found;
}

export function stopProcessTree(child: Pick<ChildProcess, 'pid' | 'kill'>): void {
  if (!child.pid) {
    child.kill();
    return;
  }
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    // /T takes the whole family, /F does not wait to be asked twice. If taskkill cannot run, end at least the shell.
    spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
    return;
  }
  for (const pid of descendants(child.pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {} // already gone
  }
  child.kill();
}
