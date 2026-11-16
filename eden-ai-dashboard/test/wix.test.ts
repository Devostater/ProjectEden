import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRichContent } from '../wix.ts';

test('blank lines make paragraphs; "# " lines make headings', () => {
  const r = toRichContent('# Devlog 1\n\nFirst paragraph\nstill first.\n\nSecond.');
  assert.deepEqual(r.nodes.map((n: any) => n.type), ['HEADING', 'PARAGRAPH', 'PARAGRAPH']);
  assert.equal((r.nodes[0] as any).nodes[0].textData.text, 'Devlog 1');
  assert.equal((r.nodes[1] as any).nodes[0].textData.text, 'First paragraph still first.');
});
