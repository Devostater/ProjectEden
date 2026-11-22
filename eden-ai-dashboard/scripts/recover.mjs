import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findBuild, hasBuild } from './build-paths.mjs';

const POINT = '.eden-offline-restore';
export const RECOVERY_LOCK = '.eden-recovery.pid';
const STORE = '.eden-updates.json';

function entry(file) {
  return fs.lstatSync(file, { throwIfNoEntry: false });
}

function sourcePath(app, relative) {
  const parts = relative.split('/');
  const protectedFiles = ['recover eden.bat', 'scripts/recover.mjs', 'scripts/build-paths.mjs'];
  if (protectedFiles.includes(relative.toLowerCase()) || parts.some(part =>
    !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part) || /[. ]$/.test(part) ||
    /^(?:\.git|\.env|\.eden-|\.nexusflow-store|node_modules$|dist$)/i.test(part) ||
    /^(?:keystore\.properties)$/i.test(part) || /\.(?:pem|key|pfx|p12|keystore|jks)$/i.test(part))) {
    throw new Error('The update includes a path that offline recovery cannot safely restore.');
  }
  let target = app;
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    const stat = entry(target);
    if (stat && !(index === parts.length - 1 ? stat.isFile() : stat.isDirectory())) {
      throw new Error(`Expected a regular source file at ${relative}.`);
    }
  }
  return target;
}

function fingerprint(file) {
  const stat = entry(file);
  if (!stat) return null;
  if (!stat.isFile()) throw new Error('A recovery file is not a regular file.');
  return { hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mode: stat.mode & 0o777 };
}

function buildHash(directory) {
  if (!entry(directory)?.isDirectory() || !hasBuild(directory)) throw new Error('The recovery build is incomplete.');
  const hash = createHash('sha256');
  function walk(relative) {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      const child = path.join(relative, name);
      const full = path.join(directory, child);
      if (entry(full).isDirectory()) walk(child);
      else hash.update(JSON.stringify([child, fingerprint(full)]));
    }
  }
  walk('');
  return hash.digest('hex');
}

function same(left, right) {
  return left?.hash === right?.hash && left?.mode === right?.mode;
}

function copyFile(from, to, mode) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const temp = `${to}.eden-temp-${randomUUID()}`;
  try {
    fs.copyFileSync(from, temp);
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, to);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function putFiles(files, snapshots, key) {
  for (const [index, file] of files.entries()) {
    if (file[key]) copyFile(path.join(snapshots, String(index)), file.target, file[key].mode);
    else fs.rmSync(file.target, { force: true });
  }
}

// Save the bytes visible before Apply and record the exact bytes Apply left behind.
export function applyWithRecovery(app, id, commit, paths, apply) {
  const build = findBuild(app);
  if (!build) throw new Error('Build EDEN in production mode before applying a hub update.');
  const point = path.join(app, POINT);
  const stage = fs.mkdtempSync(path.join(app, '.eden-restore-stage-'));
  const previous = `${stage}-previous`;
  try {
    const files = paths.map(relative => {
      const target = sourcePath(app, relative);
      return { relative, target, before: fingerprint(target) };
    });
    fs.mkdirSync(path.join(stage, 'source'));
    for (const [index, file] of files.entries()) {
      if (file.before) fs.copyFileSync(file.target, path.join(stage, 'source', String(index)));
    }
    fs.cpSync(build, path.join(stage, 'build'), { recursive: true, verbatimSymlinks: true });
    const buildDigest = buildHash(path.join(stage, 'build'));
    apply();
    try {
      const records = files.map(({ relative, target, before }) =>
        ({ relative, before, after: fingerprint(sourcePath(app, relative)) }));
      fs.writeFileSync(path.join(stage, 'point.json'), JSON.stringify({ id, commit, buildDigest, files: records }));
      if (entry(point)) fs.renameSync(point, previous);
      try {
        fs.renameSync(stage, point);
      } catch (error) {
        if (entry(previous)) fs.renameSync(previous, point);
        throw error;
      }
    } catch (error) {
      putFiles(files, path.join(stage, 'source'), 'before');
      throw error;
    }
    try {
      fs.rmSync(previous, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove the previous offline recovery copy at ${previous}: ${error.message}`);
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

export function livePid(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); } catch (error) { return error.code !== 'ESRCH'; }
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

function portInUse(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve(false) : reject(error));
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Could not check whether EDEN is closed.')); });
  });
}

export async function recover(app, { force = false, port = Number(process.env.PORT) || 3000 } = {}) {
  const lock = path.join(app, RECOVERY_LOCK);
  if (entry(lock) && !livePid(lock) && fs.readFileSync(lock, 'utf8').trim()) fs.unlinkSync(lock);
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    if (livePid(path.join(app, '.eden-logs', 'supervisor.pid')) || await portInUse(port)) {
      throw new Error('Close EDEN and its supervisor window before running recovery.');
    }
    const store = path.join(app, STORE);
    if (!entry(store)) throw new Error('No EDEN update history was found in this dashboard folder.');
    const jobs = JSON.parse(fs.readFileSync(store, 'utf8'));
    const latest = jobs.filter(job => (job.codebaseId || 'hub') === 'hub' && job.status === 'applied')
      .sort((a, b) => (b.restore?.at || '').localeCompare(a.restore?.at || ''))[0];
    const point = path.join(app, POINT);
    if (!latest?.restore || !entry(path.join(point, 'point.json'))) {
      throw new Error('There is no applied hub update with a saved offline recovery point.');
    }
    const saved = JSON.parse(fs.readFileSync(path.join(point, 'point.json'), 'utf8'));
    if (saved.id !== latest.id || saved.commit !== latest.restore.commit) {
      throw new Error('The latest applied update has no matching offline recovery point and build.');
    }
    if (buildHash(path.join(point, 'build')) !== saved.buildDigest) {
      throw new Error('The matching offline recovery build is damaged.');
    }
    const source = path.join(point, 'source');
    const files = saved.files.map((file, index) => {
      const target = sourcePath(app, file.relative);
      const current = fingerprint(target);
      if (!same(fingerprint(path.join(source, String(index))), file.before)) {
        throw new Error(`The recovery copy of ${file.relative} is damaged.`);
      }
      if (!force && !same(current, file.after)) {
        throw new Error(`${file.relative} has changed since Apply. Review the edit before rerunning with --force.`);
      }
      return { ...file, target, current };
    });
    const stage = fs.mkdtempSync(path.join(app, '.eden-recover-stage-'));
    const dist = path.join(app, 'dist');
    const oldBuild = path.join(stage, 'previous-dist');
    let buildInstalled = false;
    let keepStage = false;
    try {
      const nextBuild = path.join(stage, 'build');
      fs.cpSync(path.join(point, 'build'), nextBuild, { recursive: true, verbatimSymlinks: true });
      for (const [index, file] of files.entries()) {
        if (file.current) fs.copyFileSync(file.target, path.join(stage, String(index)));
      }
      latest.status = 'undone';
      latest.log = [...(latest.log || []), 'Restored offline with Recover Eden.'];
      const nextStore = path.join(stage, 'updates.json');
      fs.writeFileSync(nextStore, JSON.stringify(jobs, null, 2), { flush: true });
      try {
        if (entry(dist)) fs.renameSync(dist, oldBuild);
        fs.renameSync(nextBuild, dist);
        buildInstalled = true;
        putFiles(files, source, 'before');
        fs.renameSync(nextStore, store);
      } catch (error) {
        try {
          if (buildInstalled) fs.renameSync(dist, nextBuild);
          if (entry(oldBuild)) fs.renameSync(oldBuild, dist);
          if (buildInstalled) putFiles(files, stage, 'current');
        } catch {
          keepStage = true;
          throw new Error(`Recovery was interrupted. Previous files are in ${stage}.`, { cause: error });
        }
        throw error;
      }
    } finally {
      if (!keepStage) fs.rmSync(stage, { recursive: true, force: true });
    }
    return latest.id;
  } finally {
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some(arg => arg !== '--force')) {
      throw new Error('Usage: node scripts/recover.mjs [--force]');
    }
    const id = await recover(path.dirname(path.dirname(fileURLToPath(import.meta.url))), { force: args.includes('--force') });
    console.log(`Restored the files and dashboard build from before update ${id}. Run Start Eden.bat to start EDEN.`);
  } catch (error) {
    console.error(`EDEN recovery stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
