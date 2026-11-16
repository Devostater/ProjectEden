// 🧭 Trail: what the AI team did on a project, and where things went quiet or got stuck.
// - Timeline: every step (card started, AI result, research, sent back, approved, failed) as a short snippet.
// - Threads: one line per card showing its steps as dots, with a flag where it trailed off.
// - Click any snippet or thread for the full debrief: everything that was written, the sources it used, who did it,
//   how long each step took, and where the card came from.
// Built from the cards and their notes only; nothing new is stored.
import React, { useMemo, useState } from 'react';
import { X, Globe, ArrowLeft, ExternalLink } from 'lucide-react';
import type { Agent, Card, CardNote, Project } from '../types/index.ts';
import { Formatted } from './ChatView.tsx';

const DAY = 24 * 60 * 60 * 1000;
const STALL_DAYS = 7; // an open card nobody touched for this long has gone quiet
const REVIEW_DAYS = 2; // finished work waiting for you this long is flagged

type Flag = 'stalled' | 'waiting' | 'bouncing' | 'failed' | 'gaveup' | 'running' | 'done' | 'open';
const FLAG: Record<Flag, { label: string; icon: string; tone: string; hint: string }> = {
  stalled: { label: 'Went quiet', icon: '⏸', tone: 'text-amber-600 dark:text-amber-400', hint: `Open, but nothing has happened for ${STALL_DAYS}+ days` },
  waiting: { label: 'Waiting for you', icon: '⏳', tone: 'text-sky-600 dark:text-sky-400', hint: `Finished work in Review for ${REVIEW_DAYS}+ days` },
  bouncing: { label: 'Going round', icon: '🔁', tone: 'text-fuchsia-600 dark:text-fuchsia-400', hint: 'Sent back twice or more: the brief may need rethinking' },
  failed: { label: 'Failed', icon: '⚠️', tone: 'text-red-600 dark:text-red-400', hint: 'The last try failed' },
  gaveup: { label: "Didn't get there", icon: '🚧', tone: 'text-orange-600 dark:text-orange-400', hint: 'The latest result says it could not do the job (e.g. research found the wrong things). Send it back with a sharper brief, or try another teammate.' },
  running: { label: 'Working now', icon: '⚙️', tone: 'text-indigo-600 dark:text-indigo-400', hint: 'A teammate is on it right now' },
  done: { label: 'Done', icon: '✅', tone: 'text-emerald-600 dark:text-emerald-400', hint: 'Approved' },
  open: { label: 'In progress', icon: '•', tone: 'text-slate-500', hint: 'On the board' },
};

const ms = (s?: string) => (s ? new Date(s).getTime() : 0);
const ago = (s?: string) => {
  const d = Date.now() - ms(s);
  if (!s || isNaN(d)) return '';
  const m = Math.round(d / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const span = (a?: string, b?: string) => {
  const d = ms(b) - ms(a);
  if (!a || !b || d <= 0) return '';
  const m = Math.round(d / 60000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};
// A plain-text snippet of Markdown: no headings marks, links reduced to their text, short.
const snippet = (t: string, n = 220) => {
  const plain = t
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > n ? `${plain.slice(0, n).replace(/\s+\S*$/, '')}…` : plain;
};
// A result where the AI says it couldn't do the job (it still counts as a result, but the thread didn't get there).
const GAVE_UP = /(I|we) (cannot|can't|could not|couldn't|was unable to|am unable to|wasn't able to) (fulfill|complete|finish|find|answer|do this|provide|access)|(do|does) not (contain|list|include) (any|the)[^.]{0,80}(relevant|needed|games|information|data)|to complete this[^.]{0,60}(I|we) (need|would need)/i;
const gaveUp = (n?: CardNote) => !!n && n.kind === 'result' && GAVE_UP.test(n.text.slice(0, 1500));

// Research = the teammate used the web, or the result ends with a list of sources.
const isResearch = (n: CardNote) => n.kind === 'result' && (n.web || /\n#{0,4}\s*\**sources\**:?\s*\n/i.test(n.text));
const sourcesOf = (t: string) => {
  const urls = new Map<string, string>();
  for (const m of t.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) urls.set(m[2], m[1]);
  for (const m of t.matchAll(/(?<!\()https?:\/\/[^\s)>\]]+/g)) if (!urls.has(m[0])) urls.set(m[0], m[0].replace(/^https?:\/\/(www\.)?/, '').split('/')[0]);
  return [...urls.entries()].map(([url, title]) => ({ url, title }));
};

function flagOf(c: Card): Flag {
  if (c.runState === 'failed') return 'failed';
  if (c.runState === 'running') return 'running';
  if (c.column === 'done') return 'done';
  const lastResult = [...(c.notes || [])].reverse().find((n) => n.kind === 'result');
  if (gaveUp(lastResult)) return 'gaveup';
  if ((c.notes || []).filter((n) => n.kind === 'feedback').length >= 2) return 'bouncing';
  if (c.column === 'review' && Date.now() - ms(c.reviewAt || c.updatedAt) > REVIEW_DAYS * DAY) return 'waiting';
  if ((c.column === 'todo' || c.column === 'ready') && Date.now() - ms(c.updatedAt) > STALL_DAYS * DAY) return 'stalled';
  return 'open';
}

interface Step {
  key: string;
  card: Card;
  at: string;
  kind: 'start' | 'result' | 'research' | 'feedback' | 'error' | 'note' | 'done';
  who: string;
  text: string;
  note?: CardNote;
}
const STEP_STYLE: Record<Step['kind'], { icon: string; label: string; dot: string }> = {
  start: { icon: '🌱', label: 'Started', dot: 'bg-slate-400' },
  result: { icon: '🧠', label: 'AI result', dot: 'bg-indigo-500' },
  research: { icon: '🔎', label: 'Research', dot: 'bg-sky-500' },
  feedback: { icon: '↩️', label: 'Sent back', dot: 'bg-fuchsia-500' },
  error: { icon: '⚠️', label: 'Failed', dot: 'bg-red-500' },
  note: { icon: '📝', label: 'Note', dot: 'bg-slate-300' },
  done: { icon: '✅', label: 'Approved', dot: 'bg-emerald-500' },
};

function stepsOf(c: Card, agents: Agent[]): Step[] {
  const who = agents.find((a) => a.id === c.assigneeId)?.name || 'Unassigned';
  const origin = c.source ? (c.source.kind === 'nexus' ? `From Nexus${c.source.roomName ? ` "${c.source.roomName}"` : ''}` : 'From Plan with Chief') + (c.source.label ? `: ${c.source.label}` : '') : '';
  const out: Step[] = [{ key: `${c.id}-start`, card: c, at: c.createdAt, kind: 'start', who: origin ? 'Plan' : 'You', text: [c.title, origin].filter(Boolean).join(' · ') }];
  for (const n of c.notes || []) {
    const kind: Step['kind'] = n.kind === 'result' ? (isResearch(n) ? 'research' : 'result') : n.kind === 'feedback' ? 'feedback' : n.kind === 'error' ? 'error' : 'note';
    out.push({ key: n.id, card: c, at: n.at, kind, who: n.author || who, text: n.text, note: n });
  }
  if (c.column === 'done') out.push({ key: `${c.id}-done`, card: c, at: c.doneAt || c.updatedAt, kind: 'done', who: 'You', text: c.title });
  return out.sort((a, b) => ms(a.at) - ms(b.at));
}

// ---------------------------------------------------------------- the full debrief of one card
const Debrief: React.FC<{ card: Card; agents: Agent[]; focus?: string; onBack: () => void; onOpenCard: (id: string) => void }> = ({ card, agents, focus, onBack, onOpenCard }) => {
  const steps = stepsOf(card, agents);
  const flag = flagOf(card);
  const results = (card.notes || []).filter((n) => n.kind === 'result');
  const firstResult = results[0];
  const sources = sourcesOf(results.map((r) => r.text).join('\n'));
  const assignee = agents.find((a) => a.id === card.assigneeId);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <button onClick={onBack} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="h-4 w-4" /> Trail
        </button>
        <b className="min-w-0 flex-1 truncate text-slate-900 dark:text-white">{card.title}</b>
        <span className={`text-sm ${FLAG[flag].tone}`} title={FLAG[flag].hint}>
          {FLAG[flag].icon} {FLAG[flag].label}
        </span>
        <button onClick={() => onOpenCard(card.id)} className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
          <ExternalLink className="h-3.5 w-3.5" /> Open card
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Facts */}
        <div className="mb-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800"><span className="block text-slate-500">Who</span>{assignee ? `${assignee.name} (${assignee.role})` : 'Unassigned'}</div>
          <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800"><span className="block text-slate-500">Started</span>{new Date(card.createdAt).toLocaleString()}{card.source && <span className="block text-slate-500">{card.source.kind === 'nexus' ? `Nexus${card.source.roomName ? `: ${card.source.roomName}` : ''}` : 'Plan with Chief'}</span>}</div>
          <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800"><span className="block text-slate-500">First result after</span>{firstResult ? span(card.createdAt, firstResult.at) || 'moments' : 'none yet'}</div>
          <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800"><span className="block text-slate-500">Rounds</span>{results.length} result{results.length === 1 ? '' : 's'} · {(card.notes || []).filter((n) => n.kind === 'feedback').length} sent back{card.doneAt ? ` · done in ${span(card.createdAt, card.doneAt)}` : ''}</div>
        </div>
        {card.details && (
          <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900/60">
            <span className="mb-1 block text-xs font-medium text-slate-500">The brief</span>
            <Formatted text={card.details} />
          </div>
        )}
        {sources.length > 0 && (
          <div className="mb-4">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500"><Globe className="h-3.5 w-3.5" /> Sources it used ({sources.length})</span>
            <div className="flex flex-wrap gap-1.5">
              {sources.slice(0, 30).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="max-w-xs truncate rounded-full border border-sky-200 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-50 dark:border-sky-900 dark:text-sky-300 dark:hover:bg-sky-950/40" title={s.url}>
                  {s.title}
                </a>
              ))}
            </div>
          </div>
        )}
        {/* Everything, in order */}
        <ol className="relative space-y-4 border-l border-slate-200 pl-5 dark:border-slate-800">
          {steps.map((s) => (
            <li key={s.key} className={`relative ${focus === s.key ? 'rounded-lg ring-2 ring-indigo-400/60' : ''}`}>
              <span className={`absolute -left-[1.62rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white dark:ring-slate-900 ${STEP_STYLE[s.kind].dot}`} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{STEP_STYLE[s.kind].icon} <b className="text-slate-700 dark:text-slate-200">{STEP_STYLE[s.kind].label}</b></span>
                <span>· {s.who}</span>
                {s.note?.via && <span>· via {s.note.via}</span>}
                {s.note?.revised && <span className="rounded bg-slate-100 px-1 dark:bg-slate-800">replaced by a newer version</span>}
                {gaveUp(s.note) && <span className="rounded bg-orange-100 px-1 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" title={FLAG.gaveup.hint}>🚧 didn't get there</span>}
                <span className="ml-auto" title={new Date(s.at).toLocaleString()}>{ago(s.at)}</span>
              </div>
              {s.kind !== 'start' && s.kind !== 'done' && (
                <div className={`mt-1 rounded-lg border p-3 ${s.kind === 'feedback' ? 'border-fuchsia-200 bg-fuchsia-50/60 dark:border-fuchsia-900 dark:bg-fuchsia-950/20' : s.kind === 'error' ? 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20' : 'border-slate-200 dark:border-slate-800'} ${s.note?.revised ? 'opacity-70' : ''}`}>
                  <Formatted text={s.text} />
                </div>
              )}
              {s.kind === 'start' && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{s.text}</p>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- the tab
export const WorkTrail: React.FC<{ project: Project; cards: Card[]; agents: Agent[]; onOpenCard: (id: string) => void }> = ({ cards, agents, onOpenCard }) => {
  const [view, setView] = useState<'timeline' | 'threads'>('timeline');
  const [only, setOnly] = useState<'all' | 'research' | Flag>('all');
  const [open, setOpen] = useState<{ cardId: string; focus?: string } | null>(null);

  const flags = useMemo(() => new Map(cards.map((c) => [c.id, flagOf(c)])), [cards]);
  const steps = useMemo(() => cards.flatMap((c) => stepsOf(c, agents)).sort((a, b) => ms(b.at) - ms(a.at)), [cards, agents]);
  const counts = useMemo(() => {
    const n: Record<string, number> = { research: steps.filter((s) => s.kind === 'research').length, results: steps.filter((s) => s.kind === 'result' || s.kind === 'research').length };
    for (const f of flags.values()) n[f] = (n[f] || 0) + 1;
    return n;
  }, [steps, flags]);

  const openCard = cards.find((c) => c.id === open?.cardId);
  if (openCard) return <Debrief card={openCard} agents={agents} focus={open?.focus} onBack={() => setOpen(null)} onOpenCard={onOpenCard} />;

  if (!cards.length) return <p className="p-4 text-sm text-slate-500">No cards yet. When the team works on cards, their research, results and your feedback show up here as a trail.</p>;

  const keep = (c: Card) => only === 'all' || only === 'research' || flags.get(c.id) === only;
  const shownSteps = steps.filter((s) => keep(s.card) && (only !== 'research' || s.kind === 'research'));
  const chip = (id: typeof only, text: string, n?: number, title?: string) => (
    <button key={id} onClick={() => setOnly(only === id ? 'all' : id)} aria-pressed={only === id} title={title} className={`rounded-full border px-2.5 py-0.5 text-xs ${only === id ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:border-indigo-400 dark:border-slate-700 dark:text-slate-300'}`}>
      {text}
      {n !== undefined && <span className="ml-1 tabular-nums opacity-75">{n}</span>}
    </button>
  );

  // Group the timeline by day.
  const days: { day: string; items: Step[] }[] = [];
  for (const s of shownSteps.slice(0, 400)) {
    const day = new Date(s.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    if (days[days.length - 1]?.day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(s);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="mr-2 flex overflow-hidden rounded-lg border border-slate-200 text-xs dark:border-slate-700">
          <button onClick={() => setView('timeline')} aria-pressed={view === 'timeline'} className={`px-2.5 py-1 ${view === 'timeline' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>Timeline</button>
          <button onClick={() => setView('threads')} aria-pressed={view === 'threads'} className={`px-2.5 py-1 ${view === 'threads' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>Threads</button>
        </div>
        {chip('all', 'All')}
        {chip('research', '🔎 Research', counts.research, 'Results where the teammate searched the web')}
        {(['gaveup', 'stalled', 'waiting', 'bouncing', 'failed', 'running', 'done'] as Flag[]).filter((f) => counts[f]).map((f) => chip(f, `${FLAG[f].icon} ${FLAG[f].label}`, counts[f], FLAG[f].hint))}
        <span className="ml-auto text-xs text-slate-500">{counts.results} AI results on {cards.length} cards</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {view === 'timeline' ? (
          days.length ? (
            days.map((d) => (
              <div key={d.day} className="mb-4">
                <h4 className="sticky top-0 z-[1] mb-2 bg-white/90 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400 backdrop-blur dark:bg-slate-900/90">{d.day}</h4>
                <div className="space-y-2">
                  {d.items.map((s) => {
                    const st = STEP_STYLE[s.kind];
                    const f = flags.get(s.card.id) || 'open';
                    return (
                      <button key={s.key} onClick={() => setOpen({ cardId: s.card.id, focus: s.key })} className="block w-full rounded-lg border border-slate-200 p-2.5 text-left hover:border-indigo-400 dark:border-slate-800 dark:hover:border-indigo-500">
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
                          <span>{st.icon} <b className="text-slate-700 dark:text-slate-200">{st.label}</b> · {s.who}</span>
                          {s.note?.web && <Globe className="h-3 w-3 text-sky-500" aria-label="used the web" />}
                          {gaveUp(s.note) && <span className="rounded bg-orange-100 px-1 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" title={FLAG.gaveup.hint}>🚧 didn't get there</span>}
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">· {s.card.title}</span>
                          {f !== 'open' && <span className={FLAG[f].tone} title={FLAG[f].hint}>{FLAG[f].icon}</span>}
                          <span className="shrink-0" title={new Date(s.at).toLocaleString()}>{new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </span>
                        {s.kind !== 'start' && s.kind !== 'done' && <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{snippet(s.text)}</span>}
                        {(s.kind === 'result' || s.kind === 'research') && <span className="mt-1 block text-xs text-indigo-600 dark:text-indigo-400">Full debrief →</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">Nothing matches that filter.</p>
          )
        ) : (
          <div className="space-y-1.5">
            {[...cards]
              .filter(keep)
              .sort((a, b) => {
                // Problems first (failed, gone quiet, going round, waiting), then most recent.
                const rank: Record<Flag, number> = { failed: 0, gaveup: 1, stalled: 2, bouncing: 3, waiting: 4, running: 5, open: 6, done: 7 };
                return rank[flags.get(a.id)!] - rank[flags.get(b.id)!] || ms(b.updatedAt) - ms(a.updatedAt);
              })
              .map((c) => {
                const st = stepsOf(c, agents);
                const f = flags.get(c.id)!;
                const last = st[st.length - 1];
                return (
                  <button key={c.id} onClick={() => setOpen({ cardId: c.id })} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-indigo-400 dark:border-slate-800 dark:hover:border-indigo-500">
                    <span className={`w-28 shrink-0 text-xs ${FLAG[f].tone}`} title={FLAG[f].hint}>{FLAG[f].icon} {FLAG[f].label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{c.title}</span>
                      <span className="block truncate text-xs text-slate-500">Last: {STEP_STYLE[last.kind].label.toLowerCase()} {ago(last.at)}{last.kind !== 'start' && last.kind !== 'done' ? ` · ${snippet(last.text, 90)}` : ''}</span>
                    </span>
                    {/* The card's steps, oldest to newest; a gap after the last one means it trailed off. */}
                    <span className="flex shrink-0 items-center" aria-label={`${st.length} steps`}>
                      {st.slice(-12).map((s, i) => (
                        <React.Fragment key={s.key}>
                          {i > 0 && <span className="h-px w-2 bg-slate-300 dark:bg-slate-700" />}
                          <span className={`h-2.5 w-2.5 rounded-full ${STEP_STYLE[s.kind].dot}`} title={`${STEP_STYLE[s.kind].label} · ${new Date(s.at).toLocaleString()}`} />
                        </React.Fragment>
                      ))}
                      {(f === 'stalled' || f === 'waiting') && <span className="ml-1 text-xs text-slate-400">· · · {ago(c.updatedAt)}</span>}
                    </span>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};
