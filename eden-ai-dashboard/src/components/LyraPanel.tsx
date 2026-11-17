import React, { useEffect, useRef, useState } from 'react';
import { Play, Send, Settings, Square, Trash2 } from 'lucide-react';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

// Ideas shown under the empty chat so the owner knows what to ask.
const SUGGESTIONS = ['What are you working on?', 'Give me a quick status update', 'What can you help me with?'];

// A small chibi LYRA. When LYRA is connected she smiles and glows; when not, she is grey and sleepy.
export const LyraChibi: React.FC<{ connected: boolean; thinking?: boolean; className?: string }> = ({ connected, thinking = false, className = 'h-20 w-20' }) => (
  <svg viewBox="0 0 100 100" className={className} role="img" aria-label={connected ? 'LYRA is connected' : 'LYRA is not connected'}>
    <circle cx="50" cy="50" r="46" fill={connected ? '#d946ef' : '#94a3b8'} opacity={connected ? 0.18 : 0.12} />
    {/* hair back */}
    <ellipse cx="50" cy="48" rx="34" ry="35" fill={connected ? '#a21caf' : '#64748b'} />
    {/* twin tails */}
    <ellipse cx="17" cy="62" rx="8" ry="16" fill={connected ? '#a21caf' : '#64748b'} />
    <ellipse cx="83" cy="62" rx="8" ry="16" fill={connected ? '#a21caf' : '#64748b'} />
    {/* face */}
    <ellipse cx="50" cy="55" rx="27" ry="25" fill="#ffe4d6" />
    {/* fringe */}
    <path d="M23 50 Q30 22 50 22 Q70 22 77 50 Q66 36 50 38 Q34 36 23 50 Z" fill={connected ? '#c026d3' : '#78859a'} />
    {/* eyes */}
    {connected ? (
      <>
        <ellipse cx="39" cy="57" rx="5" ry={thinking ? 3 : 6} fill="#3b0764" />
        <ellipse cx="61" cy="57" rx="5" ry={thinking ? 3 : 6} fill="#3b0764" />
        <circle cx="41" cy="55" r="1.8" fill="#fff" />
        <circle cx="63" cy="55" r="1.8" fill="#fff" />
      </>
    ) : (
      <>
        <path d="M34 58 Q39 62 44 58" stroke="#3b0764" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M56 58 Q61 62 66 58" stroke="#3b0764" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </>
    )}
    {/* cheeks and mouth */}
    <circle cx="32" cy="66" r="4" fill="#fda4af" opacity="0.7" />
    <circle cx="68" cy="66" r="4" fill="#fda4af" opacity="0.7" />
    {connected ? (
      <path d="M45 70 Q50 75 55 70" stroke="#9f1239" strokeWidth="2" fill="none" strokeLinecap="round" />
    ) : (
      <line x1="46" y1="72" x2="54" y2="72" stroke="#9f1239" strokeWidth="2" strokeLinecap="round" />
    )}
    {/* star hair clip */}
    <path d="M72 30 l2.5 5 5.5 .8 -4 3.9 1 5.5 -5-2.7 -5 2.7 1-5.5 -4-3.9 5.5-.8 z" fill={connected ? '#fde047' : '#cbd5e1'} />
  </svg>
);

interface LyraEdit { id: string; file: string; project: string; isNew: boolean; added: number; removed: number; preview: string[] }
interface LyraTask { id: string; label: string; status: string; type: string; step: string; pct: number; needsOk: boolean }
interface LyraOverview {
  connected: boolean;
  build?: { name: string; what: string } | null;
  tasks?: LyraTask[];
  made?: { title: string; url: string }[];
  projects?: { path: string; name: string }[];
  lyraPort?: number;
}
const TASK_ICON: Record<string, string> = { running: '⚙', queued: '⏳', done: '✓', failed: '⚠', interrupted: '⏸', cancelled: '■' };

// What LYRA is working on, a box to give her a task, and what she made lately. Refreshes every 10 seconds.
const LyraWork: React.FC = () => {
  const [o, setO] = useState<LyraOverview | null>(null);
  const [text, setText] = useState('');
  const [project, setProject] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [edits, setEdits] = useState<LyraEdit[]>([]);
  const [deciding, setDeciding] = useState('');
  const load = () => {
    fetch('/api/lyra/overview')
      .then((r) => r.json())
      .then(setO)
      .catch(() => setO({ connected: false }));
    fetch('/api/lyra/edits')
      .then((r) => r.json())
      .then((d) => setEdits(d.items || []))
      .catch(() => {});
  };
  const decide = async (e: LyraEdit, accept: boolean) => {
    setDeciding(e.id);
    try {
      const r = await fetch('/api/lyra/edits/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, accept, file: e.file }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'LYRA did not take it.');
      setEdits((list) => list.filter((x) => x.id !== e.id));
      setNote(accept ? `Saved ${e.file.split('/').pop()}.` : `Rejected ${e.file.split('/').pop()}.`);
    } catch (err: any) {
      setNote(err.message);
    } finally {
      setDeciding('');
    }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  if (!o || !o.connected) return null;
  const give = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setNote('');
    try {
      const r = await fetch('/api/lyra/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, project }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'LYRA did not take the task.');
      setText('');
      setNote(project ? 'Added. Her edits wait for your ✓ in LYRA.' : 'Added to her tasks.');
      load();
    } catch (err: any) {
      setNote(err.message);
    } finally {
      setSending(false);
    }
  };
  const lyraUrl = `${location.protocol}//${location.hostname}:${o.lyraPort || 4777}/`;
  // Her gallery is the Library section of her page.
  const galleryUrl = `${lyraUrl}#library`;
  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-l border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-900 dark:text-white">LYRA's work</span>
        <a href={lyraUrl} target="_blank" rel="noreferrer" className="text-xs text-fuchsia-600 hover:underline dark:text-fuchsia-400">Open LYRA ↗</a>
      </div>
      {o.build && <div className="text-xs text-slate-500 dark:text-slate-400" title={o.build.what}>Build {o.build.name}</div>}
      {edits.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            ✎ {edits.length} edit{edits.length === 1 ? '' : 's'} waiting for your ✓
          </div>
          {edits.map((e) => (
            <details key={e.id} className="rounded-md bg-white px-2 py-1.5 dark:bg-slate-900">
              <summary className="cursor-pointer list-none">
                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100" title={e.file}>
                  {e.isNew ? '🆕 ' : ''}
                  {e.file.split('/').pop()}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {e.project} · <span className="text-emerald-600">+{e.added}</span> <span className="text-red-500">−{e.removed}</span> · tap to look
                </span>
              </summary>
              {e.preview.length > 0 && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-1.5 text-[11px] leading-snug text-slate-700 dark:bg-slate-800 dark:text-slate-200">{e.preview.join('\n')}</pre>
              )}
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => decide(e, true)}
                  disabled={deciding === e.id}
                  className="min-h-[36px] flex-1 rounded-md bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  ✓ Accept
                </button>
                <button
                  onClick={() => decide(e, false)}
                  disabled={deciding === e.id}
                  className="min-h-[36px] flex-1 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  ✕ Reject
                </button>
              </div>
            </details>
          ))}
        </div>
      )}
      <div className="space-y-1">
        {(o.tasks || []).length === 0 && <div className="text-xs text-slate-500 dark:text-slate-400">No tasks yet.</div>}
        {(o.tasks || []).slice(0, 6).map((t) => (
          <div key={t.id} className="flex items-start gap-2 rounded-lg bg-slate-100 px-2 py-1.5 dark:bg-slate-800/60" title={t.step}>
            <span className={t.status === 'running' ? 'animate-spin' : ''}>{t.needsOk ? '⏸' : TASK_ICON[t.status] || '•'}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-slate-800 dark:text-slate-100">{t.label.replace(/^(🎙|🤖)\s*/, '')}</span>
              {(t.status === 'running' || t.needsOk) && (
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{t.needsOk ? 'Waiting for your OK in LYRA' : t.step || 'Working…'}{t.pct > 0 && t.pct < 1 ? ` (${Math.round(t.pct * 100)}%)` : ''}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          give();
        }}
        className="space-y-1.5"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          aria-label="Task for LYRA"
          placeholder="Give LYRA a task… (e.g. add a shield meter)"
          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-fuchsia-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <div className="flex gap-1.5">
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
            <option value="">💬 No project (just do it)</option>
            {(o.projects || []).map((p) => (
              <option key={p.path} value={p.path} title={p.path}>
                📁 {p.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={sending || !text.trim()} className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-fuchsia-500 disabled:opacity-50">
            {sending ? '…' : 'Give'}
          </button>
        </div>
        {note && <div className="text-xs text-slate-500 dark:text-slate-400">{note}</div>}
      </form>
      {(o.made || []).length > 0 && (
        <div>
          <a href={galleryUrl} target="_blank" rel="noreferrer" title="Open LYRA's gallery" className="mb-1 block text-xs font-medium text-slate-500 hover:text-fuchsia-600 hover:underline dark:text-slate-400 dark:hover:text-fuchsia-400">
            Made lately ↗
          </a>
          <div className="grid grid-cols-4 gap-1">
            {(o.made || []).map((m) => (
              <a key={m.url} href={galleryUrl} target="_blank" rel="noreferrer" title={`${m.title} — open LYRA's gallery`}>
                <img src={m.url} alt={m.title} loading="lazy" className="aspect-square w-full rounded-md bg-slate-200 object-cover hover:ring-2 hover:ring-fuchsia-500 dark:bg-slate-800" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const LyraPanel: React.FC = () => {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false); // LYRA is answering (maybe a message sent from another device)
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [autoOpen, setAutoOpen] = useState<boolean | null>(null);
  const [stopping, setStopping] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  useEffect(() => { fetch('/api/lyra/auto-open').then((r) => r.json()).then((d) => setAutoOpen(!!d.autoOpen)).catch(() => {}); }, []);
  const toggleAutoOpen = () => {
    const next = !autoOpen;
    fetch('/api/lyra/auto-open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoOpen: next }) })
      .then((r) => r.json()).then((d) => setAutoOpen(!!d.autoOpen)).catch(() => {});
  };
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch('/api/lyra/status')
        .then((r) => r.json())
        .then((d) => alive && setConnected(!!d.connected))
        .catch(() => alive && setConnected(false));
    check();
    const timer = setInterval(check, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy, thinking]);

  const working = busy || thinking;

  // The conversation lives in the hub, so this computer, the tablet and the phone all show the same one.
  // The hub tells us the moment a message is added (from here or anywhere else), and we fetch it.
  useEffect(() => {
    let alive = true;
    let last = -1;
    const pull = async () => {
      try {
        const d = await fetch('/api/lyra/conversation').then((r) => r.json());
        if (!alive || !Array.isArray(d.messages)) return;
        setTurns(d.messages.map((m: any) => ({ role: m.role, content: m.content, error: !!m.error })));
        setThinking(!!d.thinking);
      } catch {
        // hub unreachable: keep what is on screen
      }
    };
    const es = new EventSource('/api/lyra/conversation/events');
    es.onmessage = (e) => {
      const v = Number(e.data);
      if (v !== last) {
        last = v;
        pull();
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && pull();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      es.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const send = async () => {
    const message = input.trim();
    if (!message || busy || thinking) return;
    setInput('');
    setBusy(true);
    try {
      // The hub saves the message and LYRA's answer; they appear here through the live feed above.
      const res = await fetch('/api/lyra/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'LYRA could not answer.');
      setConnected(true);
    } catch (err: any) {
      // Errors from LYRA are saved by the hub too. Only a message that never reached the hub is shown here.
      const seen = await fetch('/api/lyra/conversation').then((r) => r.json()).catch(() => null);
      if (seen && Array.isArray(seen.messages)) setTurns(seen.messages.map((m: any) => ({ role: m.role, content: m.content, error: !!m.error })));
      if (!seen || !seen.messages?.some((m: any) => m.error && m.content === err.message)) setTurns((t) => [...t, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      const res = await fetch('/api/lyra/conversation', { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not clear it.');
      setTurns([]);
    } catch (err: any) {
      setStartError(err.message);
    }
  };

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setStartError('');
    try {
      const res = await fetch('/api/lyra/start', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'LYRA could not be started.');
      // LYRA takes a little while to wake up; keep checking for up to a minute.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await fetch('/api/lyra/status').then((r) => r.json());
        if (s.connected) {
          setConnected(true);
          break;
        }
      }
    } catch (err: any) {
      setStartError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (stopping || !window.confirm('Stop LYRA? She will close until you press Start LYRA again.')) return;
    setStopping(true);
    setStartError('');
    try {
      const res = await fetch('/api/lyra/stop', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'LYRA could not be stopped.');
      setConnected(false);
    } catch (err: any) {
      setStartError(err.message);
    } finally {
      setStopping(false);
    }
  };

  const status = connected === null ? 'Checking…' : connected ? 'Connected' : starting ? 'Starting…' : 'Not running';

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-40 shrink-0 flex-col items-center justify-center gap-1 border-r border-slate-200 px-3 text-center dark:border-slate-800">
        <div className={`rounded-full ${connected ? 'shadow-lg shadow-fuchsia-500/30' : ''} ${working ? 'animate-pulse' : ''}`}>
          <LyraChibi connected={!!connected} thinking={working}className="h-20 w-20" />
        </div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">LYRA</div>
        <div className={`flex items-center gap-1.5 text-sm ${connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} /> {status}
        </div>
        {connected && (
          <button onClick={stop} disabled={stopping} className="mt-1 flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10">
            <Square className="h-4 w-4" /> {stopping ? 'Stopping…' : 'Stop LYRA'}
          </button>
        )}
        {connected === false && (
          <button onClick={start} disabled={starting} className="mt-1 flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-fuchsia-500 disabled:opacity-50">
            <Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start LYRA'}
          </button>
        )}
        {startError && <div className="text-sm text-red-600 dark:text-red-400">{startError}</div>}
        {turns.length > 0 && (
          <button onClick={clear} className="mt-1 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <div className="relative mt-1">
          <button onClick={() => setShowOptions((v) => !v)} aria-expanded={showOptions} className="flex items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            <Settings className="h-3.5 w-3.5" /> Options
          </button>
          {showOptions && (
            <div className="absolute bottom-full left-1/2 z-20 mb-1 w-48 -translate-x-1/2 space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-left text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <div className="font-semibold text-slate-900 dark:text-white">LYRA options</div>
              {autoOpen !== null && (
                <button onClick={toggleAutoOpen} aria-pressed={autoOpen} title="Open LYRA on the tablet when Eden starts. Takes effect on the next start." className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  <span>Auto-open</span>
                  <span className={autoOpen ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>{autoOpen ? 'On' : 'Off'}</span>
                </button>
              )}
              <a href={`${location.protocol}//${location.hostname}:4777/`} target="_blank" rel="noreferrer" className="block rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                Open LYRA's page ↗
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
          {turns.length === 0 && (
            <div className="space-y-2">
              <p className="text-slate-500 dark:text-slate-400">
                {connected === false
                  ? "LYRA isn't running. Press Start LYRA, then talk to her here."
                  : 'Say something to LYRA. This goes straight to her, not to a teammate.'}
              </p>
              {connected && (
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setInput(s)}
                      className="rounded-full border border-fuchsia-300 bg-fuchsia-50 px-3 py-1 text-xs text-fuchsia-700 hover:bg-fuchsia-100 dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:hover:bg-fuchsia-500/20"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 ${
                  t.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : t.error
                      ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                      : 'bg-fuchsia-500/10 text-slate-800 dark:text-slate-100'
                }`}
              >
                {t.content}
              </div>
            </div>
          ))}
          {working && (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fuchsia-500" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fuchsia-500" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fuchsia-500" style={{ animationDelay: '300ms' }} />
              </span>
              LYRA is thinking…
            </div>
          )}
          <div ref={end} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2 border-t border-slate-200 p-2 dark:border-slate-800"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={working}
            aria-label="Message to LYRA"
            placeholder="Type a message or command for LYRA"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-fuchsia-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button type="submit" disabled={working || !input.trim()} className="flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-medium text-white hover:bg-fuchsia-500 disabled:opacity-50">
            <Send className="h-4 w-4" /> Send
          </button>
        </form>
      </div>
      {connected && <LyraWork />}
    </div>
  );
};
