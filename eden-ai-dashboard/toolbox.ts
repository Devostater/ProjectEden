// A project's own toolbox: its tools (scripts/commands run in its folder), its connections (keys and endpoints
// such as Azure AI that only this project uses) and its links. Nothing here is shared between projects.
//
// Keys live in C:\AZI\Security\Keys\<project folder>\.env, never in the project's repo or Eden's store, and the
// page only ever sees their names. A tool runs with that project's keys and WITHOUT Eden's own keys (GitHub,
// Gemini, Claude, OpenAI…), so a project's script can't use or leak Eden's accounts.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import type { Project, ProjectTool, ProjectLink } from './src/types/index';
import { AZI_ROOT, folderName, dirForProject } from './newproject';
import { runWithSpendingControl, UnconfirmedPaidRequestError, type GenerateRequest } from './providers';
import { logActivity } from './activity';

interface Store {
  projects?: Project[];
}

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const KEYS_ROOT = () => path.join(AZI_ROOT, 'Security', 'Keys');
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_OUT = 64 * 1024;

// From this computer, and not from some other website open in a browser here (those requests carry that site's
// Origin). Running commands and saving keys must never be triggerable by a web page.
function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// The project's folder in C:\AZI: by its GitHub repo name, else by its name. '' when there is none.
export function projectDir(p: Project): string {
  return dirForProject(p);
}
// Where this project's keys live. Keyed by folder (or name) so it matches Security\Keys\<Project> made at setup.
function keysFile(p: Project): string {
  const dir = projectDir(p);
  return path.join(KEYS_ROOT(), dir ? path.basename(dir) : folderName(p.name) || p.id, '.env');
}

// Minimal .env reader/writer: NAME=value lines; comments and blank lines are kept.
function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  } catch {
    /* no keys yet */
  }
  return out;
}
function writeEnvValue(file: string, name: string, value: string | null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  } catch {
    lines = ['# Keys for this project only. Eden gives them to this project\'s tools; nothing else sees them.'];
  }
  const re = new RegExp(`^\\s*${name}\\s*=`);
  const quoted = value === null ? null : /[\s#"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const i = lines.findIndex((l) => re.test(l));
  if (quoted === null) {
    if (i >= 0) lines.splice(i, 1);
  } else if (i >= 0) lines[i] = `${name}=${quoted}`;
  else lines.push(`${name}=${quoted}`);
  fs.writeFileSync(file, lines.filter((l, n) => l !== '' || n < lines.length - 1).join('\n') + '\n', 'utf-8');
}

// Eden's own keys (from its .env.local, plus anything that looks like a secret) are removed before a project's
// tool runs, so only the project's keys reach it.
function cleanEnv(): NodeJS.ProcessEnv {
  const edenKeys = new Set(Object.keys(readEnv(path.join(APP_DIR, '.env.local'))));
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (edenKeys.has(k)) continue;
    if (/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_PAT)$/i.test(k) || /^(GITHUB|GEMINI|GOOGLE|ANTHROPIC|OPENAI|CLAUDE|AZURE|AWS|EDEN)_/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

// Ready-made connection kinds: the key names a service usually needs.
export const CONNECTION_PRESETS: { id: string; label: string; keys: string[] }[] = [
  { id: 'azure-openai', label: 'Azure AI / Azure OpenAI', keys: ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_VERSION'] },
  { id: 'openai', label: 'OpenAI', keys: ['OPENAI_API_KEY'] },
  { id: 'anthropic', label: 'Anthropic (Claude)', keys: ['ANTHROPIC_API_KEY'] },
  { id: 'gemini', label: 'Google Gemini', keys: ['GEMINI_API_KEY'] },
  { id: 'elevenlabs', label: 'ElevenLabs (voice)', keys: ['ELEVENLABS_API_KEY'] },
  { id: 'firebase', label: 'Firebase', keys: ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY'] },
];

// ---- A project's own AI connection ---------------------------------------------------------------------
// When a project is set to use one of its connections, its cards are answered by that service with the project's
// own keys (from Security\Keys), not by Eden's team AIs or Eden's keys.

type AiKind = NonNullable<Project['ai']>['use'];
const AI_KINDS: Record<AiKind, { label: string; needs: string[] }> = {
  'azure-openai': { label: 'Azure AI', needs: ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT'] },
  openai: { label: 'OpenAI', needs: ['OPENAI_API_KEY'] },
  anthropic: { label: 'Claude (Anthropic)', needs: ['ANTHROPIC_API_KEY'] },
  gemini: { label: 'Google Gemini', needs: ['GEMINI_API_KEY'] },
};
export const projectAiLabel = (kind: string) => AI_KINDS[kind as AiKind]?.label || kind;

// Which of the project's connections have every key they need.
function aiReadiness(p: Project) {
  const env = readEnv(keysFile(p));
  return (Object.keys(AI_KINDS) as AiKind[]).map((kind) => ({ kind, label: AI_KINDS[kind].label, needs: AI_KINDS[kind].needs, missing: AI_KINDS[kind].needs.filter((k) => !env[k]) }));
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, what: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  } catch (err: any) {
    throw new UnconfirmedPaidRequestError(`${what} could not be reached (${err?.name === 'TimeoutError' ? 'no answer in 3 minutes' : err?.message || 'network error'}).`);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = `${what} answered ${res.status}: ${data?.error?.message || data?.message || res.statusText}`;
    if (res.status === 408 || res.status >= 500) throw new UnconfirmedPaidRequestError(message);
    throw new Error(message);
  }
  return data;
}

// Answers with the project's own connection. Returns null when the project uses the team's AIs.
// Throws (with a message a person can act on) when the connection is chosen but not usable.
export async function generateForProject(p: Project, req: GenerateRequest & { prompt: string }): Promise<{ text: string; tokens?: number; via: string; notice?: string } | null> {
  const kind = p.ai?.use;
  if (!kind || !AI_KINDS[kind]) return null;
  const provider = kind === 'gemini' ? 'google' : kind === 'anthropic' ? 'anthropic' : 'openai';
  const label = AI_KINDS[kind].label;
  const result = await runWithSpendingControl({ provider, mode: 'api', label }, req, kind, async () => ({
    ...await sendProjectRequest(p, kind, req), model: kind, provider,
  }));
  return { ...result, via: result.notice ? 'Ollama' : `${label} (this project's own connection)` };
}

async function sendProjectRequest(p: Project, kind: AiKind, req: GenerateRequest & { prompt: string }) {
  const env = readEnv(keysFile(p));
  const missing = AI_KINDS[kind].needs.filter((k) => !env[k]);
  const label = AI_KINDS[kind].label;
  if (missing.length) throw new Error(`${p.name} is set to use its own ${label} connection, but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set (project → Toolbox → Connections).`);
  const max = req.maxTokens ?? 4096;
  const chat = [...(req.system ? [{ role: 'system', content: req.system }] : []), { role: 'user', content: req.prompt }];

  if (kind === 'azure-openai' || kind === 'openai') {
    const azure = kind === 'azure-openai';
    const url = azure
      ? `${env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(env.AZURE_OPENAI_DEPLOYMENT)}/chat/completions?api-version=${encodeURIComponent(env.AZURE_OPENAI_API_VERSION || '2024-10-21')}`
      : 'https://api.openai.com/v1/chat/completions';
    if (azure && !/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url)) throw new Error('AZURE_OPENAI_ENDPOINT must start with https://');
    const headers: Record<string, string> = azure ? { 'api-key': env.AZURE_OPENAI_API_KEY } : { authorization: `Bearer ${env.OPENAI_API_KEY}` };
    const base = azure ? { messages: chat } : { model: env.OPENAI_MODEL || 'gpt-5', messages: chat };
    let data: any;
    try {
      data = await postJson(url, headers, { ...base, max_completion_tokens: max }, label);
    } catch (err: any) {
      // Older deployments only know max_tokens.
      if (err instanceof UnconfirmedPaidRequestError || !/max_completion_tokens|unrecognized|unsupported/i.test(err.message)) throw err;
      data = await postJson(url, headers, { ...base, max_tokens: max }, label);
    }
    return { text: data.choices?.[0]?.message?.content ?? '', tokens: data.usage?.total_tokens };
  }
  if (kind === 'anthropic') {
    const data = await postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: max, ...(req.system ? { system: req.system } : {}), messages: [{ role: 'user', content: req.prompt }] },
      label,
    );
    const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return { text, tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) };
  }
  // gemini
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': env.GEMINI_API_KEY },
    { ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}), contents: [{ role: 'user', parts: [{ text: req.prompt }] }], generationConfig: { maxOutputTokens: max } },
    label,
  );
  const text = (data.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || '').join('');
  return { text, tokens: data.usageMetadata?.totalTokenCount };
}

interface RunState {
  id: string;
  toolId: string;
  projectId: string;
  status: 'running' | 'ok' | 'failed';
  exitCode?: number | null;
  output: string;
  startedAt: string;
  finishedAt?: string;
}
const runs = new Map<string, RunState>(); // latest run per project+tool

export function registerToolboxRoutes(app: Express, getStore: () => Store, save: () => void) {
  const find = (id: string) => (getStore().projects || []).find((p) => p.id === id);

  // The toolbox (tools and links are stored with the project; keys only by name, from Security\Keys).
  app.get('/api/projects/:id/toolbox', (req, res) => {
    const p = find(req.params.id);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    const file = keysFile(p);
    const env = readEnv(file);
    res.json({
      folder: projectDir(p),
      keysFile: file,
      keys: Object.keys(env).map((name) => ({ name, set: !!env[name] })),
      tools: p.toolbox?.tools || [],
      links: p.toolbox?.links || [],
      presets: CONNECTION_PRESETS,
      ai: p.ai || null,
      aiOptions: aiReadiness(p),
      runs: (p.toolbox?.tools || []).map((t) => runs.get(`${p.id}:${t.id}`)).filter(Boolean),
    });
  });

  // Save tools and links. Adding or changing a command is only done from this PC.
  app.post('/api/projects/:id/toolbox', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Tools can only be changed on this computer.' });
    const p = find(req.params.id);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    const tools: ProjectTool[] = (Array.isArray(req.body?.tools) ? req.body.tools : []).slice(0, 30).map((t: any) => ({
      id: text(t?.id, 40) || newId('tool'),
      name: text(t?.name, 60) || 'Tool',
      command: text(t?.command, 1000),
      ...(text(t?.description, 200) ? { description: text(t.description, 200) } : {}),
      ...(text(t?.folder, 200) && !text(t.folder, 200).includes('..') ? { folder: text(t.folder, 200) } : {}),
    })).filter((t: ProjectTool) => t.command);
    const links: ProjectLink[] = (Array.isArray(req.body?.links) ? req.body.links : []).slice(0, 30).map((l: any) => ({
      id: text(l?.id, 40) || newId('link'),
      title: text(l?.title, 80) || 'Link',
      url: text(l?.url, 500),
    })).filter((l: ProjectLink) => /^https?:\/\//i.test(l.url));
    p.toolbox = { tools, links };
    p.updatedAt = new Date().toISOString();
    save();
    res.json({ tools, links });
  });

  // Set (or remove, with value null) one key for this project. Only from this PC; the value is never sent back.
  app.post('/api/projects/:id/keys', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Keys can only be changed on this computer.' });
    const p = find(req.params.id);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    const name = text(req.body?.name, 64).toUpperCase();
    if (!ENV_NAME.test(name)) return res.status(400).json({ error: 'Use a name like AZURE_OPENAI_API_KEY (capitals, digits, _).' });
    const value = req.body?.value === null ? null : typeof req.body?.value === 'string' ? req.body.value.replace(/[\r\n]/g, '').slice(0, 4000) : '';
    try {
      writeEnvValue(keysFile(p), name, value);
    } catch (err: any) {
      return res.status(500).json({ error: `Could not save the key: ${err.message}` });
    }
    logActivity('info', `${p.name}: key ${name} ${value === null ? 'removed' : value ? 'saved' : 'added (empty)'} (in Security\\Keys, project only).`);
    res.json({ ok: true });
  });

  // Which AI works this project's cards: use '' for the team's usual AIs, or one of the project's connections.
  app.post('/api/projects/:id/ai', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'This can only be changed on this computer.' });
    const p = find(req.params.id);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    const use = text(req.body?.use, 30);
    if (use && !(use in AI_KINDS)) return res.status(400).json({ error: 'Unknown connection.' });
    if (use) p.ai = { use: use as AiKind, fallback: req.body?.fallback === true };
    else delete p.ai;
    p.updatedAt = new Date().toISOString();
    save();
    logActivity('info', use ? `${p.name}: cards now use the project's own ${projectAiLabel(use)} connection${p.ai?.fallback ? ' (team AIs as backup)' : ' only'}.` : `${p.name}: cards use the team's usual AIs again.`);
    res.json({ ai: p.ai || null });
  });

  // One tiny message through the project's connection, to prove it works. Sends nothing about the project.
  app.post('/api/projects/:id/ai/test', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    const p = find(req.params.id);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    if (!p.ai?.use) return res.status(400).json({ error: 'This project uses the team\'s AIs. Pick a connection first.' });
    try {
      const r = await generateForProject(p, { prompt: 'Reply with the single word: OK', maxTokens: 20 });
      if (r?.notice) return res.status(503).json({ error: r.notice });
      res.json({ ok: true, via: r?.via, reply: (r?.text || '').trim().slice(0, 80) });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ---- Preview: look inside the project's folder (read-only) --------------------------------------------
  // Only inside the project's folder; never .git, node_modules or anything that looks like a secret.
  const HIDDEN_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.gradle', 'Library', 'Temp', 'obj']);
  // Also Eden's and LYRA's own state files (pairing codes, device lists, tablet PINs): not project content.
  const SECRETISH = /^(\.env(\..+)?|.*\.(pem|key|keystore|jks|pfx|p12)|keystore\.properties|id_rsa.*|.*credentials.*\.json|\.eden-.*|\.nexusflow-store\.json|tablet-(pin|session)\.txt|.*\.secret.*)$/i;
  const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp' };
  const MEDIA_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.pdf': 'application/pdf' };
  const MAX_TEXT = 512 * 1024;
  // Eden's own state folders and LYRA's browser profile (it can hold sign-in cookies) are never shown.
  const hiddenDir = (name: string) => HIDDEN_DIRS.has(name) || /^\.eden-/i.test(name) || name === 'float-profile';
  // Resolves a path inside the project, or null when it leaves the folder or touches something hidden.
  const inside = (p: Project, rel: string): { base: string; full: string } | null => {
    const base = projectDir(p);
    if (!base) return null;
    const full = path.resolve(base, rel || '.');
    const relative = path.relative(base, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const parts = relative.split(path.sep).filter(Boolean);
    if (parts.some((x) => hiddenDir(x)) || (parts.length && SECRETISH.test(parts[parts.length - 1]))) return null;
    return { base, full };
  };

  app.get('/api/projects/:id/files', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Files can only be browsed on this computer.' });
    const p = find(req.params.id);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    const at = inside(p, String(req.query.dir || ''));
    if (!at) return res.status(400).json({ error: projectDir(p) ? 'That folder is not available.' : `${p.name} has no folder in ${AZI_ROOT}.` });
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(at.full, { withFileTypes: true });
    } catch (err: any) {
      return res.status(400).json({ error: `Could not open that folder: ${err.message}` });
    }
    const list = entries
      .filter((e) => !(e.isDirectory() && hiddenDir(e.name)) && !(e.isFile() && SECRETISH.test(e.name)) && (e.isDirectory() || e.isFile()))
      .map((e) => {
        let size = 0;
        let modified = '';
        try {
          const s = fs.statSync(path.join(at.full, e.name));
          size = s.size;
          modified = s.mtime.toISOString();
        } catch {}
        return { name: e.name, dir: e.isDirectory(), size, modified };
      })
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
      .slice(0, 500);
    res.json({ root: at.base, dir: path.relative(at.base, at.full).split(path.sep).join('/'), entries: list });
  });

  // One file: text comes back as JSON (first 512 KB); images, video, audio and PDF come back as the file itself.
  app.get('/api/projects/:id/file', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Files can only be opened on this computer.' });
    const p = find(req.params.id);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    const at = inside(p, String(req.query.path || ''));
    if (!at || !String(req.query.path || '')) return res.status(400).json({ error: 'That file is not available.' });
    let stat: fs.Stats;
    try {
      stat = fs.statSync(at.full);
    } catch {
      return res.status(404).json({ error: 'File not found.' });
    }
    if (!stat.isFile()) return res.status(400).json({ error: 'That is a folder.' });
    const ext = path.extname(at.full).toLowerCase();
    const media = IMAGE_TYPES[ext] || MEDIA_TYPES[ext];
    if (media) {
      res.setHeader('Content-Type', media);
      res.setHeader('Cache-Control', 'no-store');
      // SVGs can carry scripts: shown as an image only, never as a page.
      if (ext === '.svg') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      return fs.createReadStream(at.full).pipe(res);
    }
    const fd = fs.openSync(at.full, 'r');
    const buf = Buffer.alloc(Math.min(stat.size, MAX_TEXT));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    // Binary files (a zero byte in the first 8 KB) aren't shown as text.
    if (buf.subarray(0, 8192).includes(0)) return res.json({ kind: 'binary', size: stat.size, modified: stat.mtime.toISOString() });
    res.json({ kind: 'text', content: buf.toString('utf-8'), size: stat.size, truncated: stat.size > MAX_TEXT, modified: stat.mtime.toISOString() });
  });

  // Run a tool in the project's folder with the project's keys (and not Eden's). Only from this PC.
  app.post('/api/projects/:id/tools/:toolId/run', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Tools only run from this computer.' });
    const p = find(req.params.id);
    const tool = p?.toolbox?.tools.find((t) => t.id === req.params.toolId);
    if (!p || !tool) return res.status(404).json({ error: 'Tool not found.' });
    const base = projectDir(p);
    if (!base) return res.status(400).json({ error: `${p.name} has no folder in ${AZI_ROOT} to run in.` });
    const cwd = tool.folder ? path.resolve(base, tool.folder) : base;
    if (path.relative(base, cwd).startsWith('..') || !fs.existsSync(cwd)) return res.status(400).json({ error: 'That tool\'s folder is not inside the project.' });
    const key = `${p.id}:${tool.id}`;
    if (runs.get(key)?.status === 'running') return res.status(409).json({ error: 'It is already running.' });
    const run: RunState = { id: newId('run'), toolId: tool.id, projectId: p.id, status: 'running', output: '', startedAt: new Date().toISOString() };
    runs.set(key, run);
    const env = { ...cleanEnv(), ...readEnv(keysFile(p)), AZI_PROJECT: p.name, AZI_PROJECT_DIR: base };
    const child = spawn(tool.command, { cwd, env, shell: true, windowsHide: true });
    const add = (b: Buffer) => {
      run.output = (run.output + b.toString()).slice(-MAX_OUT);
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => {
      add(Buffer.from('\n[Stopped by Eden after 15 minutes]\n'));
      child.kill();
    }, 15 * 60 * 1000);
    child.on('error', (err) => add(Buffer.from(`\n[Could not start: ${err.message}]\n`)));
    child.on('close', (code) => {
      clearTimeout(timer);
      run.status = code === 0 ? 'ok' : 'failed';
      run.exitCode = code;
      run.finishedAt = new Date().toISOString();
      logActivity(code === 0 ? 'done' : 'error', `${p.name}: tool "${tool.name}" ${code === 0 ? 'finished' : `failed (exit ${code})`}.`);
    });
    logActivity('work', `${p.name}: running tool "${tool.name}".`);
    res.json({ run });
  });

  app.get('/api/projects/:id/tools/:toolId/run', (req, res) => {
    const run = runs.get(`${req.params.id}:${req.params.toolId}`);
    res.json({ run: run || null });
  });
}
