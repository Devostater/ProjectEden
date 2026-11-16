import React, { useEffect, useState } from 'react';
import { Upload, Trash2, Plus, X, Save, Loader2, Sparkles, ExternalLink, Play } from 'lucide-react';
import { Avatar, FRAMES, PROFILE_EVENT, useProfile, type ProfileData } from './Avatar.tsx';

// Picture, frame, bio, your links and your own quick commands (a command sends its text to Chat).
const card = 'rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const h = 'text-sm font-semibold text-slate-900 dark:text-white';

// Shrinks the picture to 256x256 (cropped to a square) so it stays small.
function toSmallPicture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(img.src);
      resolve(file.type === 'image/gif' ? c.toDataURL('image/png') : c.toDataURL('image/webp', 0.85));
    };
    img.onerror = () => reject(new Error('That file is not a picture.'));
    img.src = URL.createObjectURL(file);
  });
}

export const ProfileCard: React.FC<{ name: string }> = ({ name }) => {
  const saved = useProfile();
  const [p, setP] = useState<ProfileData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (saved && !p) setP(saved); }, [saved, p]);
  if (!p) return null;
  const set = (patch: Partial<ProfileData>) => { setP({ ...p, ...patch }); setMsg(null); };
  const initial = (name || 'You').trim().charAt(0).toUpperCase();

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      setP(d);
      setMsg({ ok: true, text: 'Profile saved.' });
      window.dispatchEvent(new Event(PROFILE_EVENT));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  return (
    <section className={`${card} space-y-5`}>
      <div className="flex flex-wrap items-center gap-5">
        <Avatar src={p.avatar} initial={initial} frame={p.frame} size={96} />
        <div className="space-y-2">
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{name || 'Your profile'}</p>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              <Upload className="h-4 w-4" /> Change picture
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { set({ avatar: await toSmallPicture(f) }); } catch (err: any) { setMsg({ ok: false, text: err.message }); }
              }} />
            </label>
            {p.avatar && (
              <button onClick={() => set({ avatar: '' })} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:text-red-600 dark:border-slate-700 dark:text-slate-300">
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className={h}>Frame</h3>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {FRAMES.map((f) => (
            <button key={f.id} onClick={() => set({ frame: f.id })} aria-pressed={p.frame === f.id} title={f.legendary ? `${f.label} (legendary, animated)` : f.label}
              className={`relative flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs ${p.frame === f.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
              {f.legendary && <Sparkles className="absolute right-1 top-1 h-3 w-3 text-amber-500" aria-label="legendary" />}
              <Avatar src={p.avatar} initial={initial} frame={f.id} size={44} />
              <span className={f.legendary ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}>{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="pf-bio" className={h}>About you</label>
        <textarea id="pf-bio" value={p.bio} onChange={(e) => set({ bio: e.target.value })} maxLength={300} rows={2} placeholder="What you make, what you're working on" className={`${input} mt-2`} />
      </div>

      <div>
        <h3 className={h}>Links</h3>
        <div className="mt-2 space-y-2">
          {p.links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input value={l.label} onChange={(e) => set({ links: p.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Name" aria-label="Link name" className={`${input} w-32 shrink-0`} />
              <input value={l.url} onChange={(e) => set({ links: p.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://…" aria-label="Link address" className={input} />
              {/^https?:\/\//i.test(l.url) && <a href={l.url} target="_blank" rel="noopener noreferrer" title="Open" className="flex items-center px-1 text-slate-500 hover:text-indigo-600"><ExternalLink className="h-4 w-4" /></a>}
              <button onClick={() => set({ links: p.links.filter((_, j) => j !== i) })} aria-label="Remove link" className="px-1 text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
          {p.links.length < 12 && <button onClick={() => set({ links: [...p.links, { label: '', url: '' }] })} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline dark:text-indigo-400"><Plus className="h-4 w-4" /> Add link</button>}
        </div>
      </div>

      <div>
        <h3 className={h}>Quick commands</h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Things you ask often. Press ▶ to send one to Chat.</p>
        <div className="mt-2 space-y-2">
          {p.commands.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input value={c.label} onChange={(e) => set({ commands: p.commands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Name" aria-label="Command name" className={`${input} w-32 shrink-0`} />
              <input value={c.text} onChange={(e) => set({ commands: p.commands.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder="What to ask, e.g. Summarize today's work" aria-label="Command text" className={input} />
              <button disabled={!c.text.trim()} onClick={() => window.dispatchEvent(new CustomEvent('eden-ask', { detail: c.text }))} title="Send to Chat" aria-label={`Run ${c.label || 'command'}`} className="px-1 text-emerald-600 disabled:opacity-30"><Play className="h-4 w-4" /></button>
              <button onClick={() => set({ commands: p.commands.filter((_, j) => j !== i) })} aria-label="Remove command" className="px-1 text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
          {p.commands.length < 12 && <button onClick={() => set({ commands: [...p.commands, { label: '', text: '' }] })} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline dark:text-indigo-400"><Plus className="h-4 w-4" /> Add command</button>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save profile
        </button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </section>
  );
};
