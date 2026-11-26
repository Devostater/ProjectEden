// When the hub stops a job that ran too long, the real work must stop too, not only the shell that started it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcessTree } from '../processTree.ts';

const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('stopping a job started through a shell also stops the work it started', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-tree-'));
  let worker = 0;
  t.after(() => {
    if (worker && running(worker)) process.kill(worker);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  // The "real work": says who it is, then keeps going for a minute (like an AI or a build that got stuck).
  const script = path.join(dir, 'work.js');
  fs.writeFileSync(script, 'console.log(process.pid); setTimeout(() => {}, 60000);');
  // Started the way the hub starts the AI, project tools and Terminal commands: one command line, through a shell.
  const child = spawn(`"${process.execPath}" "${script}"`, { shell: true, windowsHide: true });
  let said = '';
  child.stdout.on('data', (d) => (said += d));
  for (let i = 0; i < 100 && !/\d+\s/.test(said); i++) await delay(50);
  worker = Number(said.trim());
  assert.ok(worker > 0, `the work did not start: "${said}"`);
  assert.equal(running(worker), true);

  stopProcessTree(child);
  for (let i = 0; i < 100 && running(worker); i++) await delay(50);
  assert.equal(running(worker), false, 'the work was still running after the job was stopped');
});

// While the hub closes there is no "a moment later": with `wait` the work must be gone when the call returns.
// (Only Windows needs the wait; elsewhere the stop is immediate already.)
test('stopping with wait has ended the work by the time it returns', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-tree-'));
  let worker = 0;
  t.after(() => {
    if (worker && running(worker)) process.kill(worker);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const script = path.join(dir, 'work.js');
  fs.writeFileSync(script, 'console.log(process.pid); setTimeout(() => {}, 60000);');
  const child = spawn(`"${process.execPath}" "${script}"`, { shell: true, windowsHide: true });
  let said = '';
  child.stdout.on('data', (d) => (said += d));
  for (let i = 0; i < 100 && !/\d+\s/.test(said); i++) await delay(50);
  worker = Number(said.trim());
  assert.ok(worker > 0, `the work did not start: "${said}"`);

  stopProcessTree(child, { wait: true });
  assert.equal(running(worker), false, 'the work was still running when the stop returned');
});
