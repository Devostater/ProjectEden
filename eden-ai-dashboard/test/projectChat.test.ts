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

import { takeMeeting, meetingText } from '../projectChat';

test('a [meeting] line sets the time and leaves the reply', () => {
  const r = takeMeeting('Done, see you then.\n[meeting] 2026-11-17T18:00');
  assert.equal(r.at, '2026-11-17T18:00');
  assert.equal(r.text, 'Done, see you then.');
});

test('a reply without a meeting line is unchanged', () => {
  const r = takeMeeting('No meeting change.');
  assert.equal(r.at, null);
  assert.equal(r.text, 'No meeting change.');
});

test('meeting text is a real date, never "Today"', () => {
  const t = meetingText('2026-11-17T18:00');
  assert.match(t, /Nov 17, 6:00 PM/);
  assert.doesNotMatch(t, /Today/);
});
