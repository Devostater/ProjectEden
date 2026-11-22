import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createBackupArchive, publishVerifiedBackup, requiredBackupFiles, restoreBackup } from '../scripts/backup-archive.mjs';

const cli = fileURLToPath(new URL('../scripts/restore-backup.mjs', import.meta.url));
const chat = '{"chats":["fixture"]}';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eden-backup-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'fake hub');
  await fs.mkdir(path.join(source, 'src'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'server.ts', 'index.html', 'src/main.tsx']) {
    await fs.writeFile(path.join(source, name), '{}');
  }
  await fs.writeFile(path.join(source, '.eden-chats.json'), chat);
  return { root, source, pending: path.join(root, 'pending.zip'), backup: path.join(root, 'eden-hub-new.zip') };
}

test('verified ZIP and extra copy restore saved data into a new scratch folder', async (t) => {
  const { root, source, pending, backup } = await fixture(t);
  const required = await requiredBackupFiles(source);
  await createBackupArchive(source, pending);
  await publishVerifiedBackup(pending, backup, required);
  const copy = path.join(root, 'extra copy.zip');
  await fs.copyFile(backup, pending);
  await publishVerifiedBackup(pending, copy, required);

  const scratch = path.join(root, 'scratch restore');
  execFileSync(process.execPath, [cli, copy, scratch]);
  assert.equal(await fs.readFile(path.join(scratch, '.eden-chats.json'), 'utf8'), chat);
  await assert.rejects(restoreBackup(copy, source), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(source, '.eden-chats.json'), 'utf8'), chat);
});

test('incomplete ZIP and missing required saved data prevent publication', async (t) => {
  const { root, source, pending, backup } = await fixture(t);
  const required = await requiredBackupFiles(source);
  const older = path.join(root, 'eden-hub-older.zip');
  await createBackupArchive(source, older);
  const valid = await fs.readFile(older);
  await fs.writeFile(pending, valid.subarray(0, -1));
  await assert.rejects(publishVerifiedBackup(pending, backup, required), /incomplete or damaged/);

  const damaged = Buffer.from(valid);
  const entryName = Buffer.from('.eden-chats.json');
  const nameOffset = damaged.indexOf(entryName);
  // Find the payload using the name and extra-field lengths in its ZIP local header.
  const header = damaged.lastIndexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), nameOffset);
  assert.ok(header >= 0 && nameOffset >= 0);
  const payload = header + 30 + damaged.readUInt16LE(header + 26) + damaged.readUInt16LE(header + 28);
  damaged[payload + 1] ^= 0xff;
  await fs.writeFile(pending, damaged);
  await assert.rejects(publishVerifiedBackup(pending, backup, required), /Could not extract/);

  await fs.unlink(pending);
  await fs.unlink(path.join(source, '.eden-chats.json'));
  await createBackupArchive(source, pending);
  await assert.rejects(publishVerifiedBackup(pending, backup, required), /missing a required file: \.eden-chats\.json/);
  await assert.rejects(fs.access(backup), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(older), valid);
});
