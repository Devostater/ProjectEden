export const DEFAULT_HUB_PORT = 3000;
export const DEFAULT_LYRA_PORT = 4777;
export const DEFAULT_OLLAMA_PORT = 11434;
export const DEFAULT_OLLAMA_URL = `http://127.0.0.1:${DEFAULT_OLLAMA_PORT}`;
export const DEFAULT_LM_STUDIO_URL = 'http://127.0.0.1:1234';

export function hubPort() {
  return Number(process.env.PORT) || DEFAULT_HUB_PORT;
}

export function lyraUrl() {
  return (process.env.LYRA_URL || `http://127.0.0.1:${DEFAULT_LYRA_PORT}`).replace(/\/+$/, '');
}
