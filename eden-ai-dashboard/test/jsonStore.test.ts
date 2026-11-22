import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { jsonObject, jsonStore } from '../jsonStore';

function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-saves-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'store.json');
  const open = () => jsonStore<{ version: number }>(file, (data) =>
    jsonObject(data) && typeof data.version === 'number');
  return { dir, file, open };
}

test('a confirmed first run can seed a store and creates a last-good copy', (t) => {
  const { file, open } = fixture(t);
  const store = open();
  assert.equal(store.read(), undefined);
  assert.equal(fs.existsSync(file), false);
  store.write({ version: 1 });
  assert.deepEqual(open().read(), { version: 1 });
  assert.equal(fs.readFileSync(file + '.last-good', 'utf8'), '{"version":1}');
});

test('an interrupted rename leaves the old primary readable', (t) => {
  const { file, open } = fixture(t);
  open().write({ version: 1 });
  const rename = fs.renameSync;
  const failure = t.mock.method(fs, 'renameSync', (source: fs.PathLike, destination: fs.PathLike) => {
    if (destination === file) throw new Error('interrupted save');
    return rename(source, destination);
  });
  assert.throws(() => open().write({ version: 2 }), /interrupted save/);
  failure.mock.restore();

  // Also simulate a hard stop, where the process never got to clean up its partial temp file.
  fs.writeFileSync(file + '.tmp-interrupted', '{"version":');
  assert.deepEqual(open().read(), { version: 1 });
  assert.equal(fs.readFileSync(file + '.last-good', 'utf8'), '{"version":1}');
  open().write({ version: 3 });
  assert.deepEqual(open().read(), { version: 3 });
});

for (const damaged of ['{"version":', '{"unexpected":true}']) {
  test(`damaged data is preserved and the previous good save is restored (${damaged})`, (t) => {
    const { dir, file, open } = fixture(t);
    const error = t.mock.method(console, 'error', () => {});
    const warning = t.mock.method(console, 'warn', () => {});
    open().write({ version: 1 });
    open().write({ version: 2 });
    fs.writeFileSync(file, damaged);

    assert.deepEqual(open().read(), { version: 1 });
    const [preserved] = fs.readdirSync(dir).filter((name) => name.startsWith('store.json.corrupt-'));
    assert.ok(preserved);
    assert.equal(fs.readFileSync(path.join(dir, preserved), 'utf8'), damaged);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"version":1}');
    assert.match(String(error.mock.calls[0].arguments[0]), /preserved as/);
    assert.match(String(warning.mock.calls[0].arguments[0]), /Restored.*last-good/);
  });
}

test('a damaged legacy store cannot seed starter data on this or a later run', (t) => {
  const { dir, file, open } = fixture(t);
  t.mock.method(console, 'error', () => {});
  fs.writeFileSync(file, 'damaged');
  assert.throws(() => open().read(), /No usable copy/);
  assert.throws(() => open().read(), /No usable copy/);
  assert.throws(() => open().write({ version: 1 }), /No usable copy/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('a valid legacy store gets a recovery copy without changing its contents', (t) => {
  const { file, open } = fixture(t);
  const original = '{ "version": 7 }\n';
  fs.writeFileSync(file, original);
  assert.deepEqual(open().read(), { version: 7 });
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.readFileSync(file + '.last-good', 'utf8'), original);
});

test('a partial first write is evidence of an existing store', (t) => {
  const { file, open } = fixture(t);
  t.mock.method(console, 'error', () => {});
  fs.writeFileSync(file + '.last-good.tmp-interrupted', '{"version":');
  assert.throws(() => open().read(), /No usable copy/);
  assert.equal(fs.existsSync(file), false);
});

test('a missing primary is restored from its last-good copy', (t) => {
  const { file, open } = fixture(t);
  t.mock.method(console, 'warn', () => {});
  open().write({ version: 1 });
  fs.unlinkSync(file);
  assert.deepEqual(open().read(), { version: 1 });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"version":1}');
});
