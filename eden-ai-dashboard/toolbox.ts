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
