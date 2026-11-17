// LYRA panel: lets the owner talk to LYRA directly from the bottom panel, without picking a teammate.
// Like the terminal, it only answers from this computer and from the hub's own page.
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { generate, lyraConnected, pingLyra } from './providers';
import { logActivity, fileProblem } from './activity';
import { mayManage } from './pairing';

// Where LYRA's Nova.bat lives. The owner can set LYRA_START_PATH to its full path; otherwise we look in the usual place.
function findNovaBat(): string | null {
  const candidates = [
    process.env.LYRA_START_PATH,
    'C:\\AZI\\Forge\\Nova.bat', // where LYRA lives now
    path.join(os.homedir(), 'OneDrive', 'Documents', 'Forge', 'Nova.bat'),
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

// Makes sure LYRA is running, without opening her page on this computer (used when she is opened on the tablet).
// Waits up to about two minutes for her to answer.
export async function ensureLyraRunning(): Promise<{ ok: boolean; error?: string }> {
  await pingLyra();
  if (lyraConnected()) return { ok: true };
  if (process.platform !== 'win32') return { ok: false, error: 'LYRA is not running.' };
  const bat = findNovaBat();
  if (!bat) return { ok: false, error: "Couldn't find LYRA's Nova.bat." };
  const child = spawn('cmd.exe', ['/c', 'start', 'LYRA', '/MIN', '/D', path.dirname(bat), 'cmd', '/k', bat], { detached: true, stdio: 'ignore', env: { ...process.env, NOVA_NO_OPEN: '1' } });
  child.on('error', () => {});
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    await pingLyra();
    if (lyraConnected()) return { ok: true };
  }
  return { ok: false, error: 'LYRA was started but is not answering yet.' };
}

// ---- The LYRA conversation, kept by the hub so every device shows the same one ----
// Messages typed in the LYRA panel are saved here (in .eden-lyra-chat.json), and every open page (this
// computer, the tablet, the phone) is told the moment one is added. LYRA gets this whole conversation
// each time, so she continues the same thread wherever you write to her.
interface LyraMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  at: number;
}
const CHAT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-lyra-chat.json');
const MAX_SAVED = 200;
let convo: { messages: LyraMsg[]; version: number } = { messages: [], version: 0 };
let thinking = false; // LYRA is working on a reply right now
try {
  const saved = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf-8'));
  if (Array.isArray(saved.messages)) convo.messages = saved.messages.filter((m: any) => m && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
} catch (err: any) {
  if (err?.code !== 'ENOENT') fileProblem("load LYRA's conversation", err);
}
let chatSaveTimer: NodeJS.Timeout | null = null;
const saveConvo = () => {
  if (chatSaveTimer) return;
  chatSaveTimer = setTimeout(() => {
    chatSaveTimer = null;
    try {
      fs.writeFileSync(CHAT_FILE, JSON.stringify({ messages: convo.messages }), 'utf-8');
    } catch (err: any) {
      fileProblem("save LYRA's conversation", err);
    }
  }, 300);
};
const watchers = new Set<Response>();
const tellWatchers = () => {
  for (const res of watchers) res.write(`data: ${convo.version}\n\n`);
};
function changed() {
  convo.version++;
  saveConvo();
  tellWatchers();
}
function addMsg(role: LyraMsg['role'], content: string, error = false): LyraMsg {
  const m: LyraMsg = { id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, content, at: Date.now(), ...(error ? { error: true } : {}) };
  convo.messages.push(m);
  if (convo.messages.length > MAX_SAVED) convo.messages = convo.messages.slice(-MAX_SAVED);
  changed();
  return m;
}

// Turns a raw failure ("terminated", "fetch failed", ECONNREFUSED, a timeout) into a sentence the owner can act on.
// Anything we don't recognise is kept as it is, so nothing is hidden.
const LYRA_STOPPED = 'LYRA stopped answering (it may have closed or run out of memory). Press Start LYRA, then send your message again.';
const LYRA_NOT_CONNECTED = 'LYRA is not connected right now. Press the Start LYRA button, then send your message again.';
const LYRA_DROPPED = /terminated|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|other side closed|aborted|timed? ?out|timeout/i;
async function plainLyraError(raw: string): Promise<string> {
  await pingLyra(); // check right now, so we know whether she is still running
  if (!lyraConnected()) return LYRA_NOT_CONNECTED;
  return LYRA_DROPPED.test(raw) ? LYRA_STOPPED : raw;
}

// Sends the conversation to LYRA and answers the page. A failure is shown in plain words in the chat and in the
// activity log, where its Retry button sends the same message again (`userId` is that message's id).
async function askLyra(messages: { role: 'user' | 'assistant'; content: string }[], userId: string, res: Response) {
  thinking = true;
  changed();
  try {
    const result = await generate({ model: 'lyra', messages });
    addMsg('assistant', result.text);
    res.json({ reply: result.text, model: result.model });
  } catch (err: any) {
    const raw = String(err?.message || err);
    const message = await plainLyraError(raw);
    logActivity('error', message, { reason: raw, retry: { kind: 'lyra', id: userId } });
    addMsg('assistant', message, true);
    res.status(502).json({ error: message });
  } finally {
    thinking = false;
    changed();
  }
}

export function registerLyraRoutes(app: Express) {
  // The shared conversation, and whether LYRA is thinking. Any paired device can read it.
  app.get('/api/lyra/conversation', (_req, res) => res.json({ messages: convo.messages, thinking, version: convo.version }));

  // Tells a page the moment something changes (a new message, a reply, LYRA starting to think, a clear).
  app.get('/api/lyra/conversation/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${convo.version}\n\n`);
    watchers.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      watchers.delete(res);
    });
  });

  // Start the conversation over, on every device.
  app.delete('/api/lyra/conversation', (req, res) => {
    if (!fromThisComputer(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'The LYRA conversation can only be cleared from the hub on this computer.' });
    convo.messages = [];
    changed();
    res.json({ ok: true });
  });

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

  // ✎ LYRA's edits waiting for your ✓ (from her tasks and chats): which file, how big, a short look at the new lines.
  app.get('/api/lyra/edits', async (_req, res) => {
    try {
      const r = await lyraJson('/api/phone/pending?full=1');
      res.json({ items: r.items || [] });
    } catch (err: any) {
      res.json({ items: [], error: String(err?.message || err) });
    }
  });
  // ✓ / ✕ one of them. Same rule as other code changes here: this computer, or a paired device with "Code updates" on.
  app.post('/api/lyra/edits/decide', async (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'LYRA\'s edits can only be approved from this computer, or from a device with "Code updates" switched on.' });
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    if (!id) return res.status(400).json({ error: 'Which edit?' });
    try {
      await lyraJson('/api/apply', { id, accept: !!req.body?.accept });
      logActivity('info', `${req.body?.accept ? 'Approved' : 'Rejected'} a LYRA edit${req.body?.file ? ' to ' + short(req.body.file, 80) : ''}.`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(502).json({ error: String(err?.message || err) });
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
    // Earlier turns come from the conversation the hub keeps (the same one every device sees).
    const messages = convo.messages
      .filter((m) => !m.error)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    // The message is saved and shown on every device right away, before LYRA has answered.
    const asked = addMsg('user', text.slice(0, 8000));
    messages.push({ role: 'user', content: text.slice(0, 8000) });
    await askLyra(messages, asked.id, res);
  });

  // The Retry button on a LYRA error in the activity log: sends that same message to LYRA again.
  app.post('/api/lyra/retry', async (req, res) => {
    if (!fromThisComputer(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'LYRA can only be talked to from the hub on this computer.' });
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    const at = convo.messages.findIndex((m) => m.id === id && m.role === 'user');
    if (at < 0) return res.status(404).json({ error: 'That message is no longer in the LYRA chat. Type it again.' });
    if (thinking) return res.status(409).json({ error: 'LYRA is still working on a reply. Wait for it, then try again.' });
    const next = convo.messages[at + 1];
    if (next && next.role === 'assistant' && !next.error) return res.status(409).json({ error: 'LYRA already answered that message.' });
    const messages = convo.messages
      .slice(0, at + 1)
      .filter((m) => !m.error)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    await askLyra(messages, id, res);
  });
}
