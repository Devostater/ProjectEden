// New Project: one action that turns a name into a ready-to-work project in the AZI layout.
// name -> C:\AZI\<Name> -> git -> private GitHub repo -> push -> registered in Eden -> a done/ready report.
// It can also adopt a folder that already exists (e.g. one with commits but no GitHub repo yet),
// and "Sync" a project later: secret check, commit (only if asked), pull, push.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { Express, Request } from 'express';
import type { Project } from './src/types/index';
import { githubToken } from './github';
import { addCodebase } from './updates';
import { logActivity } from './activity';

export const AZI_ROOT = process.env.AZI_ROOT || 'C:\\AZI';
const KEYS_DIR = () => path.join(AZI_ROOT, 'Security', 'Keys');
const HANDOFF_DIR = () => path.join(AZI_ROOT, 'AI handoff');
const OFF_LIMITS = ['security', 'archive', 'ai handoff'];
const BIG_FILE = 50 * 1024 * 1024; // GitHub warns at 50 MB and refuses 100 MB
const SECRET = /^(\.env(\..+)?|.*\.(pem|key|keystore|jks|pfx|p12)|keystore\.properties)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'Library', 'Temp', 'obj', '.gradle', '__pycache__', '.venv', 'venv']);

type Template = 'blank' | 'node' | 'python' | 'unity';
type StepState = 'ok' | 'warn' | 'fail' | 'skip';
interface Step {
  step: string;
  state: StepState;
  detail: string;
}
export interface ProjectReport {
  ok: boolean; // true = Ready: on disk, committed, on GitHub, local = GitHub, no secrets committed
  status: 'ready' | 'partial' | 'failed';
  name: string;
  folder: string;
  repo?: string;
  url?: string;
  commit?: string;
  projectId?: string;
  codebaseId?: string;
  secretsMoved: string[];
  bigFiles: string[];
  steps: Step[];
  next?: string;
}

interface Store {
  projects?: Project[];
}

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function run(cmd: string, args: string[], cwd: string, timeout = 120000) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf-8', windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || r.error?.message || '').trim() };
}
const git = (args: string[], cwd: string, timeout?: number) => run('git', args, cwd, timeout);
const lastLine = (s: string) => s.split('\n').filter(Boolean).slice(-2).join(' ');

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// "My Cool Game!" -> "My-Cool-Game". Letters, digits, - and _ only; also valid as a GitHub repo name.
export function folderName(raw: string): string {
  let n = String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 60);
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `${n}-project`;
  return n;
}

const GITIGNORE_BASE = `node_modules/
dist/
build/
.DS_Store
*.log
__pycache__/
.venv/

# Secrets: these live in ${AZI_ROOT}\\Security\\Keys and are never committed
.env
.env.*
!.env.example
*.pem
*.key
*.keystore
*.jks
*.pfx
*.p12
keystore.properties
`;
const GITIGNORE_UNITY = `
# Unity
[Ll]ibrary/
[Tt]emp/
[Oo]bj/
[Ll]ogs/
[Uu]ser[Ss]ettings/
*.csproj
*.sln
`;

function writeIfMissing(file: string, body: string) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, body, 'utf-8');
}

// Make sure a .gitignore has the secret rules (adds them to an existing one rather than replacing it).
function ensureGitignore(dir: string, template: Template) {
  const file = path.join(dir, '.gitignore');
  const want = GITIGNORE_BASE + (template === 'unity' ? GITIGNORE_UNITY : '');
  if (!fs.existsSync(file)) return fs.writeFileSync(file, want, 'utf-8');
  const have = fs.readFileSync(file, 'utf-8');
  if (!/keystore\.properties/.test(have)) fs.appendFileSync(file, `\n${want.slice(want.indexOf('# Secrets'))}`, 'utf-8');
}

function scaffold(dir: string, display: string, purpose: string, template: Template) {
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  writeIfMissing(path.join(dir, 'README.md'), `# ${display}\n\n${purpose || 'A new project.'}\n\nCreated ${date} by Eden in \`${dir}\`.\n`);
  writeIfMissing(
    path.join(dir, 'CLAUDE.md'),
    `# ${display}\n\nPart of the AZI workspace: read \`${AZI_ROOT}\\CLAUDE.md\` first (layout and rules).\n\n- Purpose: ${purpose || '(not set yet)'}\n- Secrets go in \`${AZI_ROOT}\\Security\\Keys\\${path.basename(dir)}\\\`, never in this folder.\n- GitHub: private repo, kept in sync from Eden (Projects -> Sync).\n`,
  );
  ensureGitignore(dir, template);
  if (template === 'node') {
    writeIfMissing(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: path.basename(dir).toLowerCase(), version: '0.1.0', private: true, type: 'module', scripts: { start: 'node index.js' } }, null, 2) + '\n',
    );
    writeIfMissing(path.join(dir, 'index.js'), `console.log('${display} is running.');\n`);
  } else if (template === 'python') {
    writeIfMissing(path.join(dir, 'main.py'), `def main():\n    print("${display} is running.")\n\n\nif __name__ == "__main__":\n    main()\n`);
    writeIfMissing(path.join(dir, 'requirements.txt'), '');
  }
}

// Walks the folder (skipping build and dependency folders) for secret files and files too big for GitHub.
function scanFolder(dir: string) {
  const secrets: string[] = [];
  const big: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.isFile()) {
        if (SECRET.test(e.name) && !/\.example$/i.test(e.name)) secrets.push(full);
        else {
          try {
            if (fs.statSync(full).size > BIG_FILE) big.push(full);
          } catch {
            /* unreadable: leave it */
          }
        }
      }
    }
  };
  walk(dir);
  return { secrets, big };
}

// Moves secret files to Security\Keys\<project>\, keeping their path in the name (a\b\.env -> a__b__.env).
function moveSecrets(dir: string, files: string[]): string[] {
  if (!files.length) return [];
  const dest = path.join(KEYS_DIR(), path.basename(dir));
  fs.mkdirSync(dest, { recursive: true });
  const moved: string[] = [];
  for (const f of files) {
    const rel = path.relative(dir, f).split(path.sep).join('__');
    let target = path.join(dest, rel);
    if (fs.existsSync(target)) target = path.join(dest, `${Date.now().toString(36)}__${rel}`);
    try {
      fs.renameSync(f, target);
      moved.push(`${path.relative(dir, f)} -> ${target}`);
    } catch (err: any) {
      moved.push(`${path.relative(dir, f)}: could not move (${err.message})`);
    }
  }
  return moved;
}

// Files that would be committed and are over 50 MB (ignored ones don't matter).
function bigTracked(dir: string, big: string[]) {
  return big.filter((f) => !git(['check-ignore', '-q', f], dir).ok).map((f) => path.relative(dir, f));
}

async function ghUser(token: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Eden-AI-Hub', Accept: 'application/vnd.github+json' } });
    if (!res.ok) return undefined;
    return (await res.json()).login;
  } catch {
    return undefined;
  }
}

// Creates a private repo (or finds it if it is already there). Returns owner/name and its https URL.
async function ensureGithubRepo(name: string, description: string): Promise<{ repo?: string; url?: string; error?: string; existed?: boolean }> {
  const token = githubToken(true)?.token;
  if (!token) return { error: 'GitHub is not linked: add a GitHub token in Connect AI (Settings), or sign in with "gh auth login".' };
  const owner = await ghUser(token);
  if (!owner) return { error: 'The GitHub token was refused (expired or missing the "repo" permission).' };
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'Eden-AI-Hub', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  const existing = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
  if (existing.ok) {
    const j = await existing.json();
    if (!j.private) return { error: `${owner}/${name} already exists on GitHub and is PUBLIC. Not pushing to it; make it private or pick another name.` };
    return { repo: j.full_name, url: j.html_url, existed: true };
  }
  const res = await fetch('https://api.github.com/user/repos', { method: 'POST', headers, body: JSON.stringify({ name, private: true, description: description.slice(0, 300), auto_init: false }) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { error: `GitHub would not create the repo (${res.status}): ${j.message || 'unknown error'}${j.errors?.[0]?.message ? ` - ${j.errors[0].message}` : ''}` };
  return { repo: j.full_name, url: j.html_url };
}

function writeHandoff(r: ProjectReport) {
  try {
    if (!fs.existsSync(HANDOFF_DIR())) return;
    const date = new Date().toISOString().slice(0, 10);
    const lines = [
      `# New project: ${r.name} (${date})`,
      '',
      `Status: **${r.status === 'ready' ? 'Ready' : r.status === 'partial' ? 'Partly ready' : 'Failed'}**`,
      `- Folder: \`${r.folder}\``,
      `- GitHub: ${r.url ? `[${r.repo}](${r.url}) (private)` : 'not linked'}`,
      r.commit ? `- Commit: \`${r.commit}\`` : '',
      r.secretsMoved.length ? `- Secrets moved to Security\\Keys: ${r.secretsMoved.length}` : '',
      '',
      '| Step | Result | Detail |',
      '|---|---|---|',
      ...r.steps.map((s) => `| ${s.step} | ${s.state} | ${s.detail.replace(/\|/g, '/')} |`),
      r.next ? `\nNext: ${r.next}` : '',
    ].filter((l) => l !== '');
    fs.writeFileSync(path.join(HANDOFF_DIR(), `${date}-new-project-${r.name}.md`), lines.join('\n') + '\n', 'utf-8');
  } catch {
    /* the report is still shown in Eden */
  }
}

// Adds a row for the project to the layout list in C:\AZI\CLAUDE.md (once).
function addToLayout(name: string, purpose: string, repo?: string) {
  const file = path.join(AZI_ROOT, 'CLAUDE.md');
  try {
    if (!fs.existsSync(file)) return;
    const body = fs.readFileSync(file, 'utf-8');
    if (body.includes(`\`${name}/\``)) return;
    const row = `- \`${name}/\` — ${purpose || 'new project'}${repo ? ` (GitHub: ${repo}, private)` : ''}. Added by Eden.\n`;
    const at = body.indexOf('- `Security/');
    fs.writeFileSync(file, at > -1 ? body.slice(0, at) + row + body.slice(at) : body + row, 'utf-8');
  } catch {
    /* not essential */
  }
}

function syncCheck(dir: string): { inSync: boolean; detail: string } {
  git(['fetch', '-q', 'origin'], dir, 60000);
  const st = git(['status', '--porcelain'], dir).out;
  const ab = git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], dir);
  if (!ab.ok) return { inSync: false, detail: 'No upstream branch on GitHub yet.' };
  const [ahead, behind] = ab.out.split(/\s+/).map(Number);
  const dirty = st ? st.split('\n').length : 0;
  const inSync = !ahead && !behind && !dirty;
  return { inSync, detail: inSync ? 'This PC and GitHub match.' : `${ahead} to push, ${behind} to pull, ${dirty} uncommitted change(s).` };
}

export async function createProject(opts: { name: string; purpose?: string; template?: Template; adopt?: boolean; color?: string }, store: Store, save: () => void): Promise<ProjectReport> {
  const display = String(opts.name || '').trim().slice(0, 80);
  const name = folderName(display);
  const purpose = String(opts.purpose || '').trim().slice(0, 300);
  const template: Template = (['blank', 'node', 'python', 'unity'] as const).includes(opts.template as Template) ? (opts.template as Template) : 'blank';
  const dir = path.join(AZI_ROOT, name);
  const report: ProjectReport = { ok: false, status: 'failed', name, folder: dir, secretsMoved: [], bigFiles: [], steps: [] };
  const add = (step: string, state: StepState, detail: string) => report.steps.push({ step, state, detail });
  const finish = () => {
    const fails = report.steps.some((s) => s.state === 'fail');
    const warns = report.steps.some((s) => s.state === 'warn');
    report.ok = !fails && !warns;
    report.status = report.ok ? 'ready' : report.steps.some((s) => s.step === 'Git' && s.state === 'ok') ? 'partial' : 'failed';
    logActivity(report.ok ? 'done' : report.status === 'partial' ? 'info' : 'error', `New project ${name}: ${report.ok ? 'ready' : report.status === 'partial' ? 'partly ready' : 'failed'}. ${report.next || ''}`.trim());
    if (report.steps.some((s) => s.step === 'Folder' && s.state === 'ok')) writeHandoff(report); // only for projects that exist
    return report;
  };

  // 1. Name
  if (!name) {
    add('Name', 'fail', 'Give the project a name with at least one letter or digit.');
    return finish();
  }
  if (OFF_LIMITS.includes(name.toLowerCase())) {
    add('Name', 'fail', `"${name}" is reserved in ${AZI_ROOT}.`);
    return finish();
  }
  const exists = fs.existsSync(dir);
  if (exists && !opts.adopt) {
    add('Name', 'fail', `${dir} already exists. Tick "Use the existing folder" to set it up instead.`);
    report.next = 'Pick another name, or adopt the existing folder.';
    return finish();
  }
  if (!exists && opts.adopt) {
    add('Name', 'fail', `${dir} doesn't exist, so there is nothing to adopt.`);
    return finish();
  }
  add('Name', 'ok', name === display ? name : `"${display}" -> ${name}`);

  // 2. Folder
  try {
    scaffold(dir, display, purpose, template);
    add('Folder', 'ok', exists ? `Using the existing folder; added README/CLAUDE.md/.gitignore only where missing.` : `Created with the ${template} template.`);
  } catch (err: any) {
    add('Folder', 'fail', `Could not create the folder: ${err.message}`);
    return finish();
  }

  // 3. Git: secrets out, big files flagged, first commit
  const { secrets, big } = scanFolder(dir);
  report.secretsMoved = moveSecrets(dir, secrets); // all of them, ignored or not: secrets live only in Security\Keys
  if (!fs.existsSync(path.join(dir, '.git'))) {
    const init = git(['init', '-b', 'main'], dir);
    if (!init.ok) {
      add('Git', 'fail', `git init failed: ${lastLine(init.err)}`);
      return finish();
    }
  }
  report.bigFiles = bigTracked(dir, big);
  if (report.bigFiles.length) {
    add('Git', 'fail', `Not committing: ${report.bigFiles.length} file(s) over 50 MB (${report.bigFiles.slice(0, 3).join(', ')}). Use Git LFS or add them to .gitignore.`);
    report.next = 'Deal with the big files, then press Sync.';
    return finish();
  }
  git(['add', '-A'], dir);
  const staged = git(['diff', '--cached', '--name-only'], dir).out;
  if (staged) {
    const c = git(['commit', '-q', '-m', exists ? `Set up ${name} with Eden (AZI layout, secret rules)` : `Start ${name}`], dir);
    if (!c.ok) {
      add('Git', 'fail', `Commit failed: ${lastLine(c.err || c.out)}`);
      return finish();
    }
  }
  const head = git(['rev-parse', '--short', 'HEAD'], dir);
  if (!head.ok) {
    add('Git', 'fail', 'There is nothing to commit and no earlier commit.');
    return finish();
  }
  report.commit = head.out;
  const branch = git(['branch', '--show-current'], dir).out || 'main';
  add('Git', 'ok', `${staged ? 'Committed' : 'Already committed'} on ${branch} (${report.commit}).${report.secretsMoved.length ? ` Moved ${report.secretsMoved.length} secret file(s) to Security\\Keys\\${name} first.` : ''}`);

  // 4. GitHub
  const remote = git(['remote', 'get-url', 'origin'], dir);
  if (remote.ok) {
    report.repo = remote.out.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
    report.url = `https://github.com/${report.repo}`;
    add('GitHub', 'ok', `Already linked to ${report.repo}.`);
  } else {
    const gh = await ensureGithubRepo(name, purpose || display);
    if (gh.error || !gh.url) {
      add('GitHub', 'warn', gh.error || 'Unknown problem.');
      report.next = `Link GitHub: in GitHub Desktop choose File -> Add local repository -> ${dir} -> Publish repository (keep it private). Or add a GitHub token in Settings and press Sync.`;
    } else {
      report.repo = gh.repo;
      report.url = gh.url;
      git(['remote', 'add', 'origin', `${gh.url}.git`], dir);
      add('GitHub', 'ok', `${gh.existed ? 'Found' : 'Created'} private repo ${gh.repo}.`);
    }
  }
  if (report.url) {
    const push = git(['push', '-u', 'origin', branch], dir, 300000);
    if (!push.ok) {
      add('Push', 'warn', `Push failed: ${lastLine(push.err)}`);
      report.next = report.next || 'Check GitHub sign-in on this PC (GitHub Desktop or Git Credential Manager), then press Sync.';
    } else add('Push', 'ok', `Pushed ${branch}.`);
  } else add('Push', 'skip', 'No GitHub repo yet.');

  // 5. Register in Eden
  try {
    const projects = (store.projects = store.projects || []);
    let p = projects.find((x) => x.name.toLowerCase() === display.toLowerCase() || (report.repo && x.repo === report.repo));
    let codebaseId: string | undefined;
    try {
      codebaseId = addCodebase(display, dir);
    } catch {
      /* a codebase is a nice-to-have */
    }
    if (!p) {
      p = {
        id: newId('project'),
        name: display,
        goal: purpose,
        color: opts.color || '#10B981',
        status: 'active',
        repo: report.repo,
        codebaseId,
        branches: [{ id: 'branch-main', name: 'Main', color: '#6366F1', memberIds: [] }],
        createdAt: now(),
        updatedAt: now(),
      };
      projects.push(p);
    } else Object.assign(p, { repo: report.repo || p.repo, codebaseId: p.codebaseId || codebaseId, updatedAt: now() });
    save();
    report.projectId = p.id;
    report.codebaseId = codebaseId;
    addToLayout(name, purpose, report.repo);
    add('Eden', 'ok', `In Projects${codebaseId ? ' and Code updates' : ''}; listed in ${AZI_ROOT}\\CLAUDE.md.`);
  } catch (err: any) {
    add('Eden', 'warn', `Could not add it to Projects: ${err.message}`);
  }

  // 6. Sync check
  if (report.url && report.steps.some((s) => s.step === 'Push' && s.state === 'ok')) {
    const s = syncCheck(dir);
    add('Sync', s.inSync ? 'ok' : 'warn', s.detail);
  } else add('Sync', 'skip', 'Waiting for GitHub.');

  if (!report.next && report.steps.every((s) => s.state === 'ok' || s.state === 'skip')) report.next = `Open ${dir} and start working. Press Sync in Projects to keep GitHub up to date.`;
  return finish();
}

// Sync a project: secrets out, optional commit, pull (fast-forward only), push.
export async function syncProject(dir: string, commitMessage?: string): Promise<{ ok: boolean; steps: Step[]; secretsMoved: string[] }> {
  const steps: Step[] = [];
  const add = (step: string, state: StepState, detail: string) => steps.push({ step, state, detail });
  if (!fs.existsSync(path.join(dir, '.git'))) return { ok: false, steps: [{ step: 'Git', state: 'fail', detail: `${dir} is not a git repository.` }], secretsMoved: [] };
  const { secrets, big } = scanFolder(dir);
  const loose = secrets.filter((f) => !git(['check-ignore', '-q', f], dir).ok);
  const secretsMoved = moveSecrets(dir, loose);
  if (secretsMoved.length) add('Secrets', 'warn', `Moved ${secretsMoved.length} un-ignored secret file(s) to Security\\Keys.`);
  if (commitMessage) {
    const bigOnes = bigTracked(dir, big);
    if (bigOnes.length) {
      add('Commit', 'fail', `Not committing: files over 50 MB (${bigOnes.slice(0, 3).join(', ')}).`);
      return { ok: false, steps, secretsMoved };
    }
    git(['add', '-A'], dir);
    if (git(['diff', '--cached', '--name-only'], dir).out) {
      const c = git(['commit', '-q', '-m', commitMessage.slice(0, 200)], dir);
      add('Commit', c.ok ? 'ok' : 'fail', c.ok ? 'Committed your changes.' : lastLine(c.err || c.out));
      if (!c.ok) return { ok: false, steps, secretsMoved };
    } else add('Commit', 'skip', 'Nothing to commit.');
  }
  if (!git(['remote', 'get-url', 'origin'], dir).ok) {
    add('GitHub', 'warn', 'No GitHub repo linked yet.');
    return { ok: false, steps, secretsMoved };
  }
  const branch = git(['branch', '--show-current'], dir).out || 'main';
  const hasUpstream = git(['rev-parse', '--abbrev-ref', '@{u}'], dir).ok;
  if (hasUpstream) {
    const pull = git(['pull', '--ff-only', '-q'], dir, 300000);
    add('Pull', pull.ok ? 'ok' : 'warn', pull.ok ? 'Up to date with GitHub.' : `Could not fast-forward (GitHub and this PC both changed): ${lastLine(pull.err)}`);
    if (!pull.ok) return { ok: false, steps, secretsMoved };
  }
  const push = git(['push', '-u', 'origin', branch], dir, 300000);
  add('Push', push.ok ? 'ok' : 'warn', push.ok ? `Pushed ${branch}.` : lastLine(push.err));
  const s = syncCheck(dir);
  add('Check', s.inSync ? 'ok' : 'warn', s.detail);
  return { ok: steps.every((x) => x.state === 'ok' || x.state === 'skip'), steps, secretsMoved };
}

export function registerNewProjectRoutes(app: Express, getStore: () => Store, save: () => void) {
  let busy = false;

  // Creating folders and GitHub repos happens only from this computer.
  app.post('/api/projects/new', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    if (busy) return res.status(409).json({ error: 'Another project is being set up. Try again in a moment.' });
    busy = true;
    try {
      const b = req.body || {};
      const report = await createProject({ name: b.name, purpose: b.purpose, template: b.template, adopt: b.adopt === true, color: b.color }, getStore(), save);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    } finally {
      busy = false;
    }
  });

  // Preview the folder name and whether it is free (for the form).
  app.get('/api/projects/new/check', (req, res) => {
    const name = folderName(String(req.query.name || ''));
    const dir = path.join(AZI_ROOT, name);
    res.json({ name, folder: dir, exists: !!name && fs.existsSync(dir), github: !!githubToken() });
  });

  app.post('/api/projects/:id/sync', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    const p = (getStore().projects || []).find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    const repoName = p.repo ? p.repo.split('/')[1] : '';
    const dir = [repoName && path.join(AZI_ROOT, repoName), path.join(AZI_ROOT, folderName(p.name))].find((d) => d && fs.existsSync(path.join(d, '.git')));
    if (!dir) return res.status(404).json({ error: `No git folder for ${p.name} in ${AZI_ROOT}.` });
    const result = await syncProject(dir, typeof req.body?.commitMessage === 'string' && req.body.commitMessage.trim() ? req.body.commitMessage.trim() : undefined);
    logActivity(result.ok ? 'done' : 'info', `Sync ${p.name}: ${result.ok ? 'GitHub is up to date.' : result.steps.map((s) => s.detail).slice(-1)[0]}`);
    res.json({ ...result, folder: dir });
  });
}
