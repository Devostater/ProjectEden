import React, { useEffect, useState } from 'react';
import { User, Plug, SlidersHorizontal, Sun, Moon, Save, Loader2 } from 'lucide-react';
import { SettingsView } from './SettingsView.tsx';

export type AccountTab = 'account' | 'connections' | 'preferences';

interface AccountViewProps {
  tab: AccountTab;
  setTab: (tab: AccountTab) => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  onSaved: () => void; // reload anything that depends on settings (profile name, connections)
}

const TABS: { id: AccountTab; label: string; icon: React.ElementType }[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
];

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';

async function saveSettings(updates: Record<string, string>) {
  const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save.');
}

export const AccountView: React.FC<AccountViewProps> = ({ tab, setTab, darkMode, setDarkMode, onSaved }) => {
  const [name, setName] = useState('');
  const [studio, setStudio] = useState('');
  const [terminalOn, setTerminalOn] = useState(false);
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
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Account and settings</h1>

      <div role="tablist" className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setMessage(null);
            }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${
              tab === id ? 'bg-indigo-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'account' && (
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
      )}

      {tab === 'connections' && <SettingsView onSaved={onSaved} />}

      {tab === 'preferences' && (
        <div className="space-y-4">
          <section className={cardClass}>
            <h2 className="font-semibold text-slate-900 dark:text-white">Appearance</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                { dark: false, label: 'Light', icon: Sun },
                { dark: true, label: 'Dark', icon: Moon },
              ].map(({ dark, label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => setDarkMode(dark)}
                  aria-pressed={darkMode === dark}
                  className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm ${
                    darkMode === dark ? 'border-indigo-500 bg-indigo-50 font-medium text-slate-900 dark:bg-indigo-950/40 dark:text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </section>

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
        </div>
      )}
    </div>
  );
};
