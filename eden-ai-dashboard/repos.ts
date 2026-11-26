// GitHub repos on this PC: every git project in your workspace folder (C:\AZI by default), kept in step
// with GitHub. For each one: what changed, how far it is ahead of / behind GitHub, and buttons to
// Sync (bring GitHub's changes down, send this PC's saved changes up), Save changes (commit), Pull and Push.
// Auto-sync (per repo, off until you switch it on) does the same every 10 minutes, but only when it is
// safe: it never saves (commits) your work for you, and it skips a repo with unsaved changes it would clash with.
// Uses the git on this PC and its own GitHub sign-in (Git Credential Manager), so nothing new to set up.
// Archive and Security are never touched (Security holds keys).
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import { logActivity, fileProblem } from './activity';
import { mayManage, mayView } from './permissions';
import { parseRepo } from './github';
import { applying, runnerHold } from './oneWriter';

const ROOT = process.env.EDEN_REPOS_ROOT || 'C:\\AZI';
const SKIP = new Set(['archive', 'security', 'node_modules']);
const SETTINGS = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-repos.json');

let settings: { auto: Record<string, boolean>; lastSync: Record<string, string> } = { auto: {}, lastSync: {} };
try {
  settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS, 'utf-8')) };
} catch (err: any) {
  if (err?.code !== 'ENOENT') fileProblem('load your repo settings', err);
}
const saveSettings = () => {
  try {
    fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err: any) {
    fileProblem('save your repo settings', err);
  }
};

function git(dir: string, args: string[], timeout = 120000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    // GIT_TERMINAL_PROMPT=0: never hang waiting for a password typed in a hidden window.
    const child = spawn('git', args, { cwd: dir, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, out: '', err: e.message.includes('ENOENT') ? 'Git is not installed on this PC.' : e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out: out.trim(), err: err.trim() });
    });
  });
}

// Git's messages, made shorter and more useful.
function explain(err: string): string {
  if (/Authentication failed|could not read Username|403|permission denied/i.test(err)) return "GitHub didn't accept this PC's sign-in. Open a terminal and run: git push (once) to sign in again.";
  if (/not possible to fast-forward|diverged|non-fast-forward|rejected/i.test(err)) return 'This PC and GitHub both have new changes. Press Sync to bring GitHub\'s down first; if that says they clash, they need merging by hand.';
  if (/would be overwritten|commit your changes or stash/i.test(err)) return 'Unsaved changes here clash with what is coming from GitHub. Save changes first, then Sync.';
  if (/Could not resolve host|unable to access/i.test(err)) return "Couldn't reach GitHub. Check the internet connection.";
  if (/nothing to commit/i.test(err)) return 'Nothing to save: no changes.';
  return err.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300) || 'Git stopped with an error.';
}

export interface RepoInfo {
  name: string;
  dir: string;
  remote: string; // GitHub address, '' when not linked
  web: string; // https://github.com/owner/name, '' when not GitHub
  branch: string;
  upstream: boolean;
  ahead: number;
  behind: number;
  changes: { status: string; file: string }[];
  changeCount: number;
  lastCommit: { hash: string; subject: string; when: string } | null;
  auto: boolean;
  lastSync?: string;
  error?: string;
}

function listRepoDirs(): { name: string; dir: string }[] {
  try {
    return fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name.toLowerCase()))
      .map((d) => ({ name: d.name, dir: path.join(ROOT, d.name) }))
      .filter((r) => fs.existsSync(path.join(r.dir, '.git')));
  } catch {
    return [];
  }
}
const findRepo = (name: string) => listRepoDirs().find((r) => r.name === name);

async function info(name: string, dir: string, fetchFirst: boolean): Promise<RepoInfo> {
  const remote = (await git(dir, ['remote', 'get-url', 'origin'], 10000)).out;
  let error: string | undefined;
  if (fetchFirst && remote) {
    const f = await git(dir, ['fetch', '--prune', 'origin'], 60000);
    if (!f.ok) error = explain(f.err);
  }
  const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], 10000)).out || '?';
  const counts = await git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], 10000);
  const [ahead, behind] = counts.ok ? counts.out.split(/\s+/).map(Number) : [0, 0];
  const status = await git(dir, ['status', '--porcelain'], 30000);
  const lines = status.out ? status.out.split('\n') : [];
  const last = await git(dir, ['log', '-1', '--format=%h%x09%s%x09%cI'], 10000);
  const [hash, subject, when] = last.out.split('\t');
  let web = '';
  try {
    if (/github\.com/i.test(remote)) web = `https://github.com/${parseRepo(remote).repo}`;
  } catch {}
  return {
    name,
    dir,
    remote,
    web,
    branch,
    upstream: counts.ok,
    ahead: ahead || 0,
    behind: behind || 0,
    changes: lines.slice(0, 40).map((l) => ({ status: l.slice(0, 2).trim(), file: l.slice(3) })),
    changeCount: lines.length,
    lastCommit: hash ? { hash, subject, when } : null,
    auto: !!settings.auto[name],
    lastSync: settings.lastSync[name],
    error,
  };
}

// Bring GitHub's changes down (fast-forward only: never a surprise merge), then send this PC's saved ones up.
async function sync(name: string, dir: string): Promise<{ ok: boolean; message: string }> {
  const held = runnerHold(dir, 'Sync');
  if (held) return { ok: false, message: held };
  return applying(dir, 'Sync', () => syncRepo(name, dir));
}

async function syncRepo(name: string, dir: string): Promise<{ ok: boolean; message: string }> {
  const remote = (await git(dir, ['remote', 'get-url', 'origin'], 10000)).out;
  if (!remote) return { ok: false, message: 'This repo isn\'t linked to GitHub yet.' };
  const f = await git(dir, ['fetch', '--prune', 'origin'], 60000);
  if (!f.ok) return { ok: false, message: explain(f.err) };
  const hasUpstream = (await git(dir, ['rev-parse', '--abbrev-ref', '@{u}'], 10000)).ok;
  if (hasUpstream) {
    const counts = (await git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], 10000)).out.split(/\s+/).map(Number);
    if (counts[1] > 0) {
      const p = await git(dir, ['merge', '--ff-only', '@{u}'], 60000);
      if (!p.ok) return { ok: false, message: explain(p.err) };
    }
    if (counts[0] > 0) {
      const u = await git(dir, ['push'], 120000);
      if (!u.ok) return { ok: false, message: explain(u.err) };
    }
    settings.lastSync[name] = new Date().toISOString();
    saveSettings();
    return { ok: true, message: counts[0] || counts[1] ? `Up to date with GitHub (${counts[1]} down, ${counts[0]} up).` : 'Already up to date with GitHub.' };
  }
  // A branch GitHub doesn't have yet: send it up and remember the link.
  const u = await git(dir, ['push', '-u', 'origin', 'HEAD'], 120000);
  if (!u.ok) return { ok: false, message: explain(u.err) };
  settings.lastSync[name] = new Date().toISOString();
  saveSettings();
  return { ok: true, message: 'Sent this branch to GitHub.' };
}

export function registerRepoRoutes(app: Express) {
  app.get('/api/repos', async (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    const fetchFirst = req.query.fetch === '1';
    const repos = await Promise.all(listRepoDirs().map((r) => info(r.name, r.dir, fetchFirst)));
    res.json({ root: ROOT, repos });
  });

  app.post('/api/repos/clone', async (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'Only from this computer.' });
    let ref;
    try {
      ref = parseRepo(String(req.body?.repo || ''));
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    const name = ref.repo.split('/')[1];
    const dir = path.join(ROOT, name);
    if (fs.existsSync(dir)) return res.status(400).json({ error: `${dir} already exists.` });
    const c = await git(ROOT, ['clone', `https://github.com/${ref.repo}.git`, name], 10 * 60 * 1000);
    if (!c.ok) return res.status(400).json({ error: explain(c.err) });
    logActivity('done', `Cloned ${ref.repo} into ${dir}.`);
    res.json({ ok: true, repo: await info(name, dir, false) });
  });

  app.post('/api/repos/:name/:action', async (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'Only from this computer.' });
    const repo = findRepo(req.params.name);
    if (!repo) return res.status(404).json({ error: "That repo isn't in your workspace folder." });
    const { name, dir } = repo;
    const done = async (message: string) => res.json({ ok: true, message, repo: await info(name, dir, false) });
    const fail = (message: string) => res.status(400).json({ error: message });
    switch (req.params.action) {
      case 'sync': {
        const r = await sync(name, dir);
        if (r.ok) logActivity('done', `${name}: ${r.message}`);
        return r.ok ? done(r.message) : fail(r.message);
      }
      case 'pull': {
        const held = runnerHold(dir, 'Sync');
        if (held) return fail(held);
        const p = await applying(dir, 'Sync', () => git(dir, ['pull', '--ff-only'], 120000));
        return p.ok ? done('Brought GitHub\'s changes down.') : fail(explain(p.err));
      }
      case 'push': {
        const hasUpstream = (await git(dir, ['rev-parse', '--abbrev-ref', '@{u}'], 10000)).ok;
        const p = await git(dir, hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'], 120000);
        return p.ok ? done('Sent to GitHub.') : fail(explain(p.err));
      }
      case 'commit': {
        const held = runnerHold(dir, 'Saving to GitHub');
        if (held) return fail(held);
        // Saves everything that changed in this repo, with your message. Files listed in .gitignore stay out.
        const message = String(req.body?.message || '').trim();
        if (!message) return fail('Write a short note about what changed.');
        const c = await applying(dir, 'Saving to GitHub', async () => {
          const add = await git(dir, ['add', '-A'], 60000);
          if (!add.ok) return add;
          return git(dir, ['commit', '-m', message.slice(0, 500)], 60000);
        });
        if (!c.ok) return fail(explain(c.err || c.out));
        logActivity('done', `${name}: saved changes ("${message.slice(0, 60)}").`);
        return done('Changes saved. Press Sync to send them to GitHub.');
      }
      case 'auto': {
        settings.auto[name] = !!req.body?.on;
        saveSettings();
        return done(settings.auto[name] ? 'Auto-sync is on.' : 'Auto-sync is off.');
      }
      case 'link': {
        let ref;
        try {
          ref = parseRepo(String(req.body?.repo || ''));
        } catch (err: any) {
          return fail(err.message);
        }
        const url = `https://github.com/${ref.repo}.git`;
        const has = (await git(dir, ['remote', 'get-url', 'origin'], 10000)).ok;
        const r = await git(dir, has ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url], 10000);
        return r.ok ? done(`Linked to ${ref.repo}. Press Sync to send it up.`) : fail(explain(r.err));
      }
      default:
        return fail('Unknown action.');
    }
  });

  // Auto-sync: every 10 minutes, for the repos you switched it on for. Safe steps only (see the top of this file).
  const lastRunnerHold = new Map<string, number>();
  const tick = async () => {
    for (const r of listRepoDirs().filter((x) => settings.auto[x.name])) {
      const held = runnerHold(r.dir, 'Sync');
      if (held) {
        const now = Date.now();
        if (now - (lastRunnerHold.get(r.dir) ?? -Infinity) >= 10 * 60 * 1000) {
          lastRunnerHold.set(r.dir, now);
          logActivity('info', `Auto-sync ${r.name}: ${held}`);
        }
        continue;
      }
      await applying(r.dir, 'Sync', async () => {
        const before = await info(r.name, r.dir, true);
        if (before.error || !before.remote) return;
        if (before.behind > 0 && before.changeCount > 0) return; // unsaved work here: don't pull over it
        if (!before.ahead && !before.behind) return;
        const s = await syncRepo(r.name, r.dir);
        logActivity(s.ok ? 'info' : 'error', `Auto-sync ${r.name}: ${s.message}`);
      });
    }
  };
  setTimeout(() => tick().catch(() => {}), 60000).unref?.();
  setInterval(() => tick().catch(() => {}), 10 * 60 * 1000).unref?.();
}
