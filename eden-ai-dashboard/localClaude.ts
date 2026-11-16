// Claude Code running on a model on this PC, the same way `ollama launch claude` does it: Claude Code does
// the work (reading, editing, tools) and Ollama answers in place of Anthropic's servers. Free, and works
// offline. Used for code updates on this PC.
import { localModels, fitsNow } from './offline';

const OLLAMA = process.env.OLLAMA_HOST?.startsWith('http') ? process.env.OLLAMA_HOST : 'http://127.0.0.1:11434';

// Best local model for agent work (it must be good at using tools): a coder model that fits, or gpt-oss-20b when memory allows.
export function localAgentModel(): string | null {
  const names = localModels()
    .filter((id) => id.startsWith('x:ollama:') && fitsNow(id))
    .map((id) => id.replace('x:ollama:', ''));
  return names.find((n) => /qwen2\.5-coder:7b/.test(n)) || names.find((n) => /gpt-oss:20b/.test(n)) || names.find((n) => /gpt-oss/.test(n)) || names.find((n) => /coder/.test(n)) || null;
}

// Environment for a `claude` process so it talks to Ollama instead of Anthropic.
export function localClaudeEnv(model?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: OLLAMA,
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  // Removed, not blanked: a set-but-empty key still makes Claude Code warn and skip your claude.ai login.
  delete env.ANTHROPIC_API_KEY;
  // Claude Code only accepts Claude model names, so the run asks for "sonnet" and these point every Claude
  // name at the local model (what `ollama launch claude` does).
  if (model) for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']) env[k] = model;
  return env;
}

// A `claude` process on your Claude plan: without an API key, so it uses your claude.ai login (a key saved in
// Eden's settings would otherwise take over, switching off your plan and connectors).
export function planClaudeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}
