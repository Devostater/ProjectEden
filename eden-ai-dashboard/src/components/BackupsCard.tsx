import React, { useEffect, useState } from 'react';
import { Archive, Loader2, FolderOpen, CheckCircle2 } from 'lucide-react';
import { api } from '../api.ts';

interface Backup {
  name: string;
  sizeMb: number;
  at: string;
  auto: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Account → Settings: backups of the hub's code and data (zip files outside the hub folder).
export const BackupsCard: React.FC = () => {
  const [data, setData] = useState<{ backups: Backup[]; running: boolean; error: string; folder: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<any>('GET', '/api/backups').then(setData).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const backup = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ sizeMb: number }>('POST', '/api/backups');
      setNote({ ok: true, text: `Backed up (${r.sizeMb} MB).` });
      await load();
    } catch (err: any) {
      setNote({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const last = data.backups[0];
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Backups</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        A copy of the hub's code (including unsaved changes) and its data: projects, team, chats, settings and keys. Made by itself once a day; the newest 14 are kept.
      </p>
      <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          {last ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <Archive className="h-5 w-5 shrink-0 text-slate-400" />}
          <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-300">{last ? `Last backup: ${when(last.at)} (${last.sizeMb} MB)` : 'No backup yet.'}</span>
          <button onClick={backup} disabled={busy || data.running} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy || data.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} {busy || data.running ? 'Backing up…' : 'Back up now'}
          </button>
          <button onClick={() => api('POST', '/api/backups/open-folder').catch(() => {})} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <FolderOpen className="h-4 w-4" /> Open folder
          </button>
        </div>
        {note && <p role="status" className={`text-sm ${note.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{note.text}</p>}
        {data.error && !note && <p className="text-sm text-red-500">Last backup didn't finish: {data.error}</p>}
        {data.backups.length > 1 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">All backups ({data.backups.length})</summary>
            <ul className="mt-2 space-y-1">
              {data.backups.map((b) => (
                <li key={b.name} className="flex justify-between gap-3 text-slate-600 dark:text-slate-400">
                  <span>{when(b.at)}{b.auto ? ' · daily' : ''}</span>
                  <span>{b.sizeMb} MB</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs text-slate-500">Saved in {data.folder}. To restore, unzip one over the hub folder (close the hub first).</p>
      </div>
    </div>
  );
};
