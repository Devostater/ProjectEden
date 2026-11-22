import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const windows = process.platform === 'win32';
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const requiredCode = ['package.json', 'package-lock.json', 'server.ts', 'index.html', 'src/main.tsx'];
const excluded = ['node_modules', 'dist', '.eden-dist-last-good', '.eden-logs', 'mobile/android/app/build', 'mobile/android/.gradle', 'mobile/android/build'];

export async function requiredBackupFiles(source) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  const savedFiles = entries.filter(({ name }) =>
    /^(?:\.eden-.+|\.nexusflow-store)\.json(?:\.last-good)?$|^\.env(?:\..+)?$/.test(name));
  return [...requiredCode, ...savedFiles.map(({ name }) => name)];
}

export async function createBackupArchive(source, archive) {
  const args = windows
    ? ['-a', '-c', '-f', archive, ...[...excluded, '*.apk', '*.zip'].flatMap((entry) => ['--exclude', entry]), '-C', source, '.']
    : ['-r', '-q', archive, '.', '-x', ...excluded.flatMap((entry) => [entry, `${entry}/*`]), '*.apk', '*.zip'];
  try {
    await run(windows ? tar : 'zip', args, { cwd: source, timeout: 600_000, windowsHide: true });
  } catch {
    throw new Error('Could not write the backup ZIP.');
  }
}

async function checkZipFooter(archive) {
  // A streaming extractor can recover entries from some truncated ZIPs. Require the
  // end-of-central-directory record as well as a successful full extraction.
  const file = await fs.open(archive, 'r');
  try {
    const { size } = await file.stat();
    const tail = Buffer.alloc(Math.min(size, 22 + 65_535));
    const { bytesRead } = await file.read(tail, 0, tail.length, size - tail.length);
    for (let i = bytesRead - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === bytesRead) return;
    }
    throw new Error('The backup ZIP is incomplete or damaged.');
  } finally {
    await file.close();
  }
}

export async function restoreBackup(archive, destination, required = requiredCode) {
  archive = path.resolve(archive);
  destination = path.resolve(destination);
  await checkZipFooter(archive);
  // An exclusive mkdir prevents extraction over any existing folder, even an empty one.
  await fs.mkdir(destination, { mode: 0o700 });
  try {
    try {
      await run(windows ? tar : 'unzip', windows
        ? ['-xf', archive, '-C', destination]
        : ['-q', '-o', archive, '-d', destination], { timeout: 600_000, windowsHide: true });
    } catch {
      throw new Error('Could not extract the backup ZIP. It may be damaged.');
    }
    for (const name of required) {
      const entry = await fs.lstat(path.join(destination, name)).catch(() => null);
      if (!entry?.isFile()) throw new Error(`The backup is missing a required file: ${name}.`);
    }
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function publishVerifiedBackup(archive, destination, required) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'eden-verify-'));
  try {
    await restoreBackup(archive, path.join(scratch, 'restore'), required);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  const { size } = await fs.stat(archive);
  await fs.rename(archive, destination);
  return size;
}
