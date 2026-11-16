import React, { useEffect, useState } from 'react';
import { Globe, ExternalLink, Send, Save, Loader2, RefreshCw } from 'lucide-react';

// Website page: see the latest posts on the studio's Wix site and publish an update to it.
interface Post { id: string; title: string; published?: string; url?: string; excerpt?: string }
interface Info { site: string; ready: boolean; needs?: string[]; error?: string; posts: Post[] }

const card = 'rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';

export const WebsiteView: React.FC = () => {
  const [info, setInfo] = useState<Info | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => fetch('/api/website').then((r) => r.json()).then(setInfo).catch(() => setMsg({ ok: false, text: 'Could not reach the hub.' }));
  useEffect(() => { load(); }, []);

  const send = async (publish: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/website/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, text, publish }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Something went wrong.');
      setMsg({ ok: true, text: publish ? 'Published on your website.' : 'Saved as a draft in Wix (not public yet).' });
      if (publish) { setTitle(''); setText(''); }
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setBusy(false);
    setConfirm(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white"><Globe className="h-6 w-6 text-indigo-500" /> Website</h1>
        {info && <a href={info.site} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-indigo-600 hover:underline dark:text-indigo-400">Open the site <ExternalLink className="h-4 w-4" /></a>}
      </div>

      {info && !info.ready && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <b>Connect your Wix site first.</b> In Wix: Dashboard → Settings → <b>API Keys</b> → create a key with <b>Blog</b> permissions. Then paste it in Eden → Account &amp; settings → Connections as <b>WIX_API_KEY</b>, with your <b>WIX_SITE_ID</b> (the id in your site dashboard's web address). Your site also needs the Wix Blog app.
        </div>
      )}
      {info?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{info.error}</p>}

      <section className={`${card} space-y-3`}>
        <h2 className="font-semibold text-slate-900 dark:text-white">Post an update</h2>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Title, e.g. Devlog #1: the AI swarm builds a plugin" aria-label="Update title" className={input} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder={'Write the update. Leave a blank line between paragraphs.\n# A line starting with # becomes a heading.'} aria-label="Update text" className={input} />
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy || !info?.ready || !title.trim() || !text.trim()} onClick={() => send(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"><Save className="h-4 w-4" /> Save as draft</button>
          {!confirm ? (
            <button disabled={busy || !info?.ready || !title.trim() || !text.trim()} onClick={() => setConfirm(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"><Send className="h-4 w-4" /> Publish…</button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-amber-700 dark:text-amber-300">This goes live on your public website.</span>
              <button disabled={busy} onClick={() => send(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-500">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Yes, publish</button>
              <button onClick={() => setConfirm(false)} className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700">Cancel</button>
            </span>
          )}
        </div>
        {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
      </section>

      <section className={card}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 dark:text-white">Latest posts</h2>
          <button onClick={load} title="Refresh" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4" /></button>
        </div>
        <ul className="mt-3 space-y-2">
          {(info?.posts || []).map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <b className="text-slate-900 dark:text-white">{p.title}</b>
                {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400" aria-label={`Open ${p.title}`}><ExternalLink className="h-4 w-4" /></a>}
              </div>
              {p.published && <div className="text-xs text-slate-500">{new Date(p.published).toLocaleDateString()}</div>}
              {p.excerpt && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.excerpt}</p>}
            </li>
          ))}
          {info?.ready && !info.error && !info.posts.length && <li className="text-sm text-slate-500">No posts yet.</li>}
        </ul>
      </section>
    </div>
  );
};
