// GitHub connection helpers: accept any way of naming a repo, attach the user's token when there is
// one, and turn GitHub's status codes into messages a person can act on.
import { spawnSync } from 'child_process';

export interface RepoRef {
  repo: string; // "owner/name"
  path: string; // path inside the repo, '' for the root
}

// Accepts "owner/repo", https://github.com/owner/repo(.git), .../tree/<branch>/<path>,
// .../blob/<branch>/<file>, and git@github.com:owner/repo.git.
export function parseRepo(input: string): RepoRef {
  let s = (input || '').trim();
  s = s.replace(/^git@github\.com:/i, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  s = s.split(/[?#]/)[0].replace(/\/+$/, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) {
    throw new Error('Enter a repository as owner/name or paste its GitHub link.');
  }
  const repo = `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
  // /tree/<branch>/<path...> or /blob/<branch>/<path...>
  const path = (parts[2] === 'tree' || parts[2] === 'blob') && parts.length > 4 ? parts.slice(4).join('/') : '';
  return { repo, path };
}

let ghCliToken: string | null | undefined;

// Token from Connect AI (saved in .env.local), or from the GitHub CLI if you're signed in there.
export function githubToken(refresh = false): { token: string; source: 'saved' | 'gh' } | null {
  const saved = process.env.GITHUB_TOKEN;
  if (saved && !/^MY_[A-Z_]+$/.test(saved)) return { token: saved, source: 'saved' };
  if (refresh || ghCliToken === undefined) {
    const r = spawnSync('gh auth token', { shell: true, timeout: 10000, windowsHide: true, encoding: 'utf-8' });
    ghCliToken = r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  }
  return ghCliToken ? { token: ghCliToken, source: 'gh' } : null;
}

export function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Eden-AI-Hub',
  };
  const t = githubToken();
  if (t) headers.Authorization = `Bearer ${t.token}`;
  return headers;
}

// GitHub rejects a request outright (401) when the token is wrong or expired, even for public
// repositories. In that case, ask again without the token so public repositories keep working.
export async function githubFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: githubHeaders() });
  if (res.status !== 401 || !githubToken()) return res;
  const { Authorization, ...anonymous } = githubHeaders();
  return fetch(url, { headers: anonymous });
}

export function githubError(status: number, repo: string, remaining?: string | null): string {
  const connected = !!githubToken();
  if (status === 401) return 'GitHub rejected the saved token. Replace it in Account → Connections.';
  if (status === 403 || status === 429) {
    return remaining === '0'
      ? connected
        ? 'GitHub hourly limit reached. Try again in a little while.'
        : 'GitHub hourly limit for unconnected use reached. Connect GitHub in Account → Connections for a much higher limit.'
      : `GitHub refused access to ${repo}. The token may not have permission for this repository.`;
  }
  if (status === 404) {
    return connected
      ? `Couldn't find ${repo}. Check the name, and that your token can see this repository.`
      : `Couldn't find ${repo}. Check the name. If it's a private repository, connect GitHub in Account → Connections.`;
  }
  return `GitHub returned an error (${status}) for ${repo}.`;
}

export async function githubStatus(refresh = false) {
  const t = githubToken(refresh);
  if (!t) return { connected: false, login: '', source: '' };
  try {
    const res = await fetch('https://api.github.com/user', { headers: githubHeaders() });
    if (!res.ok) return { connected: false, login: '', source: t.source, error: githubError(res.status, 'your account') };
    const user: any = await res.json();
    return { connected: true, login: user.login as string, source: t.source };
  } catch {
    return { connected: false, login: '', source: t.source, error: 'Could not reach GitHub.' };
  }
}
