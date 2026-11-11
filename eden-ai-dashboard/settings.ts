// API key management: lets the app's Settings page save provider keys to .env.local.
// Keys are never sent back to the browser (only a masked preview), and writes are
// only accepted from this machine (loopback), since the server listens on 0.0.0.0.
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { providerDetails, providerUsage } from './providers';

const ENV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local');

export const SETTING_KEYS = [
  { key: 'ANTHROPIC_API_KEY', label: 'Claude (Anthropic)', secret: true, help: 'console.anthropic.com → API Keys' },
  { key: 'GEMINI_API_KEY', label: 'Gemini (Google)', secret: true, help: 'aistudio.google.com → Get API key' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI', secret: true, help: 'platform.openai.com → API keys' },
  { key: 'GITHUB_TOKEN', label: 'GitHub token (optional)', secret: true, help: 'For private repo sync' },
  { key: 'OPENAI_MODEL', label: 'OpenAI model id', secret: false, help: 'Default: gpt-5' },
  { key: 'DEFAULT_MODEL', label: 'Default model', secret: false, help: 'e.g. claude-sonnet-5-5' },
  { key: 'CLAUDE_DAILY_LIMIT', label: 'Claude daily message budget', secret: false, help: 'Default: 100' },
  { key: 'GEMINI_DAILY_LIMIT', label: 'Gemini daily message budget', secret: false, help: 'Default: 100' },
  { key: 'CHATGPT_DAILY_LIMIT', label: 'ChatGPT daily message budget', secret: false, help: 'Default: 100' },
  { key: 'OWNER_NAME', label: 'Your name', secret: false, help: 'Shown in the hub' },
  { key: 'STUDIO_NAME', label: 'Studio name', secret: false, help: 'Shown in the hub' },
  { key: 'TERMINAL_ENABLED', label: 'Terminal', secret: false, help: '1 turns the terminal on' },
] as const;

const ALLOWED = new Set<string>(SETTING_KEYS.map((k) => k.key));

function isLocal(req: Request): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function mask(v: string): string {
  return v.length <= 8 ? '••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

function isPlaceholder(v?: string) {
  return !v || /^MY_[A-Z_]+$/.test(v);
}

function writeEnvLocal(updates: Record<string, string>) {
  let lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(updates)) {
    const line = value ? `${key}="${value.replace(/["\r\n]/g, '')}"` : null;
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0) {
      if (line) lines[idx] = line;
      else lines.splice(idx, 1);
    } else if (line) {
      lines.push(line);
    }
  }
  lines = lines.filter((l, i) => l.trim() || i < lines.length - 1);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
}

// The sign-in command for each AI's own tool. These are fixed: the page can only choose which one.
const SIGN_IN: Record<string, { command: string; title: string }> = {
  anthropic: { command: 'claude auth login --claudeai', title: 'Sign in to Claude' },
  openai: { command: 'codex login', title: 'Sign in to ChatGPT' },
  google: { command: 'gemini', title: 'Sign in to Gemini' },
};

function fromOwnPage(req: Request): boolean {
  try {
    return !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function registerSettingsRoutes(app: Express) {
  // Opens the AI tool's own sign-in in a new window on this computer. The owner finishes it in their
  // browser; the hub never sees the password. Only this computer, and only the hub's own page, may ask.
  app.post('/api/connect/:provider/signin', (req, res) => {
    const target = SIGN_IN[req.params.provider];
    if (!target) return res.status(404).json({ error: 'Unknown AI.' });
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'Sign-in can only be started from the hub on this computer.' });
    try {
      const child =
        process.platform === 'win32'
          ? spawn('cmd.exe', ['/c', 'start', target.title, 'cmd', '/k', target.command], { detached: true, stdio: 'ignore', windowsHide: false })
          : spawn(target.command, { shell: true, detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: `Could not open the sign-in window: ${err?.message || 'unknown error'}` });
    }
  });

  app.get('/api/provider-usage', (req, res) => {
    res.json({ usage: providerUsage(req.query.refresh === '1') });
  });

  app.get('/api/settings', (req, res) => {
    res.json({
      providers: providerDetails(req.query.refresh === '1'),
      settings: SETTING_KEYS.map((s) => {
        const v = process.env[s.key];
        const set = !isPlaceholder(v);
        return { ...s, set, preview: set ? (s.secret ? mask(v!) : v) : '' };
      }),
    });
  });

  app.post('/api/settings', (req, res) => {
    if (!isLocal(req)) {
      return res.status(403).json({ error: 'Keys can only be changed from this computer.' });
    }
    const body = req.body || {};
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED.has(k) && typeof v === 'string') updates[k] = v.trim();
    }
    try {
      writeEnvLocal(updates);
    } catch (err: any) {
      return res.status(500).json({ error: `Could not write .env.local: ${err?.message}` });
    }
    for (const [k, v] of Object.entries(updates)) {
      if (v) process.env[k] = v;
      else delete process.env[k];
    }
    res.json({ ok: true });
  });
}
