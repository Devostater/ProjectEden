import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the dashboard release gate uses the same clean install and checks as local CI', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const workflow = readFileSync(new URL('../../.github/workflows/dashboard.yml', import.meta.url), 'utf8');
  const commands = workflow.match(/^\s*- run: (.+)$/gm)?.map((line) => line.trim());

  assert.deepEqual(commands, ['- run: npm run ci']);
  assert.deepEqual(manifest.scripts.ci.split(' && '), [
    'npm ci',
    'npm run lint',
    'npm test',
    'npm run build',
  ]);
});
