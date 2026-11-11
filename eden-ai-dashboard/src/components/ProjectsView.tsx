import React, { useEffect, useState } from 'react';
import { Plus, X, Trash2, Settings2, MessageSquare, FolderGit2, Flag, Loader2, Check, RotateCcw, Eye, EyeOff, Bot, AlertTriangle, Sparkles, Link2, Network, Clock, Code2 } from 'lucide-react';
import { Formatted } from './ChatView.tsx';
import { WorkstreamTabs, WorkstreamDialog } from './Workstreams.tsx';
import { RunPicker } from './RunPicker.tsx';
import { WhyWaiting } from './WhyWaiting.tsx';
import { runsOf } from '../runs.ts';
import type { Agent, Branch, Card, CardColumn, CardSource, Project } from '../types/index.ts';
import { COLUMNS, type ProjectsApi } from '../projectsStore.ts';

interface ProjectsViewProps {
  api: ProjectsApi;
  agents: Agent[];
  onAsk: (text: string) => void; // open Chat with this text ready to send
  newProjectRequest?: number; // bumped by the sidebar's "New project"
  onOpenSource?: (card: Card) => void; // jump to the Nexus message a card came from
  onOpenBudgets?: () => void;
}

const COLORS = ['#6366F1', '#06B6D4', '#10B981', '#F97316', '#EC4899', '#8B5CF6', '#EAB308', '#F43F5E'];
const STATUS_LABEL: Record<Project['status'], string> = { active: 'Active', paused: 'Paused', done: 'Finished' };

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

const Dialog: React.FC<{ title: string; wide?: boolean; onClose: () => void; onSubmit: (e: React.FormEvent) => void; footer: React.ReactNode; children: React.ReactNode }> = ({
  title,
  wide,
  onClose,
  onSubmit,
  footer,
  children,
}) => {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[90vh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">{children}</div>
        <div className="flex items-center gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">{footer}</div>
      </form>
    </div>
  );
};

// ---------------------------------------------------------------- project form
const ProjectDialog: React.FC<{ project: Project | null; api: ProjectsApi; onClose: () => void }> = ({ project, api, onClose }) => {
  const [name, setName] = useState(project?.name || '');
  const [goal, setGoal] = useState(project?.goal || '');
  const [repo, setRepo] = useState(project?.repo || '');
  const [codebaseId, setCodebaseId] = useState(project?.codebaseId || '');
  const [codebases, setCodebases] = useState<{ id: string; name: string; dir: string }[]>([]);
  useEffect(() => {
    fetch('/api/updates')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCodebases(d.codebases.filter((c: any) => c.ok)))
      .catch(() => {});
  }, []);
  const [status, setStatus] = useState<Project['status']>(project?.status || 'active');
  const [color, setColor] = useState(project?.color || COLORS[api.projects.length % COLORS.length]);
  const [confirming, setConfirming] = useState(false);
  const cardCount = project ? api.cards.filter((c) => c.projectId === project.id).length : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api.saveProject({ id: project?.id, name, goal, repo, status, color, codebaseId });
    onClose();
  };

  return (
    <Dialog
      title={project ? 'Project settings' : 'New project'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {project &&
            (confirming ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-slate-600 dark:text-slate-300">Delete it and its {cardCount} card{cardCount === 1 ? '' : 's'}?</span>
                <button
                  type="button"
                  onClick={async () => {
                    await api.deleteProject(project.id);
                    onClose();
                  }}
                  className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-500"
                >
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="flex items-center gap-1.5 text-sm text-red-600 hover:underline dark:text-red-400">
                <Trash2 className="h-4 w-4" /> Delete project
              </button>
            ))}
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
            {project ? 'Save' : 'Create project'}
          </button>
        </>
      }
    >
      <div>
        <label htmlFor="pj-name" className={labelClass}>Name</label>
        <input id="pj-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Project Nova" className={inputClass} />
      </div>
      <div>
        <label htmlFor="pj-goal" className={labelClass}>What is it, and what's the goal?</label>
        <textarea id="pj-goal" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. A cozy farming game for PC. Goal: playable demo on itch.io by March." className={inputClass} />
      </div>
      {codebases.length > 0 && (
        <div>
          <label htmlFor="pj-code" className={labelClass}>Code this project works on (optional)</label>
          <select id="pj-code" value={codebaseId} onChange={(e) => setCodebaseId(e.target.value)} className={inputClass}>
            <option value="">None</option>
            {codebases.map((c) => (
              <option key={c.id} value={c.id}>{c.name}: {c.dir}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Cards in this project get a "Change the code" button: the AI makes the change on a copy, and you review it in Code updates.</p>
        </div>
      )}
      <div>
        <label htmlFor="pj-repo" className={labelClass}>GitHub repository (optional)</label>
        <input id="pj-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name or a GitHub link" className={inputClass} />
      </div>
      <div className="flex flex-wrap items-end gap-6">
        {project && (
          <div>
            <label htmlFor="pj-status" className={labelClass}>Status</label>
            <select id="pj-status" value={status} onChange={(e) => setStatus(e.target.value as Project['status'])} className={inputClass}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <span className={labelClass}>Colour</span>
          <div className="flex gap-2 py-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                style={{ backgroundColor: c }}
                className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900' : ''}`}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
};


// When to start: now, or queued for later. Quick choices plus an exact time.
const nextAt = (hour: number, dayOffset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
};
const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const whenLabel = (iso?: string) =>
  iso ? new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'As soon as possible';

const StartPicker: React.FC<{ value?: string; onChange: (iso: string | undefined) => void; id?: string }> = ({ value, onChange, id }) => {
  const quick: { label: string; at: () => string | undefined }[] = [
    { label: 'Now', at: () => undefined },
    { label: 'In 1 hour', at: () => new Date(Date.now() + 3600000).toISOString() },
    { label: 'Tonight 10 pm', at: () => nextAt(22) },
    { label: 'Tomorrow 9 am', at: () => nextAt(9, 1) },
  ];
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => onChange(q.at())}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              (q.label === 'Now' && !value) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-slate-300 text-slate-600 hover:border-indigo-400 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            {q.label}
          </button>
        ))}
        <input
          id={id}
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)}
          aria-label="Exact start time"
          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        />
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{value ? `Queued: the AI starts it ${whenLabel(value)} (if it's in Ready).` : 'Starts as soon as it is in Ready.'}</p>
    </div>
  );
};

// ---------------------------------------------------------------- card form
const CardDialog: React.FC<{ card: Card; project: Project; agents: Agent[]; api: ProjectsApi; onAsk: (text: string) => void; onOpenSource?: (card: Card) => void; onClose: () => void }> = ({
  card,
  project,
  agents,
  api,
  onAsk,
  onOpenSource,
  onClose,
}) => {
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);
  const [assigneeId, setAssigneeId] = useState(card.assigneeId || '');
  const [column, setColumn] = useState<CardColumn>(card.column);
  const [priority, setPriority] = useState(card.priority);
  const [note, setNote] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>(card.dependsOn || []);
  const [branchId, setBranchId] = useState(card.branchId || project.branches?.[0]?.id || '');
  const [startAfter, setStartAfter] = useState<string | undefined>(card.startAfter);
  const siblings = api.cards.filter((c) => c.projectId === card.projectId && c.id !== card.id);
  const assignee = agents.find((a) => a.id === assigneeId);
  const inReview = card.column === 'review';
  const working = card.runState === 'running';

  // Review decisions. Approve finishes the card; send back re-queues it with your note for the teammate.
  const approve = async () => {
    await api.saveCard({ id: card.id, title, details, assigneeId, priority, column: 'done', note: note.trim() || undefined });
    onClose();
  };
  const sendBack = async () => {
    if (!note.trim()) return;
    await api.saveCard({ id: card.id, title, details, assigneeId, priority, column: 'ready', note: note.trim() });
    onClose();
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;
    await api.saveCard({ id: card.id, title, details, assigneeId, column, priority, dependsOn, branchId, startAfter: startAfter || '', note: note.trim() || undefined });
    onClose();
  };

  // Hands the card to its teammate (or Chief) in Chat. The card itself is saved first.
  const [codeNote, setCodeNote] = useState('');
  const changeCode = async () => {
    await api.saveCard({ id: card.id, title, details, assigneeId, column, priority });
    try {
      const res = await fetch('/api/updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codebaseId: project.codebaseId, cardId: card.id, request: `${title.trim()}${details.trim() ? `\n\n${details.trim()}` : ''}${project.goal ? `\n\n(Project goal: ${project.goal})` : ''}` }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not start the code change.');
      await api.saveCard({ id: card.id, column: 'doing', note: 'Sent to Code updates: the AI is changing the code. Review it there; when you apply it, this card moves to Review.' });
      setCodeNote('Sent. If another change is running, it waits its turn. Watch it and review it in Code updates.');
    } catch (err: any) {
      setCodeNote(err.message);
    }
  };

  const ask = async () => {
    await api.saveCard({ id: card.id, title, details, assigneeId, column, priority });
    const who = assignee ? `@${assignee.name.split(' ')[0]} ` : '';
    const goal = project.goal ? `\nProject goal: ${project.goal}` : '';
    onAsk(`${who}Please work on this for the project "${project.name}".${goal}\n\nTask: ${title.trim()}${details.trim() ? `\n\n${details.trim()}` : ''}`);
  };

  return (
    <Dialog
      title={working ? `${assignee?.name || 'A teammate'} is working on this…` : inReview ? 'Review this card' : 'Card'}
      wide
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button
            type="button"
            onClick={async () => {
              await api.deleteCard(card.id);
              onClose();
            }}
            className="flex items-center gap-1.5 text-sm text-red-600 hover:underline dark:text-red-400"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
          {inReview ? (
            <>
              <button
                type="button"
                onClick={sendBack}
                disabled={!note.trim()}
                title={note.trim() ? '' : 'Write what to change in the note box first'}
                className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" /> Send back
              </button>
              <button type="button" onClick={approve} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                <Check className="h-4 w-4" /> Approve
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={ask} className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                <MessageSquare className="h-4 w-4" /> Ask {assignee ? assignee.name.split(' ')[0] : 'Chief'}
              </button>
              {project.codebaseId && (
                <button type="button" onClick={changeCode} title="The AI changes the code on a copy; you review it in Code updates" className="flex items-center gap-1.5 rounded-lg border border-indigo-300 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                  <Code2 className="h-4 w-4" /> Change the code
                </button>
              )}
              <button type="submit" disabled={!title.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
                Save
              </button>
            </>
          )}
        </>
      }
    >
      {codeNote && <p role="status" className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">{codeNote}</p>}
      {card.source && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm text-slate-700 dark:border-indigo-500/30 dark:bg-indigo-950/30 dark:text-slate-200">
          {card.source.kind === 'nexus' ? <Network className="h-4 w-4 shrink-0 text-indigo-500" /> : <Sparkles className="h-4 w-4 shrink-0 text-indigo-500" />}
          <span className="min-w-0 flex-1">
            {card.source.kind === 'nexus' ? (
              <>From the Nexus discussion in <b>{card.source.roomName || 'a room'}</b></>
            ) : (
              <>From a plan by Chief{card.source.label ? <>: <span className="italic">“{card.source.label}”</span></> : ''}</>
            )}
            <span className="text-slate-500"> · {new Date(card.source.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
          </span>
          {card.source.kind === 'nexus' && card.source.roomId && onOpenSource && (
            <button type="button" onClick={() => onOpenSource(card)} className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500">
              Open conversation
            </button>
          )}
        </div>
      )}
      <div>
        <label htmlFor="cd-title" className={labelClass}>Title</label>
        <input id="cd-title" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label htmlFor="cd-details" className={labelClass}>Details</label>
        <textarea id="cd-details" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What needs doing, and what does done look like?" className={inputClass} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="cd-who" className={labelClass}>Who</label>
          <select id="cd-who" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
            <option value="">Nobody yet</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cd-col" className={labelClass}>Column</label>
          <select id="cd-col" value={column} onChange={(e) => setColumn(e.target.value as CardColumn)} className={inputClass}>
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cd-pri" className={labelClass}>Priority</label>
          <select id="cd-pri" value={priority} onChange={(e) => setPriority(e.target.value as Card['priority'])} className={inputClass}>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
      {(project.branches || []).length > 1 && (
        <div>
          <label htmlFor="cd-branch" className={labelClass}>Workstream</label>
          <select id="cd-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
            {(project.branches || []).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="cd-start" className={labelClass}>When to start</label>
        <StartPicker id="cd-start" value={startAfter} onChange={setStartAfter} />
      </div>
      <div>
        <label htmlFor="cd-waits" className={labelClass}>Waits for</label>
        {dependsOn.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {dependsOn.map((id) => {
              const dep = siblings.find((c) => c.id === id);
              if (!dep) return null;
              return (
                <li key={id} className="flex items-center gap-1.5 rounded-full border border-slate-300 py-0.5 pl-2.5 pr-1 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  {dep.title}
                  <span className={dep.column === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>{dep.column === 'done' ? 'done' : 'not done'}</span>
                  <button type="button" onClick={() => setDependsOn(dependsOn.filter((d) => d !== id))} aria-label={`Stop waiting for ${dep.title}`} className="rounded-full p-0.5 text-slate-400 hover:text-red-500">
                    <X className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <select
          id="cd-waits"
          value=""
          onChange={(e) => e.target.value && setDependsOn([...dependsOn, e.target.value])}
          disabled={siblings.every((c) => dependsOn.includes(c.id))}
          className={inputClass}
        >
          <option value="">{siblings.length ? 'Add a card that must be done first…' : 'No other cards in this project yet'}</option>
          {siblings
            .filter((c) => !dependsOn.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
        </select>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">The AI won't start this card until these are Done, and it is given their results.</p>
      </div>
      <div>
        <label htmlFor="cd-note" className={labelClass}>{inReview ? 'Result and notes' : 'Notes'}</label>
        {card.notes.length > 0 && (
          <ul className="mb-2 space-y-2">
            {card.notes.map((n) => (
              <li
                key={n.id}
                className={`rounded-lg px-3 py-2 text-sm ${
                  n.kind === 'error'
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                    : n.kind === 'result'
                      ? 'border border-indigo-200 bg-indigo-50/60 text-slate-900 dark:border-indigo-500/30 dark:bg-indigo-950/30 dark:text-slate-100'
                      : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {n.kind === 'result' ? <Formatted text={n.text} /> : <span className="whitespace-pre-wrap">{n.text}</span>}
                <span className="mt-1.5 block text-xs text-slate-500">
                  {n.author}
                  {n.via ? ` (answered with ${n.via})` : ''} · {new Date(n.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <textarea id="cd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={inReview ? 'To send it back, write what should change' : 'Add a note for yourself or for the teammate'} className={inputClass} />
      </div>
    </Dialog>
  );
};

// ---------------------------------------------------------------- who is doing what
// One tile per teammate with cards on this project, showing what they are doing right now.
const TeamStrip: React.FC<{ cards: Card[]; agents: Agent[]; filter: string; onFilter: (id: string) => void }> = ({ cards, agents, filter, onFilter }) => {
  const involved = agents.filter((a) => cards.some((c) => c.assigneeId === a.id));
  const unassigned = cards.filter((c) => !c.assigneeId && c.column !== 'done').length;
  if (!involved.length) {
    return <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Nobody is assigned on this project yet. Assign a teammate on a card, or let Chief plan the work.</p>;
  }
  const firstBy = (list: Card[]) => [...list].sort((a, b) => a.order - b.order)[0];

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {involved.map((a) => {
        const mine = cards.filter((c) => c.assigneeId === a.id);
        const working = mine.find((c) => c.runState === 'running');
        const waiting = mine.find((c) => c.runState === 'waiting');
        const failed = mine.find((c) => c.runState === 'failed');
        const next = firstBy(mine.filter((c) => c.column === 'ready' && !c.runState));
        const review = mine.filter((c) => c.column === 'review').length;
        const todo = mine.filter((c) => c.column === 'todo').length;
        const done = mine.filter((c) => c.column === 'done').length;

        let line: React.ReactNode;
        let tone = 'text-slate-500 dark:text-slate-400';
        if (working) {
          tone = 'text-indigo-600 dark:text-indigo-400';
          line = (
            <>
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> <span className="truncate">Working on: {working.title}</span>
            </>
          );
        } else if (waiting) {
          tone = 'text-amber-600 dark:text-amber-400';
          line = <span className="truncate">Waiting for AI budget</span>;
        } else if (next) {
          line = <span className="truncate">Up next: {next.title}</span>;
        } else if (failed) {
          tone = 'text-red-600 dark:text-red-400';
          line = <span className="truncate">Couldn't run: {failed.title}</span>;
        } else if (review) {
          tone = 'text-amber-600 dark:text-amber-400';
          line = <span className="truncate">{review} waiting for your review</span>;
        } else if (todo) {
          line = <span className="truncate">Idle · {todo} in To do</span>;
        } else {
          line = <span className="truncate">Idle · {done} done</span>;
        }

        const selected = filter === a.id;
        return (
          <button
            key={a.id}
            onClick={() => onFilter(selected ? '' : a.id)}
            aria-pressed={selected}
            title={selected ? 'Show everyone\'s cards' : `Show only ${a.name}'s cards`}
            className={`flex max-w-xs items-center gap-2.5 rounded-full border bg-white py-1.5 pl-1.5 pr-4 text-left dark:bg-slate-900 ${
              selected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
            }`}
          >
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: a.color }}>
              {a.avatar || a.name.slice(0, 2).toUpperCase()}
              {working && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight text-slate-900 dark:text-white">{a.name}</span>
              <span className={`mt-0.5 flex items-center gap-1 text-xs leading-tight ${tone}`}>{line}</span>
            </span>
          </button>
        );
      })}
      {unassigned > 0 && <span className="self-center text-xs text-slate-500">{unassigned} card{unassigned === 1 ? '' : 's'} with nobody assigned</span>}
    </div>
  );
};

// ---------------------------------------------------------------- plan with Chief
interface PlannedCard {
  title: string;
  details: string;
  assigneeId: string;
  priority: Card['priority'];
  waitsFor: number[]; // positions of earlier cards in the plan
  include: boolean;
}

const PlanDialog: React.FC<{ project: Project; agents: Agent[]; api: ProjectsApi; initialGoal?: string; branchId?: string; source?: Omit<CardSource, 'at'>; onClose: () => void }> = ({ project, agents, api, initialGoal, branchId, source, onClose }) => {
  const [goal, setGoal] = useState(initialGoal || project.goal || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [via, setVia] = useState('');
  const [plan, setPlan] = useState<PlannedCard[] | null>(null);

  const ask = async () => {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/projects/${project.id}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Planning failed.');
      setSummary(data.summary);
      setVia(data.via);
      setPlan(data.cards.map((c: Omit<PlannedCard, 'include'>) => ({ ...c, include: true })));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const chosen = (plan || []).filter((c) => c.include);
  const update = (i: number, patch: Partial<PlannedCard>) => setPlan((p) => (p || []).map((c, j) => (j === i ? { ...c, ...patch } : c)));

  // Approved cards go to To do (you start them later) or straight to Ready (the AI starts now).
  const [queueAt, setQueueAt] = useState<string | undefined>(undefined);
  const add = async (column: CardColumn) => {
    setBusy(true);
    // Created in plan order so each card can point at the earlier ones it waits for.
    const created: Record<number, string> = {};
    const runId = `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    for (const [i, c] of (plan || []).entries()) {
      if (!c.include) continue;
      const dependsOn = (c.waitsFor || []).map((j) => created[j]).filter(Boolean);
      const saved = await api.saveCard({ projectId: project.id, title: c.title, details: c.details, assigneeId: c.assigneeId || undefined, priority: c.priority, column, dependsOn, branchId: branchId || undefined, startAfter: queueAt, source: { ...(source || { kind: 'plan', label: goal.trim().slice(0, 160) }), runId } });
      if (saved) created[i] = saved.id;
    }
    setBusy(false);
    onClose();
  };

  const startable = chosen.filter((c) => c.assigneeId).length;

  return (
    <Dialog
      title={plan ? 'Chief\'s plan' : 'Plan with Chief'}
      wide
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!plan) ask();
      }}
      footer={
        plan ? (
          <>
            <button type="button" onClick={() => setPlan(null)} disabled={busy} className="text-sm text-slate-600 hover:underline dark:text-slate-300">
              Change the request
            </button>
            <button
              type="button"
              onClick={() => add('todo')}
              disabled={busy || !chosen.length}
              className="ml-auto rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Add {chosen.length} to To do
            </button>
            <button
              type="button"
              onClick={() => add('ready')}
              disabled={busy || !chosen.length}
              title={`Puts ${startable} assigned card${startable === 1 ? '' : 's'} in Ready. Each runs when the cards it waits for are done, one AI message each.`}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {queueAt ? 'Approve and queue' : 'Approve and start'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onClose} className="ml-auto rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Cancel
            </button>
            <button type="submit" disabled={busy || !goal.trim()} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {busy ? 'Chief is planning…' : 'Ask Chief for a plan'}
            </button>
          </>
        )
      }
    >
      {!plan ? (
        <div>
          <label htmlFor="pl-goal" className={labelClass}>What do you want done on {project.name}?</label>
          <textarea
            id="pl-goal"
            autoFocus
            rows={5}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Get the Steam store page ready: copy, tags, price, and a list of screenshots we need."
            className={inputClass}
          />
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Chief splits this into cards and picks a teammate for each. Nothing is added to the board until you approve.</p>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        </div>
      ) : (
        <>
          {summary && <p className="text-sm text-slate-700 dark:text-slate-300">{summary}</p>}
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">When should the team start?</div>
            <StartPicker value={queueAt} onChange={setQueueAt} />
          </div>
          {via && <p className="text-xs text-slate-500">Planned with {via} because Chief's own AI isn't available right now.</p>}
          <ul className="space-y-2">
            {plan.map((c, i) => (
              <li key={i} className={`rounded-lg border p-3 ${c.include ? 'border-slate-200 dark:border-slate-700' : 'border-dashed border-slate-200 opacity-50 dark:border-slate-800'}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={c.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Include: ${c.title}`} className="mt-1 accent-indigo-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs tabular-nums text-slate-400">{i + 1}</span>
                      <input value={c.title} onChange={(e) => update(i, { title: e.target.value })} aria-label="Card title" className="w-full bg-transparent text-sm font-medium text-slate-900 focus:outline-none dark:text-white" />
                    </div>
                    {c.details && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{c.details}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select value={c.assigneeId} onChange={(e) => update(i, { assigneeId: e.target.value })} aria-label="Who does it" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                        <option value="">Nobody yet</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      {c.priority === 'high' && (
                        <span className="flex items-center gap-1 text-xs text-red-500">
                          <Flag className="h-3 w-3" /> High
                        </span>
                      )}
                      {(c.waitsFor || []).filter((j) => plan[j]?.include).length > 0 && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Link2 className="h-3 w-3" /> Starts after{' '}
                          {(c.waitsFor || [])
                            .filter((j) => plan[j]?.include)
                            .map((j) => j + 1)
                            .join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
};

// The project name with a gentle wave rolling across the letters.
const WaveText: React.FC<{ text: string }> = ({ text }) => (
  <span aria-label={text}>
    {Array.from(text).map((ch, i) => (
      <span key={i} aria-hidden="true" className="eden-wave-letter" style={{ animationDelay: `${i * 0.08}s` }}>
        {ch === ' ' ? ' ' : ch}
      </span>
    ))}
  </span>
);

// ---------------------------------------------------------------- page
export const ProjectsView: React.FC<ProjectsViewProps> = ({ api, agents, onAsk, newProjectRequest, onOpenSource, onOpenBudgets }) => {
  const { projects, active } = api;
  const [projectDialog, setProjectDialog] = useState<'new' | 'edit' | null>(null);
  useEffect(() => {
    if (newProjectRequest) setProjectDialog('new');
  }, [newProjectRequest]);
  const { openCardId, setOpenCardId } = api;
  const [addingIn, setAddingIn] = useState<CardColumn | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<CardColumn | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [whoFilter, setWhoFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState(''); // '' = all workstreams
  const [branchDialog, setBranchDialog] = useState<{ branch: Branch | null } | null>(null);
  // Show or hide the row of teammates; remembered between visits.
  const [showTeam, setShowTeam] = useState(() => {
    try {
      return localStorage.getItem('eden-projects-team') !== '0';
    } catch {
      return true;
    }
  });
  const toggleTeam = () => {
    // Hiding the row also clears any teammate filter, so the board never stays filtered with no way to undo it.
    if (showTeam) setWhoFilter('');
    setShowTeam((v) => {
      try {
        localStorage.setItem('eden-projects-team', v ? '0' : '1');
      } catch {}
      return !v;
    });
  };
  const [planGoal, setPlanGoal] = useState('');
  const [planSource, setPlanSource] = useState<Omit<CardSource, 'at'> | undefined>(undefined);

  // A plan sent over from Nexus opens the planning form with its text ready.
  useEffect(() => {
    const request = api.planRequest;
    if (!request || !active || request.projectId !== active.id) return;
    setPlanGoal(request.goal);
    setPlanSource(request.source);
    setPlanOpen(true);
    api.setPlanRequest(null);
  }, [api.planRequest, active?.id]);

  const allCards = active ? api.cards.filter((c) => c.projectId === active.id) : [];
  const cards = allCards.filter(api.visible);
  const runs = runsOf(allCards);
  const openCard = cards.find((c) => c.id === openCardId) || null;
  const autoRun = !!active && active.autoRun !== false && active.status === 'active';

  const addCard = async (column: CardColumn) => {
    const title = newTitle.trim();
    setNewTitle('');
    if (!title || !active) return setAddingIn(null);
    await api.saveCard({ projectId: active.id, title, column, branchId: branchFilter || undefined });
  };

  if (!projects.length) {
    return (
      <div className="mx-auto max-w-xl p-8 pt-24 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">No projects yet</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">A project is one game or product. Each gets its own board of cards.</p>
        <button onClick={() => setProjectDialog('new')} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          <Plus className="h-4 w-4" /> Create your first project
        </button>
        {projectDialog && <ProjectDialog project={null} api={api} onClose={() => setProjectDialog(null)} />}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      {active && (
        <>
          {/* Project header. Projects are picked in the sidebar. */}
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                <WaveText text={active.name} />
                {active.status !== 'active' && <span className="ml-2 text-sm font-normal text-slate-400">({STATUS_LABEL[active.status]})</span>}
              </h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {active.goal || (
                  <button onClick={() => setProjectDialog('edit')} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    Add a goal so your team knows what this project is
                  </button>
                )}
              </p>
              {active.repo && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                  <FolderGit2 className="h-3.5 w-3.5" /> {active.repo}
                </p>
              )}
            </div>
            <button
              onClick={() => {
                setPlanGoal('');
                setPlanSource(undefined);
                setPlanOpen(true);
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              <Sparkles className="h-4 w-4" /> Plan with Chief
            </button>
            <button
              onClick={() => api.saveProject({ id: active.id, autoRun: !autoRun })}
              role="switch"
              aria-checked={autoRun}
              title={autoRun ? 'Cards in Ready with a teammate assigned are worked on automatically' : 'Nothing runs automatically in this project'}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <span className={`relative h-4 w-7 rounded-full transition-colors ${autoRun ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${autoRun ? 'left-3.5' : 'left-0.5'}`} />
              </span>
              AI works Ready cards
            </button>
            <button
              onClick={toggleTeam}
              aria-pressed={showTeam}
              title={showTeam ? 'Hide the teammates row' : 'Show the teammates row'}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              {showTeam ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {showTeam ? 'Hide team' : 'Show team'}
            </button>
            <button onClick={() => setProjectDialog('edit')} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
              <Settings2 className="h-4 w-4" /> Settings
            </button>
          </div>

          <WhyWaiting
            cards={cards}
            autoRun={autoRun}
            onTurnOnAutoRun={() => api.saveProject({ id: active.id, autoRun: true })}
            onHandToAI={async (ids) => {
              for (const id of ids) await api.saveCard({ id, column: 'ready' });
            }}
            onOpenBudgets={() => onOpenBudgets?.()}
          />

          {api.error && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {api.error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3">
            <div className="min-w-0 flex-1">
              <WorkstreamTabs project={active} cards={cards} agents={agents} selected={branchFilter} onSelect={setBranchFilter} onEdit={(branch) => setBranchDialog({ branch })} />
            </div>
            <div className="mt-3">
              <RunPicker runs={runs} selected={api.runFilterOf(active.id)} onChange={(sel) => api.setRunFilter(active.id, sel)} />
            </div>
          </div>
          {api.runFilterOf(active.id) !== null && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Showing {cards.length} of {allCards.length} cards.{' '}
              <button onClick={() => api.setRunFilter(active.id, null)} className="text-indigo-600 hover:underline dark:text-indigo-400">Show all lines</button>
            </p>
          )}
          {showTeam && <TeamStrip cards={branchFilter ? cards.filter((c) => c.branchId === branchFilter) : cards} agents={agents} filter={whoFilter} onFilter={setWhoFilter} />}

          {/* Board */}
          <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
            {COLUMNS.map((col) => {
              const colCards = cards.filter((c) => c.column === col.id && (!whoFilter || c.assigneeId === whoFilter) && (!branchFilter || c.branchId === branchFilter)).sort((a, b) => a.order - b.order);
              return (
                <div
                  key={col.id}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setOverColumn(col.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverColumn((c) => (c === col.id ? null : c));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId) api.moveCard(dragId, col.id);
                    setDragId(null);
                    setOverColumn(null);
                  }}
                  className={`flex min-w-[15rem] flex-1 basis-0 flex-col rounded-xl border p-2 ${
                    overColumn === col.id ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-center justify-between px-2 py-1.5" title={col.hint}>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {col.label} <span className="font-normal text-slate-400">{colCards.length}</span>
                    </h2>
                    <button
                      onClick={() => {
                        setAddingIn(col.id);
                        setNewTitle('');
                      }}
                      aria-label={`Add a card to ${col.label}`}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto px-1 pb-1">
                    {addingIn === col.id && (
                      <input
                        autoFocus
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addCard(col.id);
                          if (e.key === 'Escape') setAddingIn(null);
                        }}
                        onBlur={() => addCard(col.id).then(() => setAddingIn(null))}
                        placeholder="Card title, then Enter"
                        className={inputClass}
                      />
                    )}
                    {colCards.map((card) => {
                      const who = agents.find((a) => a.id === card.assigneeId);
                      return (
                        <button
                          key={card.id}
                          draggable
                          onDragStart={(e) => {
                            setDragId(card.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', card.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverColumn(null);
                          }}
                          onDrop={(e) => {
                            // Dropping on a card puts the dragged card just above it.
                            e.preventDefault();
                            e.stopPropagation();
                            if (dragId && dragId !== card.id) api.moveCard(dragId, col.id, card.id);
                            setDragId(null);
                            setOverColumn(null);
                          }}
                          onClick={() => setOpenCardId(card.id)}
                          className={`block w-full cursor-grab rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-indigo-400 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500 ${
                            dragId === card.id ? 'opacity-40' : ''
                          }`}
                        >
                          <span className="block text-[15px] font-medium leading-snug text-slate-900 dark:text-white">
                            {card.source?.kind === 'nexus' && <Network className="mr-1 inline h-3 w-3 -translate-y-px text-indigo-500" aria-label={`From Nexus: ${card.source.roomName || 'a room'}`} />}
                            {card.title}
                          </span>
                          {!branchFilter && (active.branches || []).length > 1 && (() => {
                            const b = (active.branches || []).find((x) => x.id === card.branchId);
                            return b ? (
                              <span className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: b.color }} /> {b.name}
                              </span>
                            ) : null;
                          })()}
                          {card.runState === 'running' && (
                            <span className="mt-2 flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                              <Loader2 className="h-3 w-3 animate-spin" /> {who ? who.name : 'A teammate'} is working…
                            </span>
                          )}
                          {card.startAfter && Date.parse(card.startAfter) > Date.now() && card.column !== 'done' && (
                            <span className="mt-2 flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                              <Clock className="h-3 w-3" /> Starts {whenLabel(card.startAfter)}
                            </span>
                          )}
                          {card.runState === 'waiting' && !card.runMessage?.startsWith('Queued:') && (
                            <span className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {card.runMessage}
                            </span>
                          )}
                          {card.runState === 'failed' && (
                            <span className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Couldn't run. Open for details.
                            </span>
                          )}
                          {card.runState !== 'waiting' && (card.dependsOn || []).some((d) => cards.some((c) => c.id === d && c.column !== 'done')) && (
                            <span className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                              <Link2 className="h-3 w-3" /> Waits for {(() => { const n = (card.dependsOn || []).filter((d) => cards.some((c) => c.id === d && c.column !== 'done')).length; return `${n} card${n === 1 ? '' : 's'}`; })()}
                            </span>
                          )}
                          {col.id === 'ready' && autoRun && !card.assigneeId && (
                            <span className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                              <Bot className="h-3 w-3" /> Assign a teammate to start
                            </span>
                          )}
                          {(who || card.priority === 'high' || card.notes.length > 0) && (
                            <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                              {who && (
                                <span className="flex items-center gap-1.5">
                                  <span className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white" style={{ backgroundColor: who.color }}>
                                    {who.avatar || who.name.slice(0, 2).toUpperCase()}
                                  </span>
                                  {who.name}
                                </span>
                              )}
                              {card.priority === 'high' && (
                                <span className="flex items-center gap-1 text-red-500">
                                  <Flag className="h-3 w-3" /> High
                                </span>
                              )}
                              {card.notes.length > 0 && <span className="ml-auto">{card.notes.length} note{card.notes.length === 1 ? '' : 's'}</span>}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {!colCards.length && addingIn !== col.id && (
                      <p className="px-2 py-3 text-xs text-slate-400">{col.id === 'ready' && autoRun ? 'Put a card here with a teammate assigned and they start on it' : col.hint}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {planOpen && active && <PlanDialog key={`${active.id}-${planGoal.length}`} project={active} agents={agents} api={api} initialGoal={planGoal} source={planSource} branchId={branchFilter} onClose={() => setPlanOpen(false)} />}
      {branchDialog && active && (
        <WorkstreamDialog
          project={active}
          branch={branchDialog.branch}
          agents={agents}
          onClose={() => setBranchDialog(null)}
          onSaved={(id) => {
            setBranchDialog(null);
            api.refresh();
            setBranchFilter(id);
          }}
        />
      )}
      {projectDialog && <ProjectDialog project={projectDialog === 'edit' ? active || null : null} api={api} onClose={() => setProjectDialog(null)} />}
      {openCard && active && <CardDialog key={openCard.id} card={openCard} project={active} agents={agents} api={api} onAsk={onAsk} onOpenSource={(c) => { setOpenCardId(null); onOpenSource?.(c); }} onClose={() => setOpenCardId(null)} />}
    </div>
  );
};
