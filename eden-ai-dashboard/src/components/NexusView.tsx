import React, { useEffect, useRef, useState } from 'react';
import { Send, Square, Trash2, Loader2, KanbanSquare, Settings2, ChevronLeft, Leaf } from 'lucide-react';
import { RoomList, RoomDialog } from './NexusRooms.tsx';
import type { NexusRoomsApi } from '../nexusRooms.ts';
import type { Agent, Card, Project } from '../types/index.ts';
import { Formatted } from './ChatView.tsx';

interface NexusMessage {
  seq: number;
  at: string;
  role: 'user' | 'agent' | 'system';
  author: string;
  authorId?: string;
  text: string;
  via?: string;
  kind?: 'plan';
}

interface NexusState {
  running: boolean;
  speaking: string;
  turnsLeft: number;
}

interface NexusViewProps {
  agents: Agent[];
  projects: Project[];
  ownerName?: string;
  onMakeCards: (projectId: string, goal: string, source: { roomId: string; roomName: string; messageSeq: number }) => void; // hand a plan to a project's "Plan with Chief"
  cards: Card[]; // to show which cards came from each plan
  onOpenCard: (card: Card) => void;
  focus?: { roomId: string; seq: number; n: number } | null; // scroll to and highlight this message
  roomsApi: NexusRoomsApi;
  newRoomRequest?: number; // bumped by the sidebar's "New room"
}

const DEPTH_KEY = 'eden_nexus_depth';
const DEPTH_LABEL: Record<string, string> = { quick: 'Quick', normal: 'Normal', deep: 'Deep' };

const STARTERS = [
  'What should the studio focus on this month, and why?',
  'We want to release a small game in 8 weeks. Is that realistic, and what is the plan?',
  'Our last release sold poorly. What went wrong and what do we change?',
];

export const NexusView: React.FC<NexusViewProps> = ({ agents, projects, ownerName, onMakeCards, roomsApi, newRoomRequest, cards, onOpenCard, focus }) => {
  const rooms = roomsApi.rooms;
  const roomId = roomsApi.activeId;
  const [roomDialog, setRoomDialog] = useState<'new' | 'edit' | null>(null);
  const [showList, setShowList] = useState(false); // phone only: the room list and a room take turns on screen
  const roomRef = useRef(roomId);
  const [messages, setMessages] = useState<NexusMessage[]>([]);
  const [state, setState] = useState<NexusState>({ running: false, speaking: '', turnsLeft: 0 });
  const [depths, setDepths] = useState<Record<string, number>>({ quick: 4, normal: 8, deep: 14 });
  const [depth, setDepth] = useState(() => {
    try {
      const saved = localStorage.getItem(DEPTH_KEY) || 'normal';
      return DEPTH_LABEL[saved] ? saved : 'normal';
    } catch {
      return 'normal';
    }
  });
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [planFor, setPlanFor] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null); // message whose "make cards" picker is open
  const latest = useRef(0);
  const runningRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadRooms = roomsApi.refresh;

  const openRoom = (id: string, fromList = true) => {
    roomsApi.setActiveId(id);
    if (fromList) setShowList(false);
  };

  // Whenever the open room changes (here or from the sidebar), start that room's conversation fresh.
  useEffect(() => {
    roomRef.current = roomId;
    latest.current = 0;
    setMessages([]);
    setConfirmClear(false);
    setPlanFor(null);
    setError('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Coming from a card: open its room, then scroll to and highlight the plan it was made from.
  useEffect(() => {
    if (!focus) return;
    if (focus.roomId !== roomId) roomsApi.setActiveId(focus.roomId);
    setHighlight(focus.seq);
    setShowList(false);
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(`nexus-msg-${focus.seq}`);
      if (el || ++tries > 20) {
        clearInterval(timer);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => setHighlight(null), 4000);
      }
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  // The sidebar's "New room" opens the form here.
  useEffect(() => {
    if (newRoomRequest) setRoomDialog('new');
  }, [newRoomRequest]);

  const load = async () => {
    const forRoom = roomRef.current;
    if (!forRoom) return;
    try {
      const d = await fetch(`/api/nexus?room=${encodeURIComponent(forRoom)}&since=${latest.current}`).then((r) => r.json());
      if (forRoom !== roomRef.current) return; // switched rooms while this was loading
      if (d.messages.length) {
        latest.current = d.latest;
        setMessages((m) => [...m, ...d.messages]);
      }
      runningRef.current = d.state.running;
      setState(d.state);
      setDepths(d.depths);
    } catch {}
  };

  // Check often while the team is talking, occasionally when the room is quiet.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let n = 0;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        await load();
        if (n++ % 3 === 0) await loadRooms();
      }
      if (alive) timer = setTimeout(tick, runningRef.current ? 1500 : 5000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (highlight === null) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, state.speaking]);

  const send = async (text = input) => {
    const body = text.trim();
    if (!body) return;
    setError('');
    setInput('');
    try {
      const res = await fetch('/api/nexus/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body, depth, room: roomId }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not send.');
      runningRef.current = true;
      await load();
      loadRooms();
    } catch (err: any) {
      setError(err.message);
      setInput(body);
    }
  };

  const stop = () => fetch('/api/nexus/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: roomId }) }).then(load);

  const clear = async () => {
    setConfirmClear(false);
    const res = await fetch('/api/nexus/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: roomId }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error || 'Could not clear the room.');
    setMessages([]);
    loadRooms();
  };

  const pickDepth = (d: string) => {
    setDepth(d);
    try {
      localStorage.setItem(DEPTH_KEY, d);
    } catch {}
  };

  const agentOf = (m: NexusMessage) => agents.find((a) => a.id === m.authorId) || agents.find((a) => a.name === m.author);
  const speaker = agents.find((a) => a.name === state.speaking);
  const room = rooms.find((r) => r.id === roomId);
  const inRoom = room ? (room.memberIds.map((id) => agents.find((a) => a.id === id)).filter(Boolean) as Agent[]) : [];
  const facilitator = ['agent-synthesizer', 'agent-deputy'].map((id) => inRoom.find((a) => a.id === id)).find(Boolean) || inRoom[0];

  return (
    <div className="flex h-full gap-4 p-3 sm:p-4">
      <aside className={`${showList ? 'flex' : 'hidden'} w-full shrink-0 flex-col rounded-xl border border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-900`}>
        <RoomList rooms={rooms} activeId={roomId} agents={agents} onOpen={(id) => openRoom(id)} onNew={() => setRoomDialog('new')} onChanged={loadRooms} />
      </aside>
      <section className={`${showList ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white md:flex dark:border-slate-800 dark:bg-slate-900`}>
        {/* Who is in the room */}
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <button onClick={() => setShowList(true)} aria-label="All rooms" className="-ml-1 rounded p-1 text-slate-500 md:hidden">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 truncate font-semibold text-slate-900 dark:text-white">
              {room?.name || 'Nexus'}
              {room?.freeOnly && (
                <span className="flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <Leaf className="h-3 w-3" /> Free only
                </span>
              )}
            </h1>
            <p className="truncate text-sm text-slate-500 dark:text-slate-400">
              {inRoom.length} in the room{facilitator ? ` · ${facilitator.name} leads` : ''}
            </p>
          </div>
          <div className="hidden -space-x-1.5 sm:flex" aria-label={`${inRoom.length} teammates in the room`}>
            {inRoom.slice(0, 8).map((a) => (
              <span
                key={a.id}
                title={`${a.name} · ${a.role}`}
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white dark:border-slate-900 ${state.speaking === a.name ? 'ring-2 ring-emerald-400' : ''}`}
                style={{ backgroundColor: a.color }}
              >
                {a.avatar || a.name.slice(0, 2).toUpperCase()}
              </span>
            ))}
            {inRoom.length > 8 && <span className="flex h-7 items-center pl-3 text-xs text-slate-500">+{inRoom.length - 8}</span>}
          </div>
          {room && (
            <button onClick={() => setRoomDialog('edit')} aria-label="Room settings" title="Who's in the room, free only" className="rounded-md p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <Settings2 className="h-4 w-4" />
            </button>
          )}
          {messages.length > 0 &&
            (confirmClear ? (
              <span className="flex items-center gap-1 text-sm">
                <button onClick={clear} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-500">Clear room</button>
                <button onClick={() => setConfirmClear(false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Keep</button>
              </span>
            ) : (
              <button onClick={() => setConfirmClear(true)} disabled={state.running} aria-label="Clear the room" title="Clear the room" className="rounded-md p-1.5 text-slate-400 hover:text-red-500 disabled:opacity-40">
                <Trash2 className="h-4 w-4" />
              </button>
            ))}
        </header>

        {/* The conversation */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && !state.running && (
            <div className="mx-auto mt-10 max-w-lg text-center text-slate-500 dark:text-slate-400">
              <p className="text-base text-slate-700 dark:text-slate-200">Put a question or a goal to this room.</p>
              <p className="mt-1 text-sm">{facilitator?.name || 'The lead'} brings in the right people, they answer each other, and {facilitator?.name || 'the lead'} finishes with a plan.</p>
              <div className="mt-5 space-y-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-indigo-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-500"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === 'system') {
              return (
                <p key={m.seq} className="text-center text-xs text-slate-500 dark:text-slate-400">
                  {m.text}
                </p>
              );
            }
            if (m.role === 'user') {
              return (
                <div key={m.seq} className="flex justify-end">
                  <div className="max-w-[80%] rounded-xl bg-indigo-600 px-4 py-2.5 text-white">
                    <div className="mb-0.5 text-xs font-semibold text-white/80">{ownerName || 'You'}</div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
                  </div>
                </div>
              );
            }
            const a = agentOf(m);
            const isPlan = m.kind === 'plan';
            return (
              <div key={m.seq} id={`nexus-msg-${m.seq}`} className={`flex gap-3 rounded-xl transition-shadow ${highlight === m.seq ? 'ring-2 ring-amber-400 ring-offset-4 ring-offset-white dark:ring-offset-slate-900' : ''}`}>
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: a?.color || '#64748b' }}>
                  {a?.avatar || m.author.slice(0, 2).toUpperCase()}
                </span>
                <div
                  className={`min-w-0 max-w-[85%] rounded-xl px-4 py-2.5 ${
                    isPlan ? 'border border-indigo-300 bg-indigo-50 text-slate-900 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-slate-100' : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-semibold">{m.author}</span>
                    {a && <span className="text-slate-500 dark:text-slate-400">{a.role}</span>}
                    {isPlan && <span className="rounded bg-indigo-600 px-1.5 py-0.5 font-medium text-white">Plan</span>}
                  </div>
                  <Formatted text={m.text} />
                  {m.via && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Answered with {m.via}.</p>}
                  {isPlan && (() => {
                    const made = cards.filter((c) => c.source?.kind === 'nexus' && c.source.roomId === roomId && c.source.messageSeq === m.seq);
                    if (!made.length) return null;
                    return (
                      <div className="mt-3 border-t border-indigo-200 pt-3 dark:border-indigo-500/30">
                        <div className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                          {made.length} card{made.length === 1 ? '' : 's'} made from this plan
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {made.map((c) => {
                            const p = projects.find((x) => x.id === c.projectId);
                            return (
                              <button key={c.id} onClick={() => onOpenCard(c)} title={`${p?.name || ''} · ${c.column}`} className="flex max-w-full items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: p?.color }} />
                                <span className="truncate">{c.title}</span>
                                <span className="shrink-0 text-slate-400">{c.column === 'done' ? '✓' : c.column === 'review' ? 'review' : ''}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {isPlan && projects.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-indigo-200 pt-3 dark:border-indigo-500/30">
                      {planFor === m.seq ? (
                        <>
                          <span className="text-sm text-slate-600 dark:text-slate-300">Which project?</span>
                          {projects.map((p) => (
                            <button key={p.id} onClick={() => onMakeCards(p.id, m.text, { roomId, roomName: room?.name || '', messageSeq: m.seq })} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-800 hover:border-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} /> {p.name}
                            </button>
                          ))}
                          <button onClick={() => setPlanFor(null)} className="text-sm text-slate-500 hover:underline">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => (projects.length === 1 ? onMakeCards(projects[0].id, m.text, { roomId, roomName: room?.name || '', messageSeq: m.seq }) : setPlanFor(m.seq))} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                          <KanbanSquare className="h-4 w-4" /> Turn this plan into cards
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {state.running && (
            <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: speaker?.color || '#64748b' }}>
                {speaker ? speaker.avatar || speaker.name.slice(0, 2).toUpperCase() : <Loader2 className="h-4 w-4 animate-spin" />}
              </span>
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {state.speaking ? `${state.speaking} is thinking…` : 'The team is talking…'}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Your turn */}
        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          {error && <p role="alert" className="mb-2 text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder={state.running ? 'Add your view. The team sees it on their next turn.' : 'Ask the team something, or use @name to say who should start'}
              className="flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {state.running && (
              <button onClick={stop} aria-label="Stop the discussion" title="Stop the discussion" className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                <Square className="h-3.5 w-3.5 fill-current" /> Stop
              </button>
            )}
            <button onClick={() => send()} disabled={!input.trim()} aria-label="Send" className="rounded-lg bg-indigo-600 px-4 text-white hover:bg-indigo-500 disabled:opacity-40">
              <Send size={18} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            {state.running ? (
              <span>Up to {state.turnsLeft} more AI message{state.turnsLeft === 1 ? '' : 's'} in this discussion.</span>
            ) : (
              <>
                <span>Length of discussion:</span>
                <span className="flex gap-1" role="group" aria-label="Length of discussion">
                  {Object.keys(depths).map((d) => (
                    <button
                      key={d}
                      onClick={() => pickDepth(d)}
                      aria-pressed={depth === d}
                      className={`rounded-md px-2 py-0.5 ${depth === d ? 'bg-indigo-600 font-medium text-white' : 'border border-slate-300 text-slate-600 hover:border-indigo-400 dark:border-slate-700 dark:text-slate-300'}`}
                    >
                      {DEPTH_LABEL[d] || d}
                    </button>
                  ))}
                </span>
                <span>Uses up to {depths[depth]} AI messages.</span>
              </>
            )}
          </div>
        </div>
      </section>
      {roomDialog && (
        <RoomDialog
          room={roomDialog === 'edit' ? room || null : null}
          agents={agents}
          canDelete={rooms.length > 1}
          onClose={() => setRoomDialog(null)}
          onSaved={(id) => {
            const wasNew = roomDialog === 'new';
            setRoomDialog(null);
            loadRooms();
            if (wasNew) openRoom(id);
          }}
          onDeleted={() => {
            setRoomDialog(null);
            roomsApi.setActiveId('');
            loadRooms();
            setShowList(true);
          }}
        />
      )}
    </div>
  );
};
