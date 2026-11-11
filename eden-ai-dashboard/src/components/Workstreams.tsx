// Workstreams on a project board: the tab row (All + each workstream) and the form for one workstream.
import React, { useEffect, useState } from 'react';
import { Plus, Settings2, X, Trash2 } from 'lucide-react';
import type { Agent, Branch, Card, Project } from '../types/index.ts';

const COLORS = ['#6366F1', '#06B6D4', '#10B981', '#F97316', '#EC4899', '#8B5CF6', '#EAB308', '#F43F5E'];

async function send(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export const WorkstreamTabs: React.FC<{
  project: Project;
  cards: Card[];
  agents: Agent[];
  selected: string; // '' = all
  onSelect: (id: string) => void;
  onEdit: (branch: Branch | null) => void; // null = new
}> = ({ project, cards, agents, selected, onSelect, onEdit }) => {
  const branches = project.branches || [];
  const chip = (active: boolean) =>
    `flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
      active ? 'border-indigo-500 bg-white font-medium text-slate-900 dark:bg-slate-900 dark:text-white' : 'border-slate-200 bg-white/60 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
    }`;

  return (
    <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Workstreams">
      <button role="tab" aria-selected={!selected} onClick={() => onSelect('')} className={chip(!selected)}>
        All <span className="tabular-nums text-slate-400">{cards.filter((c) => c.column !== 'done').length}</span>
      </button>
      {branches.map((b) => {
        const open = cards.filter((c) => c.branchId === b.id && c.column !== 'done').length;
        const working = cards.some((c) => c.branchId === b.id && c.runState === 'running');
        const people = b.memberIds.map((id) => agents.find((a) => a.id === id)).filter(Boolean) as Agent[];
        const active = selected === b.id;
        return (
          <span key={b.id} className={`${chip(active)} !gap-1 !p-0`}>
            <button role="tab" aria-selected={active} onClick={() => onSelect(b.id)} className="flex items-center gap-2 py-1.5 pl-3 pr-1">
              <span className={`h-2.5 w-2.5 rounded-full ${working ? 'animate-pulse' : ''}`} style={{ backgroundColor: b.color }} />
              {b.name}
              <span className="tabular-nums text-slate-400">{open}</span>
              {people.length > 0 && (
                <span className="ml-1 flex -space-x-1" aria-label={`Members: ${people.map((a) => a.name).join(', ')}`}>
                  {people.slice(0, 4).map((a) => (
                    <span key={a.id} title={a.name} className="flex h-5 w-5 items-center justify-center rounded-full border border-white text-[8px] font-bold text-white dark:border-slate-900" style={{ backgroundColor: a.color }}>
                      {a.avatar || a.name.slice(0, 2).toUpperCase()}
                    </span>
                  ))}
                </span>
              )}
            </button>
            <button onClick={() => onEdit(b)} aria-label={`Workstream settings: ${b.name}`} title="Name, colour and members" className="rounded-md py-1.5 pl-1 pr-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </span>
        );
      })}
      <button onClick={() => onEdit(null)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:hover:text-indigo-400">
        <Plus className="h-4 w-4" /> Workstream
      </button>
    </div>
  );
};

export const WorkstreamDialog: React.FC<{
  project: Project;
  branch: Branch | null;
  agents: Agent[];
  onClose: () => void;
  onSaved: (branchId: string) => void;
}> = ({ project, branch, agents, onClose, onSaved }) => {
  const used = (project.branches || []).map((b) => b.color);
  const [name, setName] = useState(branch?.name || '');
  const [memberIds, setMemberIds] = useState<string[]>(branch?.memberIds || []);
  const [color, setColor] = useState(branch?.color || COLORS.find((c) => !used.includes(c)) || COLORS[0]);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = !!branch && (project.branches || []).length > 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const d = await send('POST', `/api/projects/${project.id}/branches`, { id: branch?.id, name, memberIds, color });
      onSaved(branch?.id || d.project.branches.find((b: Branch) => b.name.toLowerCase() === name.trim().toLowerCase())?.id || '');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async () => {
    try {
      await send('DELETE', `/api/projects/${project.id}/branches/${branch!.id}`);
      onSaved('');
    } catch (err: any) {
      setError(err.message);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="font-semibold text-slate-900 dark:text-white">{branch ? 'Workstream settings' : 'New workstream'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto p-5">
          <div>
            <label htmlFor="ws-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
            <input id="ws-name" autoFocus required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Build, Marketing, Store page" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Who works here</legend>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              When these teammates have nothing of their own to do, they pick up unassigned Ready cards in this workstream.
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {agents.map((a) => {
                const checked = memberIds.includes(a.id);
                return (
                  <label key={a.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 ${checked ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-700'}`}>
                    <input type="checkbox" checked={checked} onChange={() => setMemberIds((ids) => (checked ? ids.filter((x) => x !== a.id) : [...ids, a.id]))} className="accent-indigo-600" />
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white" style={{ backgroundColor: a.color }}>
                      {a.avatar || a.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-900 dark:text-white">{a.name}</span>
                      <span className="block truncate text-xs text-slate-500">{a.role.split('(')[0].trim()}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Colour</span>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Colour ${c}`} aria-pressed={color === c} style={{ backgroundColor: c }} className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900' : ''}`} />
              ))}
            </div>
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          {canDelete &&
            (confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-slate-600 dark:text-slate-300">Its cards move to {(project.branches || []).find((b) => b.id !== branch!.id)?.name}.</span>
                <button type="button" onClick={remove} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-500">Delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-sm text-red-600 hover:underline dark:text-red-400">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            ))}
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
            {branch ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
};
