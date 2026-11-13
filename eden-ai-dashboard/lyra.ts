// LYRA panel: lets the owner talk to LYRA directly from the bottom panel, without picking a teammate.
// Like the terminal, it only answers from this computer and from the hub's own page.
import type { Express, Request } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { generate, lyraConnected, pingLyra } from './providers';
import { logActivity } from './activity';

// Where LYRA's Nova.bat lives. The owner can set LYRA_START_PATH to its full path; otherwise we look in the usual place.
function findNovaBat(): string | null {
  const candidates = [
    process.env.LYRA_START_PATH,
    path.join(os.homedir(), 'OneDrive', 'Documents', 'Forge', 'Nova.bat'), // where LYRA lives now
    path.join(os.homedir(), 'Documents', 'Forge', 'Nova.bat'),
    path.join(os.homedir(), 'Documents', 'GITHUB', 'Project-Nova', 'Nova.bat'),
  ].filter((p): p is string => !!p && p.trim() !== '');
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // try the next place
    }
  }
  return null;
}

function fromThisComputer(req: Request): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function fromOwnPage(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// LYRA's own API on this computer (same address the provider layer uses).
const LYRA = () => (process.env.LYRA_URL || 'http://127.0.0.1:4777').replace(/\/+$/, '');
async function lyraJson(p: string, body?: unknown, ms = 8000): Promise<any> {
  const r = await fetch(LYRA() + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `LYRA answered ${r.status}`);
  return j;
}
const short = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function registerLyraRoutes(app: Express) {
  // What LYRA is doing: her build, her task queue, what she made lately, her projects. Read-only.
  app.get('/api/lyra/overview', async (_req, res) => {
    try {
      const [ver, jobs, lib, proj] = await Promise.all([
        lyraJson('/api/version').catch(() => null),
        lyraJson('/api/jobs').catch(() => null),
        lyraJson('/api/library').catch(() => null),
        lyraJson('/api/projects').catch(() => null),
      ]);
      if (!ver && !jobs) return res.json({ connected: false });
      const order: Record<string, number> = { running: 0, queued: 1, failed: 2, interrupted: 2, cancelled: 3, done: 4 };
      const tasks = ((jobs && jobs.jobs) || [])
        .sort((a: any, b: any) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || (b.updated || 0) - (a.updated || 0))
        .slice(0, 10)
        .map((j: any) => ({ id: j.id, label: short(j.label, 120), status: j.status, type: j.type, step: short(j.text, 100), pct: j.pct || 0, needsOk: !!(j.info && j.info.ask), updated: j.updated || 0 }));
      const made = ((lib && lib.items) || [])
        .filter((i: any) => i.kind === 'image' && /^\/(sprites|media)\//.test(i.url || ''))
        .slice(0, 8)
        .map((i: any) => ({ title: short(i.title, 80), url: '/api/lyra/file?p=' + encodeURIComponent(i.url), created: i.created }));
      res.json({
        connected: true,
        build: ver && ver.build ? { name: ver.build.name, what: short(ver.build.what, 140) } : null,
        tasks,
        made,
        projects: ((proj && proj.projects) || []).map((p: string) => ({ path: p, name: p.split(/[\\/]/).filter(Boolean).pop() })),
        lyraPort: Number(new URL(LYRA()).port) || 4777,
      });
    } catch (err: any) {
      res.json({ connected: false, error: String(err?.message || err) });
    }
  });

  // A picture LYRA made (her Library), passed through so it also shows on a paired phone. Only her picture folders.
  app.get('/api/lyra/file', async (req, res) => {
    const p = String(req.query.p || '');
    if (!/^\/(sprites|media)\/[\w./%-]+\.(png|jpe?g|webp|gif)$/i.test(p) || p.includes('..')) return res.status(400).end();
    try {
      const r = await fetch(LYRA() + p, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return res.status(r.status).end();
      res.setHeader('content-type', r.headers.get('content-type') || 'image/png');
      res.setHeader('cache-control', 'private, max-age=3600');
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.status(502).end();
    }
  });

  // Give LYRA a task: she works on it in the background (her 📋 Tasks) and proposes edits for you to approve in LYRA.
  app.post('/api/lyra/task', async (req, res) => {
    if (!fromThisComputer(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'Tasks for LYRA can only be given from the hub on this computer.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'Write what LYRA should do.' });
    const project = typeof req.body?.project === 'string' && req.body.project ? req.body.project : null;
    try {
      const r = await lyraJson('/api/tasks/add', { items: [text.slice(0, 2000)], project, mode: project ? 'code' : 'chat', trust: 'ask' });
      logActivity('info', `Gave LYRA a task: ${short(text, 80)}`);
      res.json({ ok: true, tasks: (r.tasks || []).map((t: any) => t.id) });
    } catch (err: any) {
      res.status(502).json({ error: String(err?.message || err) });
    }
  });

  app.get('/api/lyra/status', async (_req, res) => {
    await pingLyra(); // check right now, so the page sees LYRA as soon as she is up
    res.json({ connected: lyraConnected() });
  });

  // Opens Nova.bat in its own window on this computer, which starts LYRA.
  app.post('/api/lyra/start', async (req, res) => {
    if (!fromThisComputer(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'LYRA can only be started from the hub on this computer.' });
    await pingLyra();
    if (lyraConnected()) return res.json({ ok: true, already: true });
    if (process.platform !== 'win32') return res.status(400).json({ error: 'Starting LYRA from here only works on the Windows computer.' });
    const bat = findNovaBat();
    if (!bat) return res.status(404).json({ error: "Couldn't find Nova.bat. Add a line LYRA_START_PATH=full path to Nova.bat in the hub's .env.local file, then restart the hub." });
    try {
      const child = spawn('cmd.exe', ['/c', 'start', 'LYRA', '/D', path.dirname(bat), 'cmd', '/k', bat], { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', () => {});
      child.unref();
      logActivity('info', 'LYRA was started from the hub.');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: `Could not start LYRA: ${err?.message || 'unknown error'}` });
    }
  });

  app.post('/api/lyra/chat', async (req, res) => {
    if (!fromThisComputer(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'LYRA can only be talked to from the hub on this computer.' });
    const text = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!text) return res.status(400).json({ error: 'Type a message first.' });
    // Earlier turns of this conversation, kept by the page.
    const earlier = Array.isArray(req.body?.history) ? req.body.history : [];
    const messages = earlier
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    messages.push({ role: 'user', content: text.slice(0, 8000) });
    try {
      const result = await generate({ model: 'lyra', messages });
      res.json({ reply: result.text, model: result.model });
    } catch (err: any) {
      logActivity('error', `LYRA: ${String(err?.message || err).slice(0, 200)}`);
      res.status(502).json({ error: String(err?.message || err) });
    }
  });
}
