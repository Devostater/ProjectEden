// A Code update works in a copy of the codebase kept in a longer folder than the project itself. Git on
// Windows stops at 260-character paths by default, which broke the copy for Unreal projects with deep folders.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { git } from '../gitRun.ts';

test('a working copy keeps files whose paths are longer than 260 characters', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-long-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const project = path.join(root, 'project');
  const copy = path.join(root, 'copies', 'upd-12345678');
  const who = ['-c', 'user.name=Eden Hub', '-c', 'user.email=eden-hub@localhost'];
  fs.mkdirSync(project);
  git(['init', '-q'], project);
  fs.writeFileSync(path.join(project, 'readme.md'), 'hello');
  git(['add', '-A'], project);
  git([...who, 'commit', '-q', '-m', 'start'], project);
  git(['worktree', 'add', '--detach', copy, 'HEAD'], project);

  // Like an Unreal project: deep folders. Both the folder and the file are past the old limit in the copy.
  const file = [...Array(5).fill(`folder-${'x'.repeat(40)}`), 'asset.json'].join('/');
  assert.ok(path.join(copy, path.dirname(file)).length > 260);
  fs.mkdirSync(path.join(copy, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(copy, file), '{}');

  // The starting point must hold every file. A file left out here would later look like the AI added it.
  git(['add', '-A', '--', '.'], copy);
  git([...who, 'commit', '--no-verify', '-q', '-m', 'Starting point'], copy);
  assert.equal(git(['status', '--porcelain', '--untracked-files=all'], copy), '');
  assert.deepEqual(git(['ls-files'], copy).split('\n').filter(Boolean).sort(), [file, 'readme.md'].sort());

  // A change to that file is read back, and the copy can be cleared away afterwards.
  fs.writeFileSync(path.join(copy, file), '{"changed":true}');
  assert.deepEqual(git(['diff', 'HEAD', '--name-only'], copy).split('\n').filter(Boolean), [file]);
  git(['worktree', 'remove', '--force', copy], project);
  assert.equal(fs.existsSync(copy), false);
});
