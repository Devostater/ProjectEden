// Local knowledge base: your own material, searchable with no internet and no AI model.
// What it reads:
//   - projects, cards (title, details, finished work and notes)
//   - Nexus discussions and the plans they produced
//   - folders of docs you add (.md, .txt, .json, .csv, .html; design docs, notes, store pages…)
// Teammates get the most relevant bits added to their brief, so local AIs (and cloud ones) answer from
// what your studio already knows. Search is BM25 keyword ranking: instant, runs on the CPU, no download.
// Rebuilt every 10 minutes and when you ask.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(APP_DIR, '.eden-knowledge.json');
const DEFAULT_FOLDER = path.join(APP_DIR, 'knowledge');
const TEXT_EXT = /\.(md|markdown|txt|json|csv|html?|ya?ml|ini|log)$/i;
const MAX_FILE = 2 * 1024 * 1024;
const CHUNK = 900;

interface Doc {
  id: string;
  source: string; // shown to the AI and the owner, e.g. "Card: Launch trailer" or "File: design/gdd.md"
  kind: 'card' | 'project' | 'nexus' | 'file';
  text: string;
  at?: string;
}

let folders: string[] = [DEFAULT_FOLDER];
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  if (Array.isArray(saved.folders)) folders = saved.folders;
} catch {}
const saveFolders = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ folders }, null, 2), 'utf-8');
  } catch {}
};
fs.mkdirSync(DEFAULT_FOLDER, { recursive: true });

// ---- Index ----------------------------------------------------------------------------------------
let docs: Doc[] = [];
let postings = new Map<string, Map<number, number>>(); // term -> (doc index -> count)
let lengths: number[] = [];
let avgLen = 1;
let builtAt = 0;
let fileCount = 0;

const STOP = new Set('the a an and or of to in on for with is are was were be been it this that as at by from we you i our your they their he she not but if then so do does did can will would should could have has had what which who when where how all any some more most other into out up down over just than too very about also there here its'.split(' '));
const tokens = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w));

function chunks(text: string): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= CHUNK) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + CHUNK);
    const para = clean.lastIndexOf('\n', end);
    if (para > i + CHUNK / 2 && end < clean.length) end = para;
    out.push(clean.slice(i, end).trim());
    i = end;
  }
  return out.filter(Boolean);
}

function walk(dir: string, out: string[], depth = 0) {
  if (depth > 6 || out.length > 3000) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (TEXT_EXT.test(e.name)) out.push(p);
  }
}

export function rebuildKnowledge(store: any) {
  const next: Doc[] = [];
  const add = (source: string, kind: Doc['kind'], text: string, at?: string) => {
    chunks(text).forEach((c, n) => next.push({ id: `${kind}:${source}:${n}`, source, kind, text: c, at }));
  };
  const projects = store?.projects || [];
  const projectName = (id: string) => projects.find((p: any) => p.id === id)?.name || 'Project';
  for (const p of projects) add(`Project: ${p.name}`, 'project', [p.name, p.description, p.goal].filter(Boolean).join('\n'));
  for (const c of store?.cards || []) {
    const notes = (c.notes || []).map((n: any) => `${n.kind === 'result' ? 'Finished work' : 'Note'} (${n.author}): ${n.text}`).join('\n\n');
    add(`Card: ${c.title} (${projectName(c.projectId)}, ${c.column})`, 'card', `${c.title}\n${c.details || ''}\n\n${notes}`, c.doneAt || c.createdAt);
  }
  for (const room of store?.nexus?.rooms || []) {
    const plans = (room.messages || []).filter((m: any) => m.kind === 'plan').map((m: any) => m.text);
    const talk = (room.messages || []).slice(-80).map((m: any) => `${m.author}: ${m.text}`).join('\n');
    if (plans.length) add(`Nexus plan: ${room.name}`, 'nexus', plans.join('\n\n'), room.updatedAt);
    if (talk) add(`Nexus: ${room.name}`, 'nexus', talk, room.updatedAt);
  }
  const files: string[] = [];
  for (const f of folders) walk(f, files);
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.size > MAX_FILE) continue;
      let text = fs.readFileSync(f, 'utf-8');
      if (/\.html?$/i.test(f)) text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
      const folder = folders.find((d) => f.startsWith(d)) || '';
      add(`File: ${path.relative(path.dirname(folder), f).replace(/\\/g, '/')}`, 'file', text, st.mtime.toISOString());
    } catch {}
  }

  const nextPostings = new Map<string, Map<number, number>>();
  const nextLengths: number[] = [];
  next.forEach((d, i) => {
    const t = tokens(`${d.source} ${d.text}`);
    nextLengths.push(t.length);
    for (const w of t) {
      let m = nextPostings.get(w);
      if (!m) nextPostings.set(w, (m = new Map()));
      m.set(i, (m.get(i) || 0) + 1);
    }
  });
  docs = next;
  postings = nextPostings;
  lengths = nextLengths;
  avgLen = nextLengths.reduce((a, b) => a + b, 0) / Math.max(1, nextLengths.length);
  builtAt = Date.now();
  fileCount = files.length;
}

export function searchKnowledge(query: string, limit = 5, skipSource?: string): { source: string; text: string; score: number }[] {
  const q = [...new Set(tokens(query))];
  if (!q.length || !docs.length) return [];
  const N = docs.length;
  const scores = new Map<number, number>();
  const k1 = 1.4;
  const b = 0.75;
  for (const w of q) {
    const m = postings.get(w);
    if (!m) continue;
    const idf = Math.log(1 + (N - m.size + 0.5) / (m.size + 0.5));
    for (const [i, tf] of m) scores.set(i, (scores.get(i) || 0) + (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * lengths[i]) / avgLen)));
  }
  const seen = new Set<string>();
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([i, score]) => ({ ...docs[i], score }))
    .filter((d) => d.score > 1.5 && !(skipSource && d.source.startsWith(skipSource)) && !seen.has(d.source) && seen.add(d.source))
    .slice(0, limit)
    .map(({ source, text, score }) => ({ source, text, score: Math.round(score * 10) / 10 }));
}

// The block added to a teammate's brief: the few most relevant pieces, kept short.
export function knowledgeFor(query: string, skipSource?: string): string {
  const hits = searchKnowledge(query, 4, skipSource);
  if (!hits.length) return '';
  let out = "\n\n# From your studio's knowledge base (use if relevant; it may be out of date)\n";
  for (const h of hits) {
    const piece = `\n[${h.source}]\n${h.text.slice(0, 700)}\n`;
    if (out.length + piece.length > 2800) break;
    out += piece;
  }
  return out;
}

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function registerKnowledgeRoutes(app: Express, getStore: () => any) {
  const rebuild = () => {
    try {
      rebuildKnowledge(getStore());
    } catch {}
  };
  setTimeout(rebuild, 4000).unref?.();
  setInterval(rebuild, 10 * 60 * 1000).unref?.();

  app.get('/api/knowledge', (_req, res) => {
    const by = (k: Doc['kind']) => new Set(docs.filter((d) => d.kind === k).map((d) => d.source)).size;
    res.json({ folders, defaultFolder: DEFAULT_FOLDER, builtAt: builtAt ? new Date(builtAt).toISOString() : undefined, pieces: docs.length, files: fileCount, cards: by('card'), nexus: by('nexus'), projects: by('project') });
  });
  app.get('/api/knowledge/search', (req, res) => {
    res.json({ results: searchKnowledge(String(req.query.q || ''), 8) });
  });
  app.post('/api/knowledge/rebuild', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only from this computer.' });
    rebuild();
    res.json({ ok: true, pieces: docs.length });
  });
  app.post('/api/knowledge/folders', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only from this computer.' });
    const dir = String(req.body?.folder || '').trim().replace(/^"|"$/g, '');
    if (req.body?.remove) folders = folders.filter((f) => f !== dir);
    else {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return res.status(400).json({ error: "That folder wasn't found on this PC." });
      if (!folders.includes(dir)) folders.push(dir);
    }
    saveFolders();
    rebuild();
    res.json({ folders, pieces: docs.length });
  });
}
