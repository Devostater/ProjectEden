import React, { useEffect, useState } from 'react';
import { Bell, MonitorPlay, Send } from 'lucide-react';
import { api } from '../api.ts';

interface Roles {
  serial: string;
  alerts: boolean;
  screen: boolean;
}

// One shared request for all device cards on the page.
let pending: Promise<{ devices: Roles[] }> | null = null;
const loadRoles = () => (pending ||= api<{ devices: Roles[] }>('GET', '/api/team-devices').finally(() => setTimeout(() => (pending = null), 1000)));

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
  </button>
);

// Devices → a plugged-in device: what the AI team may use it for.
export const DeviceTeamRow: React.FC<{ serial: string }> = ({ serial }) => {
  const [roles, setRoles] = useState<Roles | null>(null);
  const [link, setLink] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadRoles().then((d) => setRoles(d.devices.find((x) => x.serial === serial) || null)).catch(() => {});
  }, [serial]);

  const call = async (body: object, done?: string) => {
    setNote(null);
    try {
      const r = await api<any>('POST', `/api/team-devices/${encodeURIComponent(serial)}`, body);
      if (!('test' in body)) setRoles((x) => (x ? { ...x, alerts: r.alerts, screen: r.screen } : x));
      if (done) setNote({ ok: true, text: done });
    } catch (err: any) {
      setNote({ ok: false, text: err.message });
    }
  };
  const show = async (e: React.FormEvent) => {
    e.preventDefault();
    setNote(null);
    try {
      const r = await api<{ shown: string[] }>('POST', '/api/team-devices/show', { url: link.trim() });
      setNote({ ok: true, text: `Opened on ${r.shown.join(' and ')}.` });
      setLink('');
    } catch (err: any) {
      setNote({ ok: false, text: err.message });
    }
  };

  if (!roles) return null;
  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
      <div className="font-medium text-slate-900 dark:text-white">On the AI team</div>
      <div className="flex items-center gap-3">
        <Bell className="h-4 w-4 shrink-0 text-indigo-500" />
        <div className="min-w-0 flex-1">
          <div className="text-slate-800 dark:text-slate-200">Alerts</div>
          <div className="text-xs text-slate-500">A notification when work is waiting for you or something failed (grouped, at most every 2 minutes).</div>
        </div>
        {roles.alerts && (
          <button onClick={() => call({ test: true }, 'Test alert sent. Check the device.')} className="shrink-0 rounded-lg px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-slate-800">
            Test
          </button>
        )}
        <Switch on={roles.alerts} onChange={(v) => call({ alerts: v })} label="Alerts on this device" />
      </div>
      <div className="flex items-center gap-3">
        <MonitorPlay className="h-4 w-4 shrink-0 text-indigo-500" />
        <div className="min-w-0 flex-1">
          <div className="text-slate-800 dark:text-slate-200">Screen</div>
          <div className="text-xs text-slate-500">Teammates can open links on it for you to look at: store pages, builds, references.</div>
        </div>
        <Switch on={roles.screen} onChange={(v) => call({ screen: v })} label="Use as a screen" />
      </div>
      {roles.screen && (
        <form onSubmit={show} className="flex gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Open a link on it: https://…" aria-label="Link to open on the device" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          <button type="submit" aria-label="Open on the device" className="shrink-0 rounded-lg bg-indigo-600 px-3 text-white hover:bg-indigo-500"><Send className="h-4 w-4" /></button>
        </form>
      )}
      {note && <p role="status" className={note.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{note.text}</p>}
    </div>
  );
};
