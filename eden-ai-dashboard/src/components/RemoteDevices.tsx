import React, { useEffect, useState } from 'react';
import { Wifi, Smartphone, Tablet, Laptop, Pencil, LogOut, Check, X, ChevronDown } from 'lucide-react';
import { api } from '../api.ts';

interface RemoteDevice {
  id: string;
  name: string;
  kind: 'phone' | 'tablet' | 'computer';
  agent: string;
  ip: string;
  pairedAt: string;
  lastSeen: string;
  online: boolean;
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 120) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// Devices paired over Wi-Fi (scanned the QR code / entered the pairing code). Each has its own sign-in,
// so one can be renamed or signed out without affecting the others.
export const RemoteDevices: React.FC<{ folded: string[]; onToggle: (id: string) => void; usb?: { ip: string; name: string }[] }> = ({ folded, onToggle, usb = [] }) => {
  const [list, setList] = useState<RemoteDevice[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setList((await api<{ devices: RemoteDevice[] }>('GET', '/api/remote-devices')).devices);
    } catch {}
  };
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 15000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: string, action: 'rename' | 'forget', body?: unknown) => {
    setError('');
    try {
      await api('POST', `/api/remote-devices/${id}/${action}`, body ?? {});
      setEditing(null);
      setConfirm(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!list) return null;
  const sectionFolded = folded.includes('remote');
  const online = list.filter((d) => d.online).length;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pt-2">
        <Wifi className="h-5 w-5 text-indigo-500" />
        <h2 className="flex-1 text-lg font-semibold text-slate-900 dark:text-white">
          Connected over Wi-Fi <span className="text-sm font-normal text-slate-500">({list.length} paired{online ? `, ${online} online` : ''})</span>
        </h2>
        <button onClick={() => onToggle('remote')} aria-expanded={!sectionFolded} aria-label={sectionFolded ? 'Show Wi-Fi devices' : 'Hide Wi-Fi devices'} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <ChevronDown className={`h-5 w-5 transition-transform ${sectionFolded ? '-rotate-90' : ''}`} />
        </button>
      </div>
      {!sectionFolded && (
        <>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {!list.length ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
              No phones or tablets paired over Wi-Fi yet. Scan the QR code on the Remote tab with one, and it shows up here.
            </p>
          ) : (
            list.map((d) => {
              const Icon = d.kind === 'phone' ? Smartphone : d.kind === 'tablet' ? Tablet : Laptop;
              // The same device is also plugged in by USB (same Wi-Fi address): use its real name.
              const cable = usb.find((u) => u.ip === d.ip);
              const shownName = cable && /^Android (phone|tablet)$/.test(d.name) ? cable.name : d.name;
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                    <Icon className="h-5 w-5" />
                    <span className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900 ${d.online ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {editing === d.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          act(d.id, 'rename', { name: draft });
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} aria-label="Device name" className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                        <button type="submit" aria-label="Save name" className="rounded p-1 text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800"><Check className="h-4 w-4" /></button>
                        <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-white">
                        {shownName}
                        {cable && <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-xs font-normal text-indigo-600 dark:text-indigo-300">also plugged in by USB</span>}
                      </div>
                    )}
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      <span className={d.online ? 'text-emerald-600 dark:text-emerald-400' : ''}>{d.online ? 'Online now' : `Last seen ${ago(d.lastSeen)}`}</span> · {d.agent} · {d.ip}
                    </div>
                  </div>
                  {confirm === d.id ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-600 dark:text-slate-300">Sign it out?</span>
                      <button onClick={() => act(d.id, 'forget')} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-500">Sign out</button>
                      <button onClick={() => setConfirm(null)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Keep</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditing(d.id);
                          setDraft(shownName);
                        }}
                        aria-label={`Rename ${d.name}`}
                        title="Rename"
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setConfirm(d.id)} aria-label={`Sign out ${d.name}`} title="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800">
                        <LogOut className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">A signed-out device needs to scan the QR code again. To sign out every device at once, make a new pairing code on the Remote tab.</p>
        </>
      )}
    </section>
  );
};
