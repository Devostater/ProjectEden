// The list of Nexus rooms (pin, drag to reorder, open) and the form for creating or changing a room.
import React, { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Plus, Pin, GripVertical, X, Trash2, Loader2, Leaf } from 'lucide-react';
import type { Agent } from '../types/index.ts';

export interface RoomSummary {
  id: string;
  name: string;
  memberIds: string[];
  freeOnly: boolean;
  pinned: boolean;
  order: number;
  updatedAt: string;
  latest: number;
  preview: string;
  running: boolean;
}

const send = (method: string, url: string, body?: unknown) => api(method, url, body);

// Pinned rooms first, then the rest; each group in the order you dragged them.
export const sortRooms = (rooms: RoomSummary[]) => [...rooms].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);

export const RoomList: React.FC<{
  rooms: RoomSummary[];
  activeId: string;
  agents: Agent[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onChanged: () => void;
  compact?: boolean; // sidebar: no heading, one line per room
}> = ({ rooms, activeId, agents, onOpen, onNew, onChanged, compact = false }) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<RoomSummary[]>(() => sortRooms(rooms));
  useEffect(() => {
    if (!dragId) setOrder(sortRooms(rooms));
  }, [rooms, dragId]);

  const saveOrder = async (list: RoomSummary[]) => {
    await send('POST', '/api/nexus/rooms/order', { ids: list.map((r) => r.id) }).catch(() => {});
    onChanged();
  };

  // Rooms only move within their own group (pinned or not).
  const moveBefore = (id: string, target: string) => {
    if (id === target) return;
    setOrder((list) => {
      const moving = list.find((r) => r.id === id)!;
      const over = list.find((r) => r.id === target)!;
      if (moving.pinned !== over.pinned) return list;
      const next = list.filter((r) => r.id !== id);
      next.splice(next.findIndex((r) => r.id === target) + (list.indexOf(moving) < list.indexOf(over) ? 1 : 0), 0, moving);
      return next;
    });
  };
  const nudge = (id: string, delta: number) => {
    const i = order.findIndex((r) => r.id === id);
    const j = i + delta;
    if (j < 0 || j >= order.length || order[j].pinned !== order[i].pinned) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    saveOrder(next);
  };

  const togglePin = async (room: RoomSummary) => {
    await send('POST', '/api/nexus/rooms', { id: room.id, pinned: !room.pinned }).catch(() => {});
    onChanged();
  };

  return (
    <div className={compact ? '' : 'flex h-full flex-col'}>
      {!compact && (
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">Rooms</h2>
        <button onClick={onNew} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
          <Plus className="h-4 w-4" /> New
        </button>
      </div>
      )}
      <ul className={compact ? 'max-h-64 space-y-0.5 overflow-y-auto' : 'min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2'}>
        {order.map((r, i) => {
          const showDivider = i > 0 && order[i - 1].pinned && !r.pinned;
          const people = r.memberIds.map((id) => agents.find((a) => a.id === id)).filter(Boolean) as Agent[];
          return (
            <React.Fragment key={r.id}>
              {showDivider && <li aria-hidden="true" className="mx-2 my-1.5 border-t border-slate-200 dark:border-slate-800" />}
              <li
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  moveBefore(dragId, r.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragId(null);
                  saveOrder(order);
                }}
                className={`group flex items-start gap-1 rounded-lg ${r.id === activeId ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'} ${dragId === r.id ? 'opacity-50' : ''}`}
              >
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragId(r.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', r.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      nudge(r.id, -1);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      nudge(r.id, 1);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Move ${r.name}. Drag, or use the up and down arrow keys.`}
                  title="Drag to reorder"
                  className={`${compact ? 'mt-1.5' : 'mt-3'} hidden cursor-grab rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing sm:block dark:text-slate-600`}
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <button onClick={() => onOpen(r.id)} aria-current={r.id === activeId ? 'true' : undefined} className={`min-w-0 flex-1 text-left sm:pl-0.5 ${compact ? 'px-1 py-1.5' : 'px-2 py-2'}`}>
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-sm ${compact ? (r.id === activeId ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400') : 'font-medium text-slate-900 dark:text-white'}`}>{r.name}</span>
                    {r.freeOnly && (
                      <span title="Free only: answered by free Gemini" className="flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/10 px-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Leaf className="h-2.5 w-2.5" />
                        {!compact && ' Free'}
                      </span>
                    )}
                    {r.running && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-indigo-500" aria-label="Talking now" />}
                  </span>
                  {!compact && <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{r.preview || `${people.map((a) => a.name.split(' ')[0]).join(', ')}`}</span>}
                </button>
                <button
                  onClick={() => togglePin(r)}
                  aria-label={r.pinned ? `Unpin ${r.name}` : `Pin ${r.name}`}
                  title={r.pinned ? 'Unpin' : 'Pin to the top'}
                  className={`${compact ? 'mt-0.5' : 'mt-2'} rounded p-1.5 ${r.pinned ? 'text-indigo-500' : 'text-slate-400 opacity-100 hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 dark:hover:text-slate-200'}`}
                >
                  <Pin className={`h-3.5 w-3.5 ${r.pinned ? 'fill-current' : ''}`} />
                </button>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </div>
  );
};

export const RoomDialog: React.FC<{
  room: RoomSummary | null; // null creates a new room
  agents: Agent[];
  canDelete: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}> = ({ room, agents, canDelete, onClose, onSaved, onDeleted }) => {
  const [name, setName] = useState(room?.name || '');
  const [memberIds, setMemberIds] = useState<string[]>(room?.memberIds || agents.filter((a) => a.id === 'agent-synthesizer').map((a) => a.id));
  const [freeOnly, setFreeOnly] = useState(room?.freeOnly || false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) => setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const d = await send('POST', '/api/nexus/rooms', { id: room?.id, name, memberIds, freeOnly });
      onSaved(d.room.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async () => {
    try {
      await send('DELETE', `/api/nexus/rooms/${room!.id}`);
      onDeleted();
    } catch (err: any) {
      setError(err.message);
      setConfirmDelete(false);
    }
  };

  const facilitator = ['agent-synthesizer', 'agent-deputy'].map((id) => agents.find((a) => a.id === id && memberIds.includes(id))).find(Boolean) || agents.find((a) => memberIds.includes(a.id));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="font-semibold text-slate-900 dark:text-white">{room ? 'Room settings' : 'New room'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto p-5">
          <div>
            <label htmlFor="rm-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
            <input
              id="rm-name"
              autoFocus
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Launch planning"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 flex w-full items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-300">
              Who's in the room
              <span className="flex gap-3 text-xs font-normal">
                <button type="button" onClick={() => setMemberIds(agents.map((a) => a.id))} className="text-indigo-600 hover:underline dark:text-indigo-400">Everyone</button>
                <button type="button" onClick={() => setMemberIds([])} className="text-slate-500 hover:underline">Nobody</button>
              </span>
            </legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {agents.map((a) => {
                const checked = memberIds.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 ${checked ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-700'}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(a.id)} className="accent-indigo-600" />
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
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {facilitator ? `${facilitator.name} runs the discussion and sums it up.` : 'Choose at least one teammate.'}
            </p>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} className="mt-0.5 accent-emerald-600" />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                <Leaf className="h-4 w-4 text-emerald-500" /> Free only
              </span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                Every message in this room is answered by Gemini on your free key, even for teammates who normally use Claude or ChatGPT.
                Saves your subscriptions; answers may be a little less sharp. If Gemini can't answer, the message fails instead of using a paid AI.
              </span>
            </span>
          </label>

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          {room && canDelete &&
            (confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                <button type="button" onClick={remove} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-500">Delete room</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-sm text-red-600 hover:underline dark:text-red-400">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            ))}
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={!name.trim() || !memberIds.length} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
            {room ? 'Save' : 'Create room'}
          </button>
        </div>
      </form>
    </div>
  );
};

