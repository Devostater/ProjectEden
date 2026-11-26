import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readProgress } from '../runners';
import { pluginName, publisherName, writeUnrealPlugin } from '../unrealPluginTemplate';

const app = fileURLToPath(new URL('../', import.meta.url));
const template = path.join(app, 'templates', 'unreal-plugin');
const project = {
  name: 'SkyTools', display: 'Sky "Tools"', purpose: 'A "tool" for sky\\cloud effects',
  publisher: 'Example "Studio"', date: new Date().toISOString().slice(0, 10),
};
const pluginFile = 'Plugins/SkyTools/SkyTools.uplugin';
const ignored = [
  '.Aura/state.json', '.ludus/x', 'Binaries/Win64/a.dll', 'Intermediate/b.obj',
  'Saved/c.log', 'DerivedDataCache/d', 'autopilot/runs/log.txt', 'dist/p.zip', 'Config/DefaultInput.ini',
];

function temp(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tree(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? [entry.name + '/', ...tree(path.join(dir, entry.name)).map((file) => entry.name + '/' + file)]
    : [entry.name]).sort();
}

test('plugin code names and publisher names are checked', () => {
  assert.equal(pluginName('Sky Tools'), 'SkyTools');
  assert.equal(pluginName('my-cool plugin 2'), 'MyCoolPlugin2');
  assert.equal(pluginName('a'.repeat(60)), 'A' + 'a'.repeat(23));
  for (const name of ['2-D', 'Core', 'engine', '']) {
    assert.throws(() => pluginName(name), /cannot be used as a plugin name.*Use letters and digits/);
  }
  assert.equal(publisherName('  Example "Studio"  '), project.publisher);
  for (const name of ['', 'x', 'Example\nStudio', 'x'.repeat(81)]) {
    assert.throws(() => publisherName(name), /Give the publisher name.*Fab requires/);
  }
});

test('the Unreal starter fills every file and keeps the Fab requirements', (t) => {
  const dir = temp(t);
  writeUnrealPlugin(dir, project);
  const output = tree(dir);
  assert.deepEqual(output, tree(template).map((file) => file.replaceAll('__NAME__', project.name)
    .replace(/^_(gitignore|gitattributes)$/, '.$1')).sort());
  for (const file of ['.gitignore', '.gitattributes', 'SkyToolsHost.uproject', pluginFile,
    'Plugins/SkyTools/Source/SkyTools/Private/Tests/SkyToolsSmokeTest.cpp',
    'autopilot/run.ps1', 'autopilot/proof.ps1', 'autopilot/TASKS.md']) {
    assert.ok(output.includes(file), file);
  }
  for (const file of output) {
    assert.doesNotMatch(file, /__\w+__/);
    if (file.startsWith('Plugins/SkyTools/')) {
      assert.ok(file.split('/').filter(Boolean).every((part) => /^[a-z0-9_.]+$/i.test(part)), file);
    }
    if (file.endsWith('/') || file.endsWith('.png')) continue;
    const body = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(body, /\r|__\w+__/, file);
    if (/\.(h|cpp|cs)$/.test(file)) {
      assert.equal(body.split('\n')[0], `// Copyright ${project.date.slice(0, 4)} ${project.publisher}. All Rights Reserved.`, file);
    }
  }
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
  assert.doesNotThrow(() => JSON.parse(read('SkyToolsHost.uproject')));
  const plugin = JSON.parse(read(pluginFile));
  for (const key of ['FileVersion', 'Version', 'VersionName', 'FriendlyName', 'Description', 'Category', 'CreatedBy',
    'CreatedByURL', 'DocsURL', 'SupportURL', 'FabURL', 'EngineVersion', 'CanContainContent', 'Installed']) {
    assert.ok(Object.hasOwn(plugin, key), key);
  }
  assert.equal(plugin.FriendlyName, project.display);
  assert.equal(plugin.Description, project.purpose);
  assert.equal(plugin.CreatedBy, project.publisher);
  assert.ok(!plugin.Plugins?.length);
  assert.equal(plugin.Modules.length, 1);
  assert.ok(plugin.Modules[0].PlatformAllowList.includes('Win64'));
  const icon = 'Resources/Icon128.png';
  assert.deepEqual(fs.readFileSync(path.join(dir, 'Plugins', 'SkyTools', icon)),
    fs.readFileSync(path.join(template, 'Plugins', '__NAME__', icon)));
  assert.equal(readProgress(read('autopilot/TASKS.md')).total, 0);

  fs.writeFileSync(path.join(dir, 'README.md'), 'Keep this');
  fs.unlinkSync(path.join(dir, pluginFile));
  writeUnrealPlugin(dir, { ...project, purpose: '' });
  assert.equal(read('README.md'), 'Keep this');
  assert.equal(JSON.parse(read(pluginFile)).Description, 'Describe in one or two sentences what this plugin does.');
  assert.throws(() => writeUnrealPlugin(path.join(dir, 'x'.repeat(101)), project), /folder path is too long for Unreal/);
});

test('the Unreal starter ignores generated files before staging', (t) => {
  const dir = temp(t);
  writeUnrealPlugin(dir, project);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  for (const file of ignored) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'generated');
  }
  git('add', '-A');
  const staged = git('diff', '--cached', '--name-only').trim().split(/\r?\n/);
  assert.ok(staged.includes(pluginFile));
  for (const file of ignored) assert.ok(!staged.includes(file), file);
});

test('both generated PowerShell scripts parse', { skip: process.platform !== 'win32' }, (t) => {
  const dir = temp(t);
  writeUnrealPlugin(dir, project);
  for (const script of ['run.ps1', 'proof.ps1']) {
    const file = path.join(dir, 'autopilot', script).replaceAll("'", "''");
    execFileSync('powershell', ['-NoProfile', '-Command',
      `$errorsFound = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$errorsFound); if ($errorsFound) { $errorsFound | Out-String; exit 1 }`],
    { stdio: 'pipe', windowsHide: true });
  }
});

test('creating an Unreal plugin commits locally and signs it up in Eden', (t) => {
  const root = temp(t);
  const hub = path.join(root, 'hub');
  const azi = path.join(root, 'AZI');
  fs.mkdirSync(hub);
  // The hub saves beside its modules and in the user home. Give both a disposable location.
  for (const file of fs.readdirSync(app).filter((name) => /\.(ts|mjs)$/.test(name) || name === 'package.json')) {
    fs.copyFileSync(path.join(app, file), path.join(hub, file));
  }
  for (const dir of ['server', 'scripts', 'src', 'templates']) {
    fs.cpSync(path.join(app, dir), path.join(hub, dir), { recursive: true });
  }
  fs.symlinkSync(path.join(app, 'node_modules'), path.join(hub, 'node_modules'), 'junction');
  fs.mkdirSync(azi);
  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { execFileSync } from 'node:child_process';
    globalThis.fetch = () => { throw new Error('Network access is forbidden in this test.'); };
    const { createProject, dirForProject } = await import('./newproject.ts');
    const { findCodebase } = await import('./updates.ts');
    const { createRunners } = await import('./runners.ts');
    const store = {};
    const report = await createProject({
      name: 'Sky Tools', template: 'unreal-plugin', publisher: ${JSON.stringify(project.publisher)},
    }, store, () => {});
    assert.equal(report.status, 'ready', JSON.stringify(report.steps));
    assert.equal(report.folder, path.join(process.env.AZI_ROOT, 'SkyTools'));
    assert.equal(dirForProject(store.projects[0]), report.folder);
    assert.deepEqual(report.steps.find((step) => step.step === 'GitHub'), {
      step: 'GitHub', state: 'skip', detail: 'Kept on this PC. Nothing was sent to GitHub.',
    });
    assert.equal(report.steps.find((step) => step.step === 'Push').state, 'skip');
    const git = (...args) => execFileSync('git', args, { cwd: report.folder, encoding: 'utf8' }).trim();
    assert.equal(git('remote'), '');
    const files = git('ls-tree', '-r', '--name-only', 'HEAD').split(/\\r?\\n/);
    assert.ok(files.includes(${JSON.stringify(pluginFile)}));
    assert.ok(files.includes('SkyToolsHost.uproject'));
    for (const file of ${JSON.stringify(ignored)}) assert.ok(!files.includes(file), file);
    assert.match(git('show', 'HEAD:.gitignore'), /keystore\\.properties/);
    assert.doesNotMatch(git('show', 'HEAD:.gitignore'), /^build\\//mi);
    assert.match(git('show', 'HEAD:CLAUDE.md'), /stays on this PC/);
    const codebase = findCodebase(report.codebaseId);
    assert.equal(codebase.ai, 'codex');
    assert.equal(codebase.unreal, true);
    assert.equal(codebase.proofMinutes, 120);
    assert.ok(codebase.proof.endsWith('proof.ps1'));
    assert.ok(codebase.protect.includes('autopilot/proof.ps1'));
    const [runner] = createRunners(process.cwd()).status(undefined).runners;
    assert.equal(runner.id, 'skytools');
    assert.equal(runner.state, 'Stopped');
  `], {
    cwd: hub, stdio: 'pipe', timeout: 30_000, windowsHide: true,
    env: {
      ...process.env, AZI_ROOT: azi, HOME: root, USERPROFILE: root, GITHUB_TOKEN: 'offline-test',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'), GIT_CONFIG_COUNT: '0', GIT_ALLOW_PROTOCOL: '',
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  });
});
