// node --test .github/scripts/gemini-review.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, boundDiffs, readReply } from './gemini-review.mjs';

test('readReply: non-2xx is a failed review, not a green one', () => {
  const r = readReply(403, { error: { message: 'API key not valid' } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /403.*API key not valid/);
});

test('readReply: 200 with no candidates or empty text is a failed review', () => {
  assert.equal(readReply(200, {}).ok, false);
  assert.equal(readReply(200, { candidates: [{ content: { parts: [{ text: '  ' }] }, finishReason: 'SAFETY' }] }).ok, false);
  assert.match(readReply(200, { candidates: [{ finishReason: 'SAFETY' }] }).reason, /SAFETY/);
});

test('readReply: real text is a review', () => {
  assert.deepEqual(readReply(200, { candidates: [{ content: { parts: [{ text: 'Looks fine.' }] } }] }), { ok: true, text: 'Looks fine.' });
});

test('findSecrets: flags credentials in added lines with file and line, ignores removed lines', () => {
  const fakeAws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const diff = [
    'diff --git a/x.ts b/x.ts',
    '--- a/x.ts',
    '+++ b/x.ts',
    '@@ -1,2 +10,3 @@',
    ' const a = 1;',
    `+const key = "${fakeAws}";`,
    `-const old = "${fakeAws}";`,
    '+const api' + 'Key = "abcdefghijklmnopq";', // split so this file doesn't trip the scanner itself
  ].join('\n');
  assert.deepEqual(findSecrets(diff), [
    { file: 'x.ts', line: 11, kind: 'AWS access key' },
    { file: 'x.ts', line: 12, kind: 'hard-coded secret' },
  ]);
});

test('findSecrets: ordinary code is not flagged', () => {
  assert.deepEqual(findSecrets('+++ b/a.ts\n@@ -1 +1 @@\n+const token = process.env.TOKEN;\n+const password = input.value;'), []);
});

test('boundDiffs: small PRs are complete; big files are cut and extra files listed as left out', () => {
  assert.equal(boundDiffs([{ name: 'a', diff: 'x'.repeat(100) }]).complete, true);
  const big = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, diff: 'y'.repeat(20_000) }));
  const b = boundDiffs(big);
  assert.equal(b.complete, false);
  assert.deepEqual(b.cut, ['f0', 'f1', 'f2', 'f3']);
  assert.deepEqual(b.omitted, ['f4', 'f5']);
  assert.ok(b.text.length <= 60_000 + 4 * 60);
});
