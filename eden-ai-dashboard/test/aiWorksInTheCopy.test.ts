// A Code update must happen in the AI's working copy, never in the real folder. These tests cover the two
// things that keep it there: what the AI is told, and noticing when the real folder changed anyway.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { git } from '../gitRun.ts';
import { changedSince, realFolderChangedMessage, unsavedWork } from '../realFolder.ts';
import { aboutForAI, aboutNewCodebase, updateRules } from '../updatePrompt.ts';

test('the AI is never given the real folder path, and is told that it works in a copy', () => {
  const dir = String.raw`C:\AZI\NewPlugin`;
  // How a codebase added from the page was saved before this fix (PassGuard and SysPulse still are).
  const rules = updateRules({ about: `"New Plugin", a codebase in ${dir}.`, dir, protect: ['.env files', 'node_modules'] });
  assert.doesNotMatch(rules, /C:\\AZI/i);
  assert.match(rules, /^You are improving "New Plugin", a codebase in the current folder\.$/m);
  assert.match(rules, /You are working in a copy of it: the folder you were started in\./);
  assert.match(rules, /Only read and edit files inside the current folder/);
  assert.match(rules, /Never open or change this project anywhere else on this PC/);
  assert.match(rules, /^- Never touch: \.env files, node_modules\.$/m);

  // The path is found whatever its capitals and slashes, and a path inside it becomes a relative one.
  assert.equal(
    aboutForAI({ about: 'Read c:/azi/newplugin/docs/SPEC.md first. Root: C:\\AZI\\NewPlugin\\', dir }),
    'Read docs/SPEC.md first. Root: the current folder',
  );
  // Other folders stay, also ones whose path only starts the same way.
  const others = 'Engines in D:\\AI. Sister project: C:\\AZI\\NewPluginTools.';
  assert.equal(aboutForAI({ about: others, dir }), others);
  // A hand-written description without the path is unchanged.
  const levelGen = '"LevelGen", a level generator plugin. TypeScript core in core-ts/. See autopilot\\run.ps1.';
  assert.equal(aboutForAI({ about: levelGen, dir: 'C:\\AZI\\LevelGen' }), levelGen);
  // A codebase added from the page is now saved without its folder.
  assert.equal(aboutNewCodebase('New Plugin'), '"New Plugin", one of the owner\'s codebases.');
});

test('a change made in the real folder while the AI ran is noticed, and its files are named', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-real-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const who = ['-c', 'user.name=Eden Hub', '-c', 'user.email=eden-hub@localhost'];
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  git(['init', '-q'], root);
  write('core/rooms.js', 'one\n');
  write('README.md', 'hello\n');
  write('.gitignore', 'Saved/\n');
  git(['add', '-A'], root);
  git([...who, 'commit', '-q', '-m', 'start'], root);

  // The owner already has unsaved work when the copy is made: it must not count as the AI's.
  write('README.md', 'hello\nmy own edit\n');
  write('notes.txt', 'draft\n');
  const before = unsavedWork(root);
  assert.deepEqual(before.files, ['README.md', 'notes.txt']);

  // Nothing touched: no alarm. Files git ignores (editor data, build output) do not count either.
  write('Saved/editor.dat', 'x');
  assert.deepEqual(changedSince(before, unsavedWork(root)), []);

  // The AI edits the real folder instead of its copy: a file git tracks, and a new file.
  write('core/rooms.js', 'one\ntwo\n');
  write('core/rooms.test.js', 'test\n');
  const after = unsavedWork(root);
  assert.deepEqual(changedSince(before, after), ['core/rooms.js', 'core/rooms.test.js']);
  const message = realFolderChangedMessage('Demo Plugin', root, changedSince(before, after));
  assert.match(message, /Demo Plugin's real folder changed while this update ran \(core\/rooms\.js, core\/rooms\.test\.js\)/);
  assert.match(message, /not checked and are not in Undo/);
  assert.ok(message.includes(root));

  // Only a file that was already unsaved changed again: still noticed, and every unsaved file is listed.
  write('README.md', 'hello\nmy own edit\nand the AI\n');
  assert.deepEqual(changedSince(after, unsavedWork(root)), after.files);

  // A codebase can be one folder of a bigger repository: only that folder is read.
  assert.deepEqual(unsavedWork(root, 'core').files, ['core/rooms.js', 'core/rooms.test.js']);
  // A long list is cut short.
  assert.match(realFolderChangedMessage('X', 'C:\\X', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), /\(a, b, c, d, e, f and 2 more\)/);
});
