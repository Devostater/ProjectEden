import test from 'node:test';
import assert from 'node:assert/strict';
import { takeAgenda } from '../projectChat';

test('lines marked [agenda] become list items and leave the reply', () => {
  const r = takeAgenda('Sure, added both.\n[agenda] Pricing for the demo\n- [agenda] Who records the trailer');
  assert.deepEqual(r.items, ['Pricing for the demo', 'Who records the trailer']);
  assert.equal(r.text, 'Sure, added both.');
});

test('a trailing [agenda] marker also counts', () => {
  assert.deepEqual(takeAgenda('Steam page date [agenda]').items, ['Steam page date']);
});

test('a reply without markers is unchanged', () => {
  const r = takeAgenda('No list changes.');
  assert.deepEqual(r.items, []);
  assert.equal(r.text, 'No list changes.');
});
