import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import type { Express } from 'express';
import { fromOwnPage, isLocal } from './server/localRequest';
import { applyingIn, sameWorkFolder } from './oneWriter';

interface Runner {
  id: string;
  name: string;
  cwd: string;
  command: string;
  tasksFile?: string;
  logFile?: string;
  lockFile?: string;
  needsClosed?: string[];
  args?: 'issueNumbers';
}

interface RunState {
  state: 'Running' | 'Stopped' | 'Exited' | 'Stopped by restart' | 'Failed';
  startedAt?: string;
  exitCode?: number | null;
  error?: string;
}

export function readProgress(markdown: string) {
  const tasks = [...markdown.matchAll(/^\s*- \[([ xX!])\][ \t]+(.+?)\s*$/gm)];
  const currentIndex = tasks.findIndex((task) => task[1].toLowerCase() !== 'x');
  const title = tasks[currentIndex]?.[2].replace(/\*\*|\x60/g, '') || '';
  const taskId = title.match(/^([A-Za-z]+-?\d+|\d+)(?=[:.)\s]|$)/)?.[1];
  return {
    done: tasks.filter((task) => task[1].toLowerCase() === 'x').length,
    total: tasks.length,
    current: title ? {
      index: currentIndex + 1,
      id: taskId,
      text: (taskId ? title.slice(taskId.length).replace(/^[:.)\s-]+/, '') : title).slice(0, 80),
    } : undefined,
  };
}

function expand(value: string) {
  return value.replace(/%([\w]+)%/g, (token, key) => process.env[key] ?? token);
}

function readJson(file: string, fallback: unknown) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

function logTail(file: string) {
  let fd: number;
  try { fd = fs.openSync(file, 'r'); } catch { return ''; }
  try {
    const chunks: Buffer[] = [];
    let position = fs.fstatSync(fd).size;
    let newlines = 0;
    while (position > 0 && newlines <= 40) {
      const size = Math.min(position, 8192);
      position -= size;
      const chunk = Buffer.alloc(size);
      const read = fs.readSync(fd, chunk, 0, size, position);
      const bytes = chunk.subarray(0, read);
      chunks.unshift(bytes);
      for (const byte of bytes) if (byte === 10) newlines++;
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/).slice(-40).join('\n');
  } finally {
    fs.closeSync(fd);
  }
}

const windows = process.platform === 'win32';
const systemTools = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const taskkill = path.join(systemTools, 'taskkill.exe');

// IPC closes even if the hub is forcibly terminated. The hidden wrapper then
// cleans up its command without the next hub having to trust an old PID.
const watchHub = `
const { spawn, execFileSync } = require('node:child_process');
const child = spawn(process.argv[1], { shell: true, windowsHide: true, stdio: 'inherit' });
process.once('disconnect', () => {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync(process.argv[2], ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } catch (err) {
      console.error(err.message);
    }
  } else {
    process.kill(-process.pid, 'SIGKILL');
  }
});
child.once('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
child.once('exit', (code) => process.exit(code ?? 1));
`;

function processNames() {
  const output = windows
    ? execFileSync(path.join(systemTools, 'tasklist.exe'), ['/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' })
    : execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' });
  return output.split(/\r?\n/).map((line) => (windows ? line.match(/^"([^"]*)"/)?.[1] || '' : path.basename(line.trim())).toLowerCase());
}

function killTree(pid: number) {
  if (windows) {
    execFileSync(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' });
  } else {
    process.kill(-pid, 'SIGKILL');
  }
}

function lockProcessExists(pid: number, image?: string) {
  try {
    if (windows && image) {
      const output = execFileSync(path.join(systemTools, 'tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true, encoding: 'utf8',
      });
      return output.split(/\r?\n/).some((line) => {
        const fields = line.match(/^"([^"]*)","(\d+)"/);
        return fields && Number(fields[2]) === pid && fields[1].toLowerCase() === image.toLowerCase();
      });
    }
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function createRunners(appDir: string, deps: {
  spawn: typeof spawn; processNames: typeof processNames; killTree: typeof killTree; lockProcessExists?: typeof lockProcessExists;
} = { spawn, processNames, killTree }) {
  const registry = path.join(appDir, '.eden-runners.json');
  const logDir = path.join(appDir, '.eden-logs', 'runners');
  const stateFile = path.join(logDir, 'state.json');
  const states = new Map<string, RunState>(Object.entries(readJson(stateFile, {})));
  const active = new Map<string, ChildProcess>();
  const stopping = new Set<string>();
  const locks = new Map<string, { pid: number; image?: string; live: boolean; until: number }>();
  const workDir = (runner: Runner) => path.resolve(appDir, expand(runner.cwd));

  function liveLock(runner: Runner, cwd = workDir(runner)) {
    if (!runner.lockFile) return false;
    const file = path.resolve(cwd, expand(runner.lockFile));
    let live = false;
    try {
      const lock = readJson(file, null);
      if (!Number.isSafeInteger(lock?.pid) || lock.pid <= 0 || lock.pid > 2147483647) return false;
      const image = typeof lock.image === 'string' ? lock.image : undefined;
      const cached = locks.get(file);
      if (cached && cached.until > Date.now() && cached.pid === lock.pid && cached.image === image) return cached.live;
      live = (deps.lockProcessExists ?? lockProcessExists)(lock.pid, image);
      locks.set(file, { live, until: Date.now() + 10_000, pid: lock.pid, image });
    } catch {}
    return live;
  }

  function save() {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(Object.fromEntries(states)));
    fs.renameSync(stateFile + '.tmp', stateFile);
  }

  function load(): { runners: Runner[]; maxRunners: number } {
    const { runners = [], maxRunners = 3 } = readJson(registry, {});
    if (!Array.isArray(runners) || !Number.isSafeInteger(maxRunners) || maxRunners < 1 || maxRunners > 3) {
      throw new Error('Invalid runners registry or maxRunners setting.');
    }
    const ids = new Set<string>();
    for (const runner of runners) {
      if (!runner || typeof runner.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(runner.id) ||
          ids.has(runner.id) || !['name', 'cwd', 'command'].every((key) => typeof runner[key] === 'string' && runner[key].trim()) ||
          !['tasksFile', 'logFile', 'lockFile'].every((key) => runner[key] === undefined || typeof runner[key] === 'string') ||
          (runner.args !== undefined && runner.args !== 'issueNumbers') ||
          (runner.needsClosed !== undefined && (!Array.isArray(runner.needsClosed) ||
            !runner.needsClosed.every((name: unknown) => typeof name === 'string' && name.trim())))) {
        throw new Error('Invalid runner entry in .eden-runners.json.');
      }
      ids.add(runner.id);
    }
    return { runners, maxRunners };
  }

  function captureFile(id: string) {
    return path.join(logDir, id + '.log');
  }

  function status(logId: unknown) {
    const { runners } = load();
    const rows = runners.map((runner) => {
      const { id, name, args, tasksFile, logFile } = runner;
      const cwd = workDir(runner);
      const outside = !active.has(id) && liveLock(runner, cwd);
      let progress: ReturnType<typeof readProgress> | undefined;
      if (tasksFile) {
        try { progress = readProgress(fs.readFileSync(path.resolve(cwd, expand(tasksFile)), 'utf8')); } catch {}
      }
      return {
        id, name, args, progress, ...(outside ? undefined : states.get(id)),
        state: outside ? 'Running outside the hub' : stopping.has(id) ? 'Stopping' : states.get(id)?.state ?? 'Stopped',
        ...(id === logId ? {
          log: logTail(captureFile(id)),
          projectLog: logFile ? logTail(path.resolve(cwd, expand(logFile))) : undefined,
        } : {}),
      };
    });
    return { running: active.size + rows.filter((row) => row.state === 'Running outside the hub').length, runners: rows };
  }

  function start(id: string, args: unknown) {
    const { runners, maxRunners } = load();
    const runner = runners.find((entry) => entry.id === id);
    if (!runner) throw new Error('Runner not found.');
    if (active.has(id)) throw new Error('This runner is already running.');
    const cwd = workDir(runner);
    const label = applyingIn(cwd);
    if (label !== undefined) throw new Error(`Wait: the hub is changing this folder right now (${label}). Start ${runner.name} when it is done.`);
    if (liveLock(runner, cwd)) throw new Error(`${runner.name} is already running outside the hub. Stop it where it was started.`);
    if (active.size >= maxRunners) throw new Error(`Only ${maxRunners} runners can run at once.`);
    const working = workingIn(cwd);
    if (working.length) throw new Error(`Wait for ${working.join(', ')} to finish working in this folder before starting ${runner.name}.`);
    if (runner.needsClosed?.length) {
      const running = new Set(deps.processNames());
      const blocked = runner.needsClosed.find((name) => running.has(name.trim().toLowerCase()));
      if (blocked) throw new Error(`Close ${blocked} before starting ${runner.name}.`);
    }
    let command = runner.command;
    if (args !== undefined && args !== '') {
      if (runner.args !== 'issueNumbers' || typeof args !== 'string' || !/^\d+(?:[ ,]+\d+)*$/.test(args.trim()) || args.length > 200) {
        throw new Error('Enter issue numbers separated by spaces or commas.');
      }
      command += ' ' + args.trim().split(/[ ,]+/).join(' ');
    }

    const startedAt = new Date().toISOString();
    states.set(id, { state: 'Running', startedAt });
    try {
      save();
      const fd = fs.openSync(captureFile(id), 'a');
      try {
        fs.writeSync(fd, `\n--- Started ${startedAt} ---\n`);
        const child = deps.spawn(process.execPath, ['-e', watchHub, '--', command, taskkill], {
          cwd, windowsHide: true,
          detached: !windows, stdio: ['ignore', fd, fd, 'ipc'],
        });
        active.set(id, child);
        child.once('error', (err) => finish(id, child, { state: 'Failed', error: err.message }));
        child.once('exit', (exitCode) => finish(id, child, { state: stopping.has(id) ? 'Stopped' : 'Exited', exitCode }));
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      states.set(id, { state: 'Failed', startedAt, error: (err as Error).message });
      save();
      throw err;
    }
  }

  function finish(id: string, child: ChildProcess, result: RunState) {
    if (active.get(id) !== child) return;
    active.delete(id);
    stopping.delete(id);
    states.set(id, { startedAt: states.get(id)?.startedAt, ...result });
    try { save(); } catch (err) { console.error('Could not save runner state:', err); }
  }

  function stop(id: string) {
    if (stopping.has(id)) return;
    const child = active.get(id);
    if (!child) {
      const runner = load().runners.find((entry) => entry.id === id);
      if (runner && liveLock(runner)) throw new Error(`${runner.name} was started outside the hub. Stop it where it was started.`);
    }
    if (!child?.pid) throw new Error('This runner has no running process.');
    deps.killTree(child.pid);
    stopping.add(id);
  }

  for (const state of states.values()) {
    if (state.state === 'Running') state.state = 'Stopped by restart';
  }

  // The names of the runners going right now. The hub lists them before a restart, because a restart stops them.
  function runningNames() {
    let names = new Map<string, string>();
    try {
      names = new Map(load().runners.map((runner) => [runner.id, runner.name]));
    } catch {}
    return [...active.keys()].map((id) => names.get(id) || id);
  }

  function workingIn(dir: string) {
    return load().runners
      .filter((runner) => {
        const cwd = workDir(runner);
        // Working first (cheap), the folder second: comparing folders can ask git.
        return (active.has(runner.id) || liveLock(runner, cwd)) && sameWorkFolder(dir, cwd);
      })
      .map((runner) => runner.name);
  }

  return {
    status, start, stop, runningNames, workingIn,
    shutdown() {
      for (const [id, child] of active) {
        if (!child.pid) continue;
        try {
          deps.killTree(child.pid);
          finish(id, child, { state: 'Stopped by restart' });
        } catch (err) {
          console.error(`Could not stop runner ${id}:`, err);
        }
      }
    },
  };
}

export function registerRunnerRoutes(app: Express, runners: ReturnType<typeof createRunners>) {
  app.post('/api/runners/:action', (req, res) => {
    if (!isLocal(req) || !fromOwnPage(req)) {
      return res.status(403).json({ error: 'Runners are only available from the hub on this computer.' });
    }
    try {
      const { action } = req.params;
      const { id, args, logId } = req.body || {};
      if (action === 'status') return res.json(runners.status(logId));
      if (typeof id !== 'string') return res.status(400).json({ error: 'Choose a runner.' });
      if (action === 'start') runners.start(id, args);
      else if (action === 'stop') runners.stop(id);
      else return res.status(404).json({ error: 'Unknown runner action.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}
