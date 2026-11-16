import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, CornerDownLeft, ChevronDown, X } from 'lucide-react';
import type { AppTab } from './Sidebar.tsx';
import { TITLES } from './Header.tsx';
import { api } from '../api.ts';
import { parseCommand, examples, type Command } from '../commands.ts';
import { openPanel, isPhoneLayout } from '../panel.ts';

// What a command can do in the app. App.tsx provides these.
export interface CommandActions {
  go: (tab: AppTab) => void;
  openAccount: (tab: 'account' | 'connections' | 'preferences') => void;
  openChat: (text: string, send: boolean) => void;
  setDark: (dark: boolean | 'toggle') => void;
  create: (what: 'project' | 'teammate' | 'room') => void;
  newAziProject: (name: string) => void; // opens "New project in AZI" with the name filled in
  openProject: (id: string) => void;
  back: () => boolean; // false when there's no earlier page
  projects: { id: string; name: string }[];
  agents: { name: string }[];
}

const speechApi = (): any => (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
// Phones and tablets beep every time listening starts, so there the mic takes one command per press.
const onePerPress = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const ACCOUNT_LABEL = { account: 'Account', connections: 'Connections', preferences: 'Preferences' };
const PANEL_LABEL = { review: 'Review', activity: 'Activity', lyra: 'LYRA', terminal: 'Terminal' };

interface Outcome {
  ok: boolean;
  said: string;
  text: string;
}

// Top bar: the mic (say a command) and the command box (type one; Ctrl+K). Both understand the same things:
// pages ("devices"), Review and Activity, projects and teammates by name, "pause the AI", "dark mode",
// "ask Chief …". On a computer the mic keeps listening until you press it again or say "stop listening".
export const VoiceCommands: React.FC<{ actions: CommandActions }> = ({ actions }) => {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [hearing, setHearing] = useState(''); // words so far, while you are still speaking
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const rec = useRef<any>(null);
  const wanted = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The latest actions (projects and teammates change), for the speech callbacks that outlive a render.
  const act = useRef(actions);
  act.current = actions;

  const stop = () => {
    wanted.current = false;
    setListening(false);
    setHearing('');
    try {
      rec.current?.stop();
    } catch {}
  };
  const close = () => {
    stop();
    setOpen(false);
    setError('');
    setOutcome(null);
  };

  // Does what was asked, and says what happened.
  const perform = async (cmd: Command): Promise<{ ok: boolean; text: string }> => {
    const a = act.current;
    switch (cmd.kind) {
      case 'page':
        a.go(cmd.tab);
        return { ok: true, text: `→ ${TITLES[cmd.tab]}` };
      case 'account':
        a.openAccount(cmd.tab);
        return { ok: true, text: `→ Account: ${ACCOUNT_LABEL[cmd.tab]}` };
      case 'panel':
        if (isPhoneLayout() && (cmd.tab === 'lyra' || cmd.tab === 'terminal')) return { ok: false, text: `${PANEL_LABEL[cmd.tab]} is only on bigger screens.` };
        openPanel(cmd.tab);
        return { ok: true, text: `→ ${PANEL_LABEL[cmd.tab]}` };
      case 'project':
        a.openProject(cmd.id);
        return { ok: true, text: `→ ${cmd.name}` };
      case 'talk':
        a.openChat(`@${cmd.agent.split(' ')[0]} `, false);
        return { ok: true, text: `→ Chat with ${cmd.agent}` };
      case 'chat':
        a.openChat(cmd.text, true);
        return { ok: true, text: `Sent to Chat: “${cmd.text.length > 60 ? `${cmd.text.slice(0, 60)}…` : cmd.text}”` };
      case 'pause':
        try {
          await api('POST', '/api/ai/pause', { paused: cmd.paused });
          return { ok: true, text: cmd.paused ? 'AI paused. Say "resume" to carry on.' : 'AI resumed.' };
        } catch (err: any) {
          return { ok: false, text: err.message };
        }
      case 'theme':
        a.setDark(cmd.dark);
        return { ok: true, text: cmd.dark === 'toggle' ? 'Theme switched.' : cmd.dark ? 'Dark mode.' : 'Light mode.' };
      case 'new':
        a.create(cmd.what);
        return { ok: true, text: cmd.what === 'project' ? 'New project.' : cmd.what === 'teammate' ? 'Add a teammate.' : 'New Nexus room.' };
      case 'new-azi':
        a.newAziProject(cmd.name);
        return { ok: true, text: cmd.name ? `New project in AZI: “${cmd.name}”. Check the form and press Create.` : 'New project in AZI.' };
      case 'scroll': {
        // With two pages open, scroll the one you are in (each pane scrolls on its own).
        const main = document.querySelector('[data-pane-focus] [data-pane-scroll]') || document.querySelector('main');
        if (!main) return { ok: false, text: 'Nothing to scroll here.' };
        const from = main.scrollTop;
        const top = cmd.to === 'top' ? 0 : cmd.to === 'bottom' ? main.scrollHeight : from + (cmd.to === 'down' ? 1 : -1) * main.clientHeight * 0.8;
        main.scrollTo({ top, behavior: 'smooth' });
        // Some browsers skip the glide (reduced motion, a window in the background): jump there instead.
        setTimeout(() => main.scrollTop === from && main.scrollTo({ top }), 350);
        return { ok: true, text: `Scrolled ${cmd.to === 'top' || cmd.to === 'bottom' ? `to the ${cmd.to}` : cmd.to}.` };
      }
      case 'back':
        return a.back() ? { ok: true, text: 'Went back.' } : { ok: false, text: 'There is no earlier page to go back to.' };
      case 'help':
        setShowHelp(true);
        return { ok: true, text: 'Here is what you can say.' };
      case 'stop':
        stop();
        return { ok: true, text: 'Stopped listening.' };
    }
  };

  // One spoken or typed line. For speech, the browser's other guesses are tried when the first isn't a command.
  const handle = async (options: string[], wasTyped: boolean) => {
    const said = options[0]?.trim() || '';
    if (!said) return;
    const ctx = { projects: act.current.projects, agents: act.current.agents, typed: wasTyped };
    let cmd: Command | null = null;
    for (const o of options) if ((cmd = parseCommand(o, ctx))) break;
    window.clearTimeout(closeTimer.current);
    if (!cmd) {
      setOutcome({ ok: false, said, text: wasTyped ? "I didn't understand that. Try one from the list below." : 'No command in that.' });
      if (wasTyped) setShowHelp(true);
      return;
    }
    const result = await perform(cmd);
    setOutcome({ ...result, said });
    // A typed command that worked: tidy the box away. While the mic is on, the panel stays.
    if (result.ok && !wanted.current && cmd.kind !== 'help') closeTimer.current = window.setTimeout(() => setOpen(false), 1600);
  };

  const start = () => {
    setError('');
    setOutcome(null);
    setOpen(true);
    const Recognition = speechApi();
    if (!Recognition) {
      setError("This browser can't listen. Use Chrome or Edge, or type a command here.");
      return;
    }
    if (!window.isSecureContext) {
      setError("The mic only works when the hub is opened as localhost (this PC, or a phone or tablet plugged in with USB). Over Wi-Fi, type a command here instead.");
      return;
    }
    const single = onePerPress();
    const r = new Recognition();
    r.lang = 'en-US';
    r.continuous = !single;
    r.interimResults = !single;
    r.maxAlternatives = 3;
    r.onresult = (e: any) => {
      let partial = '';
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          setHearing('');
          handle(Array.from(result as ArrayLike<any>).map((alt: any) => String(alt.transcript)), false);
        } else partial += result[0]?.transcript || '';
      }
      if (partial) setHearing(partial.trim());
    };
    r.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      wanted.current = false;
      setListening(false);
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone blocked. Allow it in the address bar and try again, or type a command here.'
          : e.error === 'network'
            ? "The mic needs the internet in this browser (it uses Google's or Microsoft's speech service). You can still type a command here."
            : e.error === 'audio-capture'
              ? 'No microphone was found. Plug one in, or type a command here.'
              : `Voice stopped: ${e.error}`,
      );
    };
    // Browsers stop after a pause; start again while the mic is still switched on (computers only).
    r.onend = () => {
      if (wanted.current && !single) {
        try {
          r.start();
          return;
        } catch {}
      }
      wanted.current = false;
      setListening(false);
      setHearing('');
    };
    rec.current = r;
    wanted.current = true;
    try {
      r.start();
      setListening(true);
    } catch (err: any) {
      wanted.current = false;
      setError(err?.message || "Couldn't start the microphone.");
    }
  };

  // Ctrl+K (or Cmd+K) opens the command box; Alt+V switches the mic; Esc closes.
  const state = useRef({ open, listening });
  state.current = { open, listening };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (state.current.open && !state.current.listening) return close();
        setOpen(true);
        setTimeout(() => input.current?.focus(), 0);
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        if (state.current.listening) stop();
        else start();
      } else if (e.key === 'Escape' && state.current.open) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // A click anywhere else puts the box away (the mic keeps going if it's on; the button shows it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node) && !wanted.current) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => () => stop(), []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    setError('');
    handle([text], true);
  };

  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => (listening ? stop() : start())}
        aria-pressed={listening}
        aria-label={listening ? 'Stop voice commands' : 'Voice commands'}
        title={listening ? 'Listening… press again to stop (or say "stop listening")' : 'Voice commands: say "devices", "pause the AI", "ask Chief…" (Alt+V). Ctrl+K to type one.'}
        className={`relative rounded-lg p-1.5 transition-colors ${listening ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
      >
        {listening && <span className="absolute inset-0 animate-ping rounded-lg bg-red-400/30" aria-hidden />}
        {listening ? <Mic className="relative h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </button>
      {open && (
        <div role="dialog" aria-label="Commands" className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              ref={input}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={listening ? 'Listening… or type a command' : 'Type a command, e.g. devices'}
              aria-label="Type a command"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <button type="submit" aria-label="Run the command" disabled={!typed.trim()} className="shrink-0 rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-500 disabled:opacity-40">
              <CornerDownLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={close} aria-label="Close" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="h-4 w-4" />
            </button>
          </form>

          <div role="status" aria-live="polite" className="mt-2 min-h-5">
            {error ? (
              <p className="text-red-600 dark:text-red-400">{error}</p>
            ) : hearing ? (
              <p className="italic text-slate-500 dark:text-slate-400">Hearing: {hearing}…</p>
            ) : outcome ? (
              <p className="text-slate-700 dark:text-slate-200">
                “{outcome.said}” <span className={`font-medium ${outcome.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{outcome.text}</span>
              </p>
            ) : listening ? (
              <p className="font-medium text-slate-900 dark:text-white">Listening… say a command</p>
            ) : (
              <p className="text-slate-500 dark:text-slate-400">Type a command, or press the mic and say it.</p>
            )}
          </div>

          <button onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp} className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHelp ? '' : '-rotate-90'}`} /> What you can say
          </button>
          {showHelp && (
            <div className="mt-2 space-y-2 text-xs">
              {examples(actions).map((group) => (
                <div key={group.title}>
                  <div className="font-medium text-slate-700 dark:text-slate-300">{group.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {group.lines.map((line) => (
                      <button
                        key={line}
                        onClick={() => {
                          setTyped(line);
                          input.current?.focus();
                        }}
                        title="Puts it in the box; press Enter to run it"
                        className="rounded-full border border-slate-300 px-2 py-0.5 text-slate-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300">
                        {line}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="leading-relaxed text-slate-500">Any page, project or teammate works by name. You can start with “Eden, …”. Keys: Ctrl+K types a command, Alt+V switches the mic, Esc closes.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
