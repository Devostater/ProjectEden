import React, { useEffect, useState } from 'react';
import { THEMES } from '../themes.ts';
import { useGameOn, resetGame } from '../gameMode.ts';
import { User, Plug, Bot, GitBranch, SlidersHorizontal, Sun, Moon, Save, Loader2 } from 'lucide-react';
import { SettingsView } from './SettingsView.tsx';
import { ReposView } from './ReposView.tsx';
import { Sections } from './Sections.tsx';
import { ProfileCard } from './ProfileCard.tsx';
import { DevicesView } from './DevicesView.tsx';
import { RemoteView } from './RemoteView.tsx';
import { useInstallApp } from '../installApp.ts';
import { Download, CheckCircle2 } from 'lucide-react';

// Install the hub as its own app window (Chrome or Edge), with its own icon in the Start menu or dock.
const InstallCard: React.FC = () => {
  const app = useInstallApp();
  const [result, setResult] = useState('');
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-4">
        <img src="/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-900 dark:text-white">Install as an app</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {app.installed
              ? 'You are using the installed app.'
              : 'Open the hub in its own window with its own icon, like any other program. Needs Chrome or Edge.'}
          </p>
        </div>
        {app.installed ? (
          <span className="flex shrink-0 items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Installed
          </span>
        ) : app.canPrompt ? (
          <button
            onClick={async () => setResult((await app.install()) ? 'Installed. Look for Eden AI Hub in your Start menu.' : '')}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <Download className="h-4 w-4" /> Install
          </button>
        ) : null}
      </div>
      {!app.installed && !app.canPrompt && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
          {app.secure
            ? 'In Chrome or Edge, click the install icon at the right end of the address bar, or open the browser menu and choose "Install Eden AI Hub". If it is already installed, open it from your Start menu.'
            : 'Installing needs the hub opened at http://localhost:3000 on this computer. On your phone, use the Android app instead, or Chrome\'s menu → "Add to Home screen".'}
        </p>
      )}
      {result && <p role="status" className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{result}</p>}
    </section>
  );
};


export type AccountTab = 'account' | 'team' | 'connections' | 'github' | 'preferences';

interface AccountViewProps {
  tab: AccountTab;
  setTab: (tab: AccountTab) => void;
  darkMode: boolean;
  theme?: string;
  setTheme?: (id: string) => void;
  setDarkMode: (v: boolean) => void;
  team?: React.ReactNode; // the Team page (set up your AI teammates), shown under Team & AI
  workflows?: React.ReactNode; // the Workflows editor, shown under Preferences
  onSaved: () => void; // reload anything that depends on settings (profile name, connections)
}

const TABS: { id: AccountTab; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'account', label: 'Account', icon: User, hint: 'Your name and studio' },
  { id: 'team', label: 'Team & AI', icon: Bot, hint: 'Your AI teammates and AI settings' },
  { id: 'connections', label: 'Connections', icon: Plug, hint: 'Linked services, devices, remote access' },
  { id: 'github', label: 'GitHub', icon: GitBranch, hint: 'Your code projects' },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal, hint: 'Theme, game mode, terminal' },
];

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';

async function saveSettings(updates: Record<string, string>) {
  const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save.');
}

export const AccountView: React.FC<AccountViewProps> = ({ tab, setTab, darkMode, setDarkMode, onSaved, workflows, team, theme, setTheme }) => {
  const [name, setName] = useState('');
  const [studio, setStudio] = useState('');
  const [terminalOn, setTerminalOn] = useState(false);
  const [gameOn, setGameOn] = useGameOn();
  const [resetAsk, setResetAsk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        const value = (key: string) => d.settings.find((s: any) => s.key === key)?.preview || '';
        setName(value('OWNER_NAME'));
        setStudio(value('STUDIO_NAME'));
        setTerminalOn(value('TERMINAL_ENABLED') === '1');
      })
      .catch(() => setMessage({ ok: false, text: 'Could not reach the server.' }));
  }, []);

  const save = async (updates: Record<string, string>, done = 'Saved.') => {
    setSaving(true);
    setMessage(null);
    try {
      await saveSettings(updates);
      setMessage({ ok: true, text: done });
      onSaved();
      window.dispatchEvent(new Event('eden-settings-changed'));
      return true;
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleTerminal = async () => {
    const next = !terminalOn;
    if (await save({ TERMINAL_ENABLED: next ? '1' : '' }, next ? 'Terminal turned on.' : 'Terminal turned off.')) setTerminalOn(next);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-8 lg:flex-row lg:items-start">
      <aside aria-label="Settings menu" className={`${cardClass} hidden w-full shrink-0 lg:sticky lg:top-8 lg:block lg:w-56`}>
        <h2 className="font-semibold text-slate-900 dark:text-white">Settings</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pick what you want to change.</p>
        <nav className="mt-3 space-y-1">
          {TABS.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setMessage(null);
              }}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left ${
                tab === id ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className={`block text-xs ${tab === id ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>{hint}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 max-w-2xl flex-1 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Account and settings</h1>

      <div role="tablist" className="flex gap-1 lg:hidden rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setMessage(null);
            }}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-2 text-sm sm:gap-2 sm:px-3 ${
              tab === id ? 'bg-indigo-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'account' && (
        <Sections
          storageKey="account"
          items={[
            { id: 'profile', title: 'Profile', body: <ProfileCard name={name} /> },
            {
              id: 'details',
              title: 'Your name and studio',
              body: (
                <form
                  className={`${cardClass} space-y-4`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    save({ OWNER_NAME: name.trim(), STUDIO_NAME: studio.trim() });
                  }}
                >
                  <div>
                    <label htmlFor="ac-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Your name</label>
                    <input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="What should the hub call you?" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="ac-studio" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Studio name</label>
                    <input id="ac-studio" value={studio} onChange={(e) => setStudio(e.target.value)} maxLength={60} placeholder="The name you sell under" className={inputClass} />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Kept on this computer only. The hub has no online account or password.</p>
                  <div className="flex items-center gap-3">
                    <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                    </button>
                    {message && <span role="status" className={`text-sm ${message.ok ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</span>}
                  </div>
                </form>
              ),
            },
          ]}
        />
      )}

      {tab === 'connections' && (
        <Sections
          storageKey="connections"
          className="space-y-6"
          items={[
            { id: 'connections', title: 'Connections', body: <SettingsView onSaved={onSaved} part="connections" /> },
            { id: 'devices', title: 'Devices', body: <DevicesView /> },
            { id: 'remote', title: 'Remote access', body: <RemoteView /> },
          ]}
        />
      )}

      {tab === 'team' && (
        <Sections
          storageKey="team"
          className="space-y-6"
          items={[
            ...(team ? [{ id: 'team', title: 'Your AI team', body: team }] : []),
            { id: 'ai', title: 'AI settings', body: <SettingsView onSaved={onSaved} part="ai" /> },
          ]}
        />
      )}

      {tab === 'github' && <ReposView />}

      {tab === 'preferences' && (
        <Sections
          storageKey="preferences"
          items={[
            ...(workflows ? [{ id: 'workflows', title: 'Workflows', body: <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><h2 className="px-5 pt-4 text-lg font-semibold text-slate-900 dark:text-white">Workflows</h2>{workflows}</section> }] : []),
            { id: 'install', title: 'Install as an app', body: <InstallCard /> },
            {
              id: 'theme',
              title: 'Theme',
              body: (
          <section className={cardClass}>
            <h2 className="font-semibold text-slate-900 dark:text-white">Theme</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {THEMES.map((t) => {
                const on = (theme || (darkMode ? 'dark' : 'light')) === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => (setTheme ? setTheme(t.id) : setDarkMode(t.dark))}
                    aria-pressed={on}
                    className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm ${on ? 'border-indigo-500 font-medium text-slate-900 dark:text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'}`}
                  >
                    <span className="flex h-5 w-5 shrink-0 overflow-hidden rounded-full border border-slate-300 dark:border-slate-600" aria-hidden>
                      <span className="h-full w-1/2" style={{ background: t.swatch[0] }} />
                      <span className="h-full w-1/2" style={{ background: t.swatch[1] }} />
                    </span>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </section>
              ),
            },
            {
              id: 'options',
              title: 'Options',
              body: (
          <section className={cardClass}>
            <h2 className="font-semibold text-slate-900 dark:text-white">Options</h2>
            <div className="mt-3 flex items-start gap-4">
              <div className="flex-1">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">Video game mode</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Just for fun. Gives the hub a retro game look and adds a small game in the corner: a character, levels and XP, enemies to beat, and gold to spend on upgrades. It saves on this device only and does not change how the hub works.
                </p>
              </div>
              <button
                onClick={() => setGameOn(!gameOn)}
                role="switch"
                aria-checked={gameOn}
                aria-label="Turn on video game mode"
                className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${gameOn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${gameOn ? 'left-[1.375rem]' : 'left-0.5'}`} />
              </button>
            </div>
            {gameOn && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {resetAsk ? (
                  <>
                    <span className="text-sm text-slate-600 dark:text-slate-300">Erase your level, gold and upgrades?</span>
                    <button onClick={() => { resetGame(); setResetAsk(false); }} className="rounded-md bg-red-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-red-500">Erase</button>
                    <button onClick={() => setResetAsk(false)} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
                  </>
                ) : (
                  <button onClick={() => setResetAsk(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Start the game over</button>
                )}
              </div>
            )}
          </section>
              ),
            },
            {
              id: 'terminal',
              title: 'Terminal',
              body: (
          <section className={cardClass}>
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h2 className="font-semibold text-slate-900 dark:text-white">Terminal</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Lets you run commands on this computer from the panel at the bottom of the window. Only you can use it, from this computer. Your AI teammates cannot.
                </p>
              </div>
              <button
                onClick={toggleTerminal}
                disabled={saving}
                role="switch"
                aria-checked={terminalOn}
                aria-label="Allow the terminal to run commands"
                className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${terminalOn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${terminalOn ? 'left-[1.375rem]' : 'left-0.5'}`} />
              </button>
            </div>
            {message && <p role="status" className={`mt-3 text-sm ${message.ok ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</p>}
          </section>
              ),
            },
          ]}
        />
      )}
      </div>
    </div>
  );
};
