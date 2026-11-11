import React, { useEffect, useState } from 'react';
import { UsageBar, useProviderUsage } from './UsageBars.tsx';
import { CheckCircle2, Circle, Save, Loader2, RefreshCw, ChevronDown, LogIn } from 'lucide-react';

interface Setting {
  key: string;
  label: string;
  secret: boolean;
  help: string;
  set: boolean;
  preview: string;
}

interface ProviderInfo {
  provider: 'anthropic' | 'google' | 'openai';
  cliInstalled: boolean;
  mode: 'subscription' | 'api' | 'off';
}

// How to connect each AI using a plan you already have (no API key, no extra bill).
const PLANS = {
  anthropic: {
    name: 'Claude',
    plan: 'Claude Pro / Max',
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'claude',
    loginNote: 'then type /login and sign in',
  },
  google: {
    name: 'Gemini',
    plan: 'Google account (free tier)',
    install: 'npm install -g @google/gemini-cli',
    login: 'gemini',
    loginNote: 'then choose "Login with Google"',
  },
  openai: {
    name: 'ChatGPT',
    plan: 'ChatGPT Plus / Pro',
    install: 'npm install -g @openai/codex',
    login: 'codex login',
    loginNote: 'and sign in with ChatGPT',
  },
};

const Code = ({ children }: { children: string }) => (
  <code className="block rounded-md bg-slate-100 px-3 py-2 font-mono text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">{children}</code>
);

export const SettingsView: React.FC<{ onSaved?: () => void }> = ({ onSaved }) => {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const usage = useProviderUsage();
  const [github, setGithub] = useState<{ connected: boolean; login: string; source: string; error?: string } | null>(null);
  const [githubToken, setGithubToken] = useState('');

  const loadGithub = (refresh = false) =>
    fetch(`/api/github/status${refresh ? '?refresh=1' : ''}`)
      .then((r) => r.json())
      .then(setGithub)
      .catch(() => {});
  const [settings, setSettings] = useState<Setting[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async (refresh = false) => {
    try {
      const d = await fetch(`/api/settings${refresh ? '?refresh=1' : ''}`).then((r) => r.json());
      setProviders(d.providers);
      setSettings(d.settings);
    } catch {
      setMessage({ ok: false, text: 'Could not reach the server.' });
    }
  };

  useEffect(() => {
    load();
    loadGithub();
  }, []);

  // Sign in with one click: opens the AI tool's sign-in window, then watches for it to finish.
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [signInNote, setSignInNote] = useState<{ provider: string; ok: boolean; text: string } | null>(null);
  const watching = React.useRef(0);

  const signIn = async (provider: string, name: string) => {
    setSigningIn(provider);
    setSignInNote(null);
    try {
      const res = await fetch(`/api/connect/${provider}/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not open the sign-in window.');
      setSignInNote({ provider, ok: true, text: `A sign-in window opened. Finish signing in to ${name} in your browser; this page updates by itself.` });
      // Check every few seconds for up to three minutes.
      const run = ++watching.current;
      for (let i = 0; i < 45 && run === watching.current; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const d = await fetch('/api/settings?refresh=1').then((r) => r.json()).catch(() => null);
        if (!d || run !== watching.current) continue;
        setProviders(d.providers);
        if (d.providers.find((p: ProviderInfo) => p.provider === provider)?.mode !== 'off') {
          setSignInNote({ provider, ok: true, text: `${name} is connected.` });
          onSaved?.();
          break;
        }
      }
    } catch (err: any) {
      setSignInNote({ provider, ok: false, text: err.message });
    } finally {
      setSigningIn(null);
    }
  };

  const recheck = async () => {
    setChecking(true);
    await Promise.all([load(true), loadGithub(true)]);
    setChecking(false);
    onSaved?.();
  };

  const save = async (updates: Record<string, string>) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setDraft({});
      setMessage({ ok: true, text: 'Saved.' });
      await load();
      await loadGithub(true);
      onSaved?.();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const dirty = Object.values(draft).some((v) => v.trim());

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Your AI</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use the subscriptions you already pay for. No API keys needed.</p>
        </div>
        <button onClick={recheck} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> Check again
        </button>
      </div>

      <div className="space-y-3">
        {providers.map((p) => {
          const info = PLANS[p.provider];
          const connected = p.mode !== 'off';
          return (
            <div key={p.provider} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                {connected ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-400" />}
                <div className="flex-1">
                  <div className="font-medium text-slate-900 dark:text-white">{info.name}</div>
                  <div className="text-sm text-slate-500">{info.plan}</div>
                </div>
                <span className={`text-sm ${connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                  {p.mode === 'subscription' ? 'Connected' : p.mode === 'api' ? 'Using API key' : p.cliInstalled ? 'Not signed in' : 'Not connected'}
                </span>
              </div>
              {connected && usage.find((u) => u.provider === p.provider) && (
                <div className="mt-4">
                  <UsageBar u={usage.find((u) => u.provider === p.provider)!} />
                </div>
              )}
              {!connected && (
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
                  {p.cliInstalled ? (
                    <>
                      <button
                        onClick={() => signIn(p.provider, info.name)}
                        disabled={signingIn !== null}
                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                      >
                        {signingIn === p.provider ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                        {signingIn === p.provider ? 'Waiting for you to sign in…' : `Sign in to ${info.name}`}
                      </button>
                      {signInNote?.provider === p.provider && (
                        <p role="status" className={signInNote.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{signInNote.text}</p>
                      )}
                      <p className="text-xs text-slate-500">
                        Or do it by hand: run <span className="font-mono">{info.login}</span> in a terminal {info.loginNote}, then click "Check again".
                      </p>
                    </>
                  ) : (
                    <>
                      <p>1. Run this once in a terminal:</p>
                      <Code>{info.install}</Code>
                      <p>2. Sign in: run <span className="font-mono">{info.login}</span> {info.loginNote}.</p>
                      <p>3. Click "Check again" above.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">GitHub</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Public repositories already work. Connect to use your private ones.</p>
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            {github?.connected ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-400" />}
            <div className="flex-1">
              <div className="font-medium text-slate-900 dark:text-white">GitHub</div>
              <div className="text-sm text-slate-500">{github?.connected ? `Signed in as ${github.login}` : 'Public repositories only'}</div>
            </div>
            <span className={`text-sm ${github?.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {github?.connected ? 'Connected' : 'Not connected'}
            </span>
            {github?.connected && github.source === 'saved' && (
              <button onClick={() => save({ GITHUB_TOKEN: '' })} disabled={saving} className="text-xs text-slate-500 hover:text-red-500">
                Disconnect
              </button>
            )}
          </div>
          {github?.error && <p className="mt-3 text-sm text-red-500">{github.error}</p>}
          {!github?.connected && (
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <p>
                1. Create a token at <span className="font-mono">github.com/settings/personal-access-tokens</span> with read-only
                "Contents" access to the repositories you want.
              </p>
              <p>2. Paste it here:</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="github_pat_..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  onClick={async () => {
                    await save({ GITHUB_TOKEN: githubToken.trim() });
                    setGithubToken('');
                  }}
                  disabled={!githubToken.trim() || saving}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  Connect
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} /> Advanced: API keys and daily budgets
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {settings.filter((s) => !['GITHUB_TOKEN', 'OWNER_NAME', 'STUDIO_NAME', 'TERMINAL_ENABLED'].includes(s.key)).map((s) => (
                <div key={s.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <div className="text-sm text-slate-700 dark:text-slate-300 sm:w-48">{s.label}</div>
                  <input
                    type={s.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={draft[s.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                    placeholder={s.set ? s.preview : 'Not set'}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  {s.set && (
                    <button onClick={() => save({ [s.key]: '' })} disabled={saving} className="text-xs text-slate-500 hover:text-red-500">
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => save(Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim())))}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </button>
              {message && <span className={`text-sm ${message.ok ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
