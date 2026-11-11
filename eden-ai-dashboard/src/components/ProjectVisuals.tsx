// Visual tabs for a project, shown in the bottom panel: Flow (cards and what waits for what),
// Workload (cards per teammate) and Progress (how the project is moving).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Card, CardColumn, Project } from '../types/index.ts';

// One colour per card state, defined in index.css for light and dark. The four hues were checked for
// colour-blind separation; "To do" is a neutral grey because nothing has started. Every use below also
// carries a text label or count, so state is never shown by colour alone.
export const STATES: { id: CardColumn; label: string; color: string }[] = [
  { id: 'todo', label: 'To do', color: 'var(--st-todo)' },
  { id: 'ready', label: 'Ready', color: 'var(--st-ready)' },
  { id: 'doing', label: 'In progress', color: 'var(--st-doing)' },
  { id: 'review', label: 'Review', color: 'var(--st-review)' },
  { id: 'done', label: 'Done', color: 'var(--st-done)' },
];
const stateOf = (id: CardColumn) => STATES.find((s) => s.id === id)!;

interface VisualProps {
  project: Project;
  cards: Card[];
  agents: Agent[];
  onOpenCard: (id: string) => void;
}

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{children}</p>;

const Legend: React.FC<{ cards: Card[] }> = ({ cards }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
    {STATES.map((s) => (
      <span key={s.id} className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
        {s.label} <span className="tabular-nums text-slate-400">{cards.filter((c) => c.column === s.id).length}</span>
      </span>
    ))}
  </div>
);

// ------------------------------------------------------------------ Flow
const NODE_W = 196;
const NODE_H = 48;
const GAP_X = 64;
const GAP_Y = 12;
const PAD = 12;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export const FlowTab: React.FC<VisualProps & { zoom?: number | 'fit' }> = ({ cards, agents, onOpenCard, zoom = 1 }) => {
  // Size of the visible area, so "Fit" can scale the graph to it.
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const depsOf = (c: Card) => (c.dependsOn || []).filter((d) => byId.has(d));
    const hasDependents = new Set(cards.flatMap(depsOf));
    const linked = cards.filter((c) => depsOf(c).length > 0 || hasDependents.has(c.id));
    const loose = cards.filter((c) => !linked.includes(c));

    // A card sits one step to the right of the furthest card it waits for.
    const level = new Map<string, number>();
    const levelOf = (c: Card, trail: Set<string> = new Set()): number => {
      if (level.has(c.id)) return level.get(c.id)!;
      if (trail.has(c.id)) return 0; // guards against a loop in old data
      trail.add(c.id);
      const l = depsOf(c).reduce((max, d) => Math.max(max, levelOf(byId.get(d)!, trail) + 1), 0);
      level.set(c.id, l);
      return l;
    };
    linked.forEach((c) => levelOf(c));

    const order = (a: Card, b: Card) => STATES.findIndex((s) => s.id === a.column) - STATES.findIndex((s) => s.id === b.column) || a.order - b.order;
    const pos = new Map<string, { x: number; y: number }>();
    const levels = Math.max(0, ...linked.map((c) => level.get(c.id)! + 1));
    let linkedRows = 0;
    for (let l = 0; l < levels; l++) {
      const column = linked.filter((c) => level.get(c.id) === l).sort(order);
      column.forEach((c, i) => pos.set(c.id, { x: PAD + l * (NODE_W + GAP_X), y: PAD + i * (NODE_H + GAP_Y) }));
      linkedRows = Math.max(linkedRows, column.length);
    }

    // Cards with no links go in a compact grid underneath.
    const perRow = Math.max(3, levels);
    const looseTop = linked.length ? PAD + linkedRows * (NODE_H + GAP_Y) + 26 : PAD;
    [...loose].sort(order).forEach((c, i) => pos.set(c.id, { x: PAD + (i % perRow) * (NODE_W + 16), y: looseTop + Math.floor(i / perRow) * (NODE_H + GAP_Y) }));

    const edges = linked.flatMap((c) => depsOf(c).map((d) => ({ from: byId.get(d)!, to: c })));
    const width = Math.max(...[...pos.values()].map((p) => p.x + NODE_W), 0) + PAD;
    const height = Math.max(...[...pos.values()].map((p) => p.y + NODE_H), 0) + PAD;
    return { pos, edges, width, height, looseTop, hasLinked: linked.length > 0, hasLoose: loose.length > 0 };
  }, [cards]);

  const scale = zoom === 'fit' ? (box.w && box.h ? Math.max(0.4, Math.min(1.5, box.w / layout.width, box.h / layout.height)) : 1) : zoom;

  if (!cards.length) return <Empty>No cards yet. Add some on the board, or let Chief plan the work, and they appear here as a graph.</Empty>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <Legend cards={cards} />
        <span className="text-xs text-slate-400">An arrow means the card on the right waits for the one on the left. Click a card to open it.</span>
      </div>
      <div ref={boxRef} className="min-h-0 flex-1 overflow-auto">
        <svg
          width={layout.width * scale}
          height={layout.height * scale}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="group" aria-label="Cards in this project and what they wait for" className="block">
          <defs>
            <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="var(--flow-line)" />
            </marker>
          </defs>

          {layout.hasLinked && layout.hasLoose && (
            <text x={PAD} y={layout.looseTop - 9} fontSize="11" fill="var(--flow-muted)">
              Not linked to other cards
            </text>
          )}

          {layout.edges.map(({ from, to }) => {
            const a = layout.pos.get(from.id)!;
            const b = layout.pos.get(to.id)!;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x - 3;
            const y2 = b.y + NODE_H / 2;
            const bend = Math.max(24, (x2 - x1) / 2);
            const waiting = from.column !== 'done';
            return (
              <path
                key={`${from.id}-${to.id}`}
                d={`M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--flow-line)"
                strokeWidth="1.5"
                strokeDasharray={waiting ? '4 3' : undefined}
                markerEnd="url(#flow-arrow)"
              >
                <title>{`"${to.title}" waits for "${from.title}"${waiting ? ' (not finished yet)' : ' (finished)'}`}</title>
              </path>
            );
          })}

          {cards.map((c) => {
            const p = layout.pos.get(c.id);
            if (!p) return null;
            const state = stateOf(c.column);
            const who = agents.find((a) => a.id === c.assigneeId);
            const running = c.runState === 'running';
            const sub = [running ? 'Working now' : c.runState === 'waiting' ? 'Waiting' : state.label, who?.name].filter(Boolean).join(' · ');
            return (
              <g
                key={c.id}
                transform={`translate(${p.x} ${p.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${c.title}. ${sub}. Open card.`}
                onClick={() => onOpenCard(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenCard(c.id);
                  }
                }}
                className={`flow-node cursor-pointer ${running ? 'flow-node-running' : ''}`}
              >
                <title>{`${c.title}\n${sub}${c.runMessage ? `\n${c.runMessage}` : ''}`}</title>
                <rect width={NODE_W} height={NODE_H} rx="8" fill="var(--flow-surface)" stroke={state.color} strokeWidth="1.5" />
                <rect x="0.75" y="0.75" width="5" height={NODE_H - 1.5} rx="3" fill={state.color} />
                <text x="14" y="20" fontSize="12.5" fontWeight="600" fill="var(--flow-ink)">
                  {clip(c.title, 27)}
                </text>
                <text x="14" y="36" fontSize="11" fill="var(--flow-muted)">
                  {clip(sub, 32)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ Workload
export const WorkloadTab: React.FC<VisualProps> = ({ cards, agents }) => {
  const rows = useMemo(() => {
    const people = agents
      .map((a) => ({ id: a.id, name: a.name, color: a.color, cards: cards.filter((c) => c.assigneeId === a.id) }))
      .filter((r) => r.cards.length)
      .sort((a, b) => b.cards.length - a.cards.length);
    const nobody = cards.filter((c) => !c.assigneeId || !agents.some((a) => a.id === c.assigneeId));
    return nobody.length ? [...people, { id: '', name: 'Nobody yet', color: '', cards: nobody }] : people;
  }, [cards, agents]);

  if (!cards.length) return <Empty>No cards yet. Once cards are assigned, this shows how the work is spread across your team.</Empty>;
  const most = Math.max(...rows.map((r) => r.cards.length));

  return (
    <div className="h-full overflow-y-auto p-3">
      <Legend cards={cards} />
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.id || 'nobody'} className="flex items-center gap-3 text-sm">
            <span className={`w-24 shrink-0 truncate ${r.id ? 'text-slate-800 dark:text-slate-200' : 'text-slate-500'}`}>{r.name}</span>
            <div className="flex h-5 min-w-0 flex-1 items-stretch">
              <div className="flex gap-0.5" style={{ width: `${(r.cards.length / most) * 100}%` }}>
                {STATES.map((s) => {
                  const n = r.cards.filter((c) => c.column === s.id).length;
                  if (!n) return null;
                  return (
                    <span
                      key={s.id}
                      title={`${r.name}: ${n} ${s.label.toLowerCase()}`}
                      className="flex min-w-[1.25rem] items-center justify-center rounded-[4px] text-[11px] font-medium tabular-nums"
                      style={{ flexGrow: n, flexBasis: 0, backgroundColor: s.color, color: s.id === 'review' ? '#0b0b0b' : '#ffffff' }}
                    >
                      {n}
                    </span>
                  );
                })}
              </div>
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums text-slate-500">
              {r.cards.length} card{r.cards.length === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ Progress
function duration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)} days`;
}

const Tile: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div className="min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
    <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    <div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{value}</div>
    {note && <div className="text-xs text-slate-500 dark:text-slate-400">{note}</div>}
  </div>
);

export const ProgressTab: React.FC<VisualProps> = ({ cards }) => {
  const stats = useMemo(() => {
    const done = cards.filter((c) => c.column === 'done');
    const inReview = cards.filter((c) => c.column === 'review');
    const reviewed = done.filter((c) => c.reviewAt && c.doneAt && Date.parse(c.doneAt) >= Date.parse(c.reviewAt));
    const avgReview = reviewed.length ? reviewed.reduce((sum, c) => sum + (Date.parse(c.doneAt!) - Date.parse(c.reviewAt!)), 0) / reviewed.length : null;
    const oldest = inReview.reduce<number | null>((max, c) => (c.reviewAt ? Math.max(max ?? 0, Date.now() - Date.parse(c.reviewAt)) : max), null);

    // Cards finished on each of the last 14 days (local time).
    const dayKey = (d: Date) => d.toLocaleDateString('en-CA');
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (13 - i));
      return { key: dayKey(d), date: d, count: 0 };
    });
    for (const c of done) {
      if (!c.doneAt) continue;
      const slot = days.find((d) => d.key === dayKey(new Date(c.doneAt!)));
      if (slot) slot.count += 1;
    }
    return { done, inReview, avgReview, oldest, days, peak: Math.max(1, ...days.map((d) => d.count)), dated: done.filter((c) => c.doneAt).length };
  }, [cards]);

  if (!cards.length) return <Empty>No cards yet. As cards move across the board, this shows how the project is progressing.</Empty>;
  const percent = Math.round((stats.done.length / cards.length) * 100);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-3">
      <div className="flex flex-wrap gap-2">
        <Tile label="Finished" value={`${percent}%`} note={`${stats.done.length} of ${cards.length} cards`} />
        <Tile label="Waiting for your review" value={String(stats.inReview.length)} note={stats.oldest !== null ? `oldest: ${duration(stats.oldest)}` : undefined} />
        <Tile label="Average time in review" value={stats.avgReview !== null ? duration(stats.avgReview) : '–'} note={stats.avgReview === null ? 'no reviewed cards yet' : undefined} />
        <Tile label="In progress now" value={String(cards.filter((c) => c.column === 'doing').length)} />
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">Where the cards are</div>
        <div className="flex h-6 gap-0.5">
          {STATES.map((s) => {
            const n = cards.filter((c) => c.column === s.id).length;
            if (!n) return null;
            return (
              <span
                key={s.id}
                title={`${s.label}: ${n} card${n === 1 ? '' : 's'}`}
                className="flex min-w-[1.5rem] items-center justify-center rounded-[4px] text-xs font-medium tabular-nums"
                style={{ flexGrow: n, flexBasis: 0, backgroundColor: s.color, color: s.id === 'review' ? '#0b0b0b' : '#ffffff' }}
              >
                {n}
              </span>
            );
          })}
        </div>
        <div className="mt-1.5">
          <Legend cards={cards} />
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">Cards finished per day, last 14 days</div>
        {stats.dated === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing finished in this period yet. Finish times are recorded from now on.</p>
        ) : (
          <div className="flex h-28 items-end gap-1 border-b border-slate-300 dark:border-slate-700" role="img" aria-label={`Cards finished per day: ${stats.days.map((d) => `${d.date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.count}`).join(', ')}`}>
            {stats.days.map((d) => (
              <div key={d.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${d.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.count} finished`}>
                {d.count > 0 && <span className="mb-0.5 text-[11px] tabular-nums text-slate-600 dark:text-slate-300">{d.count}</span>}
                <span className="w-full max-w-[1.5rem] rounded-t-[4px]" style={{ height: `${(d.count / stats.peak) * 78}%`, backgroundColor: 'var(--st-done)' }} />
              </div>
            ))}
          </div>
        )}
        {stats.dated > 0 && (
          <div className="mt-1 flex gap-1 text-[11px] text-slate-400">
            {stats.days.map((d, i) => (
              <span key={d.key} className="min-w-0 flex-1 text-center">
                {i % 2 === 1 || i === 13 ? d.date.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
