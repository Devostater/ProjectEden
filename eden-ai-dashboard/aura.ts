// Aura (Ramen VR's Unreal Engine assistant) as a teammate.
// Aura has no chat API for other apps; its official route is "Aura IDE MCP": its Unreal tools are given to
// Claude Code. So an Aura teammate is Claude (your Claude plan) with Aura's tools, and Aura's own specialist
// agents (Blueprint Agent, Python Agent, …) run on your Aura subscription.
//   aura        inspect & plan: reads assets, Blueprints, logs and code; changes nothing (unreal_inspector)
//   aura-build  can also change the project (unreal_editor). Nova_Pilot isn't in git, so there is no undo.
// The Aura app must be open (it runs the Unreal editor in the background for the project).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_CANDIDATES = [
  process.env.AURA_PLUGIN_DIR || '',
  'C:/Unreal Engine 5/UE_5.8/Engine/Plugins/Marketplace/Aura',
  'C:/Program Files/Epic Games/UE_5.8/Engine/Plugins/Marketplace/Aura',
].filter(Boolean);
const MCP_FILE = path.join(APP_DIR, '.eden-aura-mcp.json');
const AURA_URL = 'http://127.0.0.1:41200';

export const AURA_MODELS = ['aura', 'aura-build'];
export const isAuraModel = (model: string) => AURA_MODELS.includes(model);

function pluginDir(): string | null {
  return PLUGIN_CANDIDATES.find((d) => fs.existsSync(path.join(d, 'MCP', 'unreal_inspector.py'))) || null;
}
export const auraInstalled = () => !!pluginDir();

// Is the Aura app open? (Its tools only work while it is.) Cached for 20 seconds.
let up = { ok: false, at: 0, project: '' };
export async function auraRunning(): Promise<boolean> {
  if (Date.now() - up.at < 20000) return up.ok;
  try {
    const r = await fetch(`${AURA_URL}/api/headless/status`, { signal: AbortSignal.timeout(2500) });
    const d: any = await r.json();
    up = { ok: r.ok && d?.status === 'running', at: Date.now(), project: String(d?.project || '') };
  } catch {
    up = { ok: false, at: Date.now(), project: '' };
  }
  return up.ok;
}
export const auraProject = () => path.basename(up.project || '', '.uproject');

// Arguments for `claude -p` that give it Aura's tools.
export function auraCliArgs(model: string): string {
  const dir = pluginDir();
  if (!dir) throw new Error("Aura's Unreal plugin wasn't found on this PC.");
  const python = path.join(dir, 'PortablePython', 'Windows', 'python.exe');
  const server = (name: string) => ({ type: 'stdio', command: python, args: [path.join(dir, 'MCP', `${name}.py`)] });
  const servers: Record<string, unknown> = { unreal_inspector: server('unreal_inspector') };
  if (model === 'aura-build') servers.unreal_editor = server('unreal_editor');
  fs.writeFileSync(MCP_FILE, JSON.stringify({ mcpServers: servers }, null, 2), 'utf-8');
  const allowed = Object.keys(servers).map((s) => `mcp__${s}`).join(' ');
  return `--mcp-config "${MCP_FILE}" --strict-mcp-config --allowedTools "${allowed}"`;
}

export const auraSystemNote = (model: string) =>
  `You are working through Aura, an Unreal Engine assistant, on the open Unreal project${auraProject() ? ` "${auraProject()}"` : ''}. ` +
  `You DO have Aura's Unreal tools (mcp__unreal_inspector${model === 'aura-build' ? ', mcp__unreal_editor' : ''}): always use them to look at the real project before answering, instead of guessing. ` +
  `Any instruction below saying you can only reply with text is about the hub app itself (its pages and files), not about these Unreal tools. ` +
  (model === 'aura-build'
    ? 'You may change the project when the task asks for it. The project has no version control, so make only the changes asked for, and list every change you made at the end.'
    : 'Do not change the project: inspect, review and plan only. If the task needs changes, describe them as clear steps instead.');
