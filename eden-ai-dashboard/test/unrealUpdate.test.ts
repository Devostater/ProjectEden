import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_UNREAL_ENGINE_DIR, unrealUpdate } from '../unrealUpdate';

const engineDir = path.resolve('Custom Unreal Engine');
const aura = path.join(engineDir, 'Engine', 'Plugins', 'Marketplace', 'Aura');
const python = path.join(aura, 'PortablePython', 'Windows', 'python.exe');
const inspector = path.join(aura, 'MCP', 'unreal_inspector.py');
const editor = path.join(aura, 'MCP', 'unreal_editor.py');
const running = async () => true;

test('Unreal tooling leaves other codebases untouched', async () => {
  for (const unreal of [undefined, false, 'true']) {
    assert.deepEqual(await unrealUpdate(unreal, true, {
      running: async () => assert.fail('checked the editor for a non-Unreal codebase'),
      fileExists: () => assert.fail('checked Aura files for a non-Unreal codebase'),
    }), { args: [], prompt: '' });
  }
});

test('Aura requires a running editor plus the Python binary and selected script', async () => {
  const closed = await unrealUpdate(true, false, {
    running: async () => false,
    fileExists: () => assert.fail('checked Aura files with the editor closed'),
  });
  assert.equal(closed.status, 'closed');
  assert.deepEqual(closed.args, []);
  assert.match(closed.prompt, /Say in your report which editor tools you called/);
  for (const [allowChange, missing] of [[false, python], [false, inspector], [true, editor]] as const) {
    const result = await unrealUpdate(true, allowChange, { running, engineDir, fileExists: (file) => file !== missing });
    assert.equal(result.status, 'missing');
    assert.deepEqual(result.args, []);
  }
});

test('Codex receives inspector overrides by default and editor overrides only with explicit consent', async () => {
  for (const consent of [undefined, false, 'true', true]) {
    const canChange = consent === true;
    const script = canChange ? editor : inspector;
    const result = await unrealUpdate(true, consent, { running, engineDir, fileExists: (file) => [python, script].includes(file) });
    assert.equal(result.status, canChange ? 'change' : 'look');
    assert.deepEqual(result.args, [
      '-c', `mcp_servers.aura.command='${python}'`,
      '-c', `mcp_servers.aura.args=['${script}']`,
      '--approve-for-me',
    ]);
    assert.match(result.prompt, /Say in your report which editor tools you called/);
  }
  assert.equal(DEFAULT_UNREAL_ENGINE_DIR, String.raw`C:\Unreal Engine 5\UE_5.8`);
});
