import React, { useEffect, useRef, useState } from 'react';
import { Play, Send, Trash2 } from 'lucide-react';

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

export const LyraPanel: React.FC = () => {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
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
  }, [turns, busy]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    const history = turns.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/lyra/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'LYRA could not answer.');
      setConnected(true);
      setTurns((t) => [...t, { role: 'assistant', content: d.reply }]);
    } catch (err: any) {
      setTurns((t) => [...t, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
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

  const status = connected === null ? 'Checking…' : connected ? 'Connected' : starting ? 'Starting…' : 'Not running';

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-40 shrink-0 flex-col items-center justify-center gap-1 border-r border-slate-200 px-3 text-center dark:border-slate-800">
        <div className={`rounded-full ${connected ? 'shadow-lg shadow-fuchsia-500/30' : ''} ${busy ? 'animate-pulse' : ''}`}>
          <LyraChibi connected={!!connected} thinking={busy} className="h-20 w-20" />
        </div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">LYRA</div>
        <div className={`flex items-center gap-1.5 text-sm ${connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} /> {status}
        </div>
        {connected === false && (
          <button onClick={start} disabled={starting} className="mt-1 flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-fuchsia-500 disabled:opacity-50">
            <Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start LYRA'}
          </button>
        )}
        {startError && <div className="text-sm text-red-600 dark:text-red-400">{startError}</div>}
        {turns.length > 0 && (
          <button onClick={() => setTurns([])} className="mt-1 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
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
          {busy && (
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
            disabled={busy}
            aria-label="Message to LYRA"
            placeholder="Type a message or command for LYRA"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-fuchsia-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button type="submit" disabled={busy || !input.trim()} className="flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-medium text-white hover:bg-fuchsia-500 disabled:opacity-50">
            <Send className="h-4 w-4" /> Send
          </button>
        </form>
      </div>
    </div>
  );
};
