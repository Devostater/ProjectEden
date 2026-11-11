// Claude Code running on a model on this PC, the same way `ollama launch claude` does it: Claude Code does
// the work (reading, editing, tools) and Ollama answers in place of Anthropic's servers. Free, and works
// offline. Used for code updates on this PC.
import { localModels } from './offline';

const OLLAMA = process.env.OLLAMA_HOST?.startsWith('http') ? process.env.OLLAMA_HOST : 'http://127.0.0.1:11434';

// Best local model for agent work (it must be good at using tools): gpt-oss-20b, then a coder model.
export function localAgentModel(): string | null {
  const names = localModels()
    .filter((id) => id.startsWith('x:ollama:'))
    .map((id) => id.replace('x:ollama:', ''));
  return names.find((n) => /gpt-oss:20b/.test(n)) || names.find((n) => /gpt-oss/.test(n)) || names.find((n) => /qwen2\.5-coder:7b|coder/.test(n)) || null;
}

// Environment for a `claude` process so it talks to Ollama instead of Anthropic.
export function localClaudeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANTHROPIC_BASE_URL: OLLAMA,
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_API_KEY: '',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}
