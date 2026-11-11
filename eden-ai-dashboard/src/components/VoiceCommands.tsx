import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import type { AppTab } from './Sidebar.tsx';
import { TITLES } from './Header.tsx';

// What you can say for each page. Longest match wins, so "code updates" beats "updates".
const PAGES: Record<AppTab, string[]> = {
  home: ['dashboard', 'home', 'overview', 'start'],
  projects: ['projects', 'project', 'board', 'cards', 'tasks'],
  nexus: ['nexus', 'nexxus', 'next us'],
  chat: ['chat', 'talk', 'conversation', 'messages'],
  'my-ai': ['team', 'my ai', 'teammates', 'agents', 'my team'],
  pipelines: ['workflows', 'workflow', 'pipelines', 'pipeline'],
  files: ['files', 'file', 'folders'],
  updates: ['code updates', 'code update', 'updates', 'update', 'code'],
  devices: ['devices', 'device', 'tablet', 'phones', 'this pc'],
  remote: ['remote', 'remote connection', 'pairing', 'pair'],
  settings: ['account', 'settings', 'connect', 'connections', 'keys'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// "open the devices page" -> 'devices'. Returns null when no page name was heard.
export function pageFromSpeech(said: string): AppTab | null {
  const text = ` ${norm(said)} `;
  let best: { tab: AppTab; len: number } | null = null;
  for (const [tab, words] of Object.entries(PAGES) as [AppTab, string[]][]) {
    for (const w of words) {
      if (text.includes(` ${w} `) && (!best || w.length > best.len)) best = { tab, len: w.length };
    }
  }
  return best?.tab ?? null;
}

const speechApi = (): any => (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

// Top bar mic: press it and say a page ("Devices", "open the team", "go to code updates") to show that page.
// It keeps listening until you press it again (or Escape), so you can hop between pages by voice.
export const VoiceCommands: React.FC<{ setActiveTab: (t: AppTab) => void }> = ({ setActiveTab }) => {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<{ text: string; tab: AppTab | null } | null>(null);
  const [error, setError] = useState('');
  const rec = useRef<any>(null);
  const wanted = useRef(false);
  const clearTimer = useRef<number | undefined>(undefined);

  const stop = () => {
    wanted.current = false;
    setListening(false);
    try {
      rec.current?.stop();
    } catch {}
  };

  const start = () => {
    setError('');
    const Recognition = speechApi();
    if (!Recognition) {
      setError("This browser can't listen. Use Chrome or Edge.");
      return;
    }
    if (!window.isSecureContext) {
      setError('Voice needs the hub opened as localhost (or https) on this device.');
      return;
    }
    const r = new Recognition();
    r.lang = 'en-US';
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.onresult = (e: any) => {
      const result = e.results[e.results.length - 1];
      const options = Array.from(result as ArrayLike<any>).map((a: any) => String(a.transcript));
      const tab = options.map(pageFromSpeech).find(Boolean) || null;
      setHeard({ text: options[0]?.trim() || '', tab });
      if (tab) setActiveTab(tab);
      window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setHeard(null), 4000);
    };
    r.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      wanted.current = false;
      setListening(false);
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone blocked. Allow it in the address bar, then try again.'
          : e.error === 'network'
            ? "Voice needs the internet in this browser (it's Google's/Microsoft's speech service)."
            : `Voice stopped: ${e.error}`,
      );
    };
    // Browsers stop after a pause; start again while the mic is still switched on.
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start();
        } catch {
          setListening(false);
        }
      } else setListening(false);
    };
    rec.current = r;
    wanted.current = true;
    try {
      r.start();
      setListening(true);
    } catch (err: any) {
      setError(err?.message || "Couldn't start the microphone.");
    }
  };

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stop();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening]);
  useEffect(() => () => stop(), []);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => (listening ? stop() : start())}
        aria-pressed={listening}
        aria-label={listening ? 'Stop voice commands' : 'Voice commands: say a page name'}
        title={listening ? 'Listening… say a page name (press again or Esc to stop)' : 'Voice commands: say a page name'}
        className={`relative rounded-lg p-1.5 transition-colors ${listening ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
      >
        {listening && <span className="absolute inset-0 animate-ping rounded-lg bg-red-400/30" aria-hidden />}
        {listening ? <Mic className="relative h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </button>
      {(listening || heard || error) && (
        <div role="status" aria-live="polite" className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {error ? (
            <p className="text-red-600 dark:text-red-400">{error}</p>
          ) : heard ? (
            <p className="text-slate-700 dark:text-slate-200">
              Heard “{heard.text}”
              {heard.tab ? <span className="font-medium text-emerald-600 dark:text-emerald-400"> → {TITLES[heard.tab]}</span> : <span className="text-amber-600 dark:text-amber-400">: no page name in that.</span>}
            </p>
          ) : (
            <>
              <p className="font-medium text-slate-900 dark:text-white">Listening… say a page</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {(Object.keys(PAGES) as AppTab[]).map((t) => TITLES[t]).join(' · ')}
                <br />e.g. “open devices”, “go to the team”, “show code updates”. Esc stops.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};
