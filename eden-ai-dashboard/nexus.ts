// NEXUS: rooms where AI teammates talk to each other, and the owner can watch and join in.
//
// Each room has its own members, its own conversation, and can be pinned and reordered. A room can be
// "free only": every message in it is answered by Gemini on the free API key, never by a paid fallback.
//
// How a discussion runs. The room's facilitator (Chief if a member, else Lyra, else the first member):
//   1. opens with a short take and names who should weigh in;
//   2. each named member speaks in turn, seeing everything said so far, and may pull in one more member;
//   3. the facilitator either asks follow-ups or wraps up with a plan.
// Every AI message costs one message of usage, so a discussion has a fixed number of AI turns
// (its "depth"), and the facilitator must wrap up before it runs out. The owner can speak or stop at any time.
// Discussions run on the server, one per room, so they carry on while the owner looks at other pages.
import type { Express } from 'express';
import { askTeammate } from './cardRunner';
import { logActivity } from './activity';
import { providerFor } from './providers';
import { aiPaused, onPauseChange } from './control';
import type { Agent } from './src/types/index';

export interface NexusMessage {
  seq: number;
  at: string;
  role: 'user' | 'agent' | 'system';
  author: string;
  authorId?: string;
  text: string;
  via?: string; // set when another AI answered for the teammate
  kind?: 'plan'; // the facilitator's wrap-up
}

export interface NexusRoom {
  id: string;
  name: string;
  memberIds: string[]; // teammates in the room
  freeOnly: boolean;
  pinned: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  messages: NexusMessage[];
}

export interface NexusData {
  seq: number;
  rooms: NexusRoom[];
  messages?: NexusMessage[]; // the single room from the first version, moved into "General" on load
}

interface NexusStore {
  agents: Agent[];
  nexus?: NexusData;
}

const LEAD_IDS = ['agent-synthesizer', 'agent-deputy'];
const DEPTHS: Record<string, number> = { quick: 4, normal: 8, deep: 14 };
const KEEP = 400; // messages kept per room
const CONTEXT = 30; // most recent messages shown to each speaker
const FREE_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];

interface Live {
  running: boolean;
  speaking: string;
  turnsLeft: number;
  stop: boolean;
}
const live = new Map<string, Live>(); // one running discussion per room
const liveOf = (roomId: string) => live.get(roomId) || { running: false, speaking: '', turnsLeft: 0, stop: false };

const firstName = (a: Agent) => a.name.split(' ')[0];
export const runningRooms = () => [...live.values()].filter((l) => l.running).length;
// Pause AI stops every running discussion.
onPauseChange((paused) => {
  if (paused) for (const l of live.values()) l.stop = true;
});
// Removes any leftover stage-direction lines (NEXT: / ASK: / DONE) so they never show in the chat.
const stripDirections = (text: string) => text.replace(/^\s*\**(NEXT|ASK)\**\s*:.*$/gim, '').replace(/^\s*\**DONE\**\.?\s*$/gim, '').trim();
const now = () => new Date().toISOString();
const newId = () => `room-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function registerNexusRoutes(app: Express, getStore: () => NexusStore, save: () => void) {
  const data = (): NexusData => {
    const store = getStore();
    if (!store.nexus) store.nexus = { seq: 0, rooms: [] };
    const n = store.nexus;
    if (!n.rooms) n.rooms = [];
    // First run of rooms: the old single conversation becomes "General" with everyone in it.
    if (n.messages) {
      if (n.messages.length || !n.rooms.length) {
        n.rooms.push({
          id: 'room-general',
          name: 'General',
          memberIds: store.agents.map((a) => a.id),
          freeOnly: false,
          pinned: true,
          order: 0,
          createdAt: now(),
          updatedAt: now(),
          messages: n.messages,
        });
      }
      delete n.messages;
      save();
    }
    if (!n.rooms.length) {
      n.rooms.push({ id: 'room-general', name: 'General', memberIds: store.agents.map((a) => a.id), freeOnly: false, pinned: true, order: 0, createdAt: now(), updatedAt: now(), messages: [] });
      save();
    }
    return n;
  };

  const findRoom = (id: unknown) => data().rooms.find((r) => r.id === id);
  const members = (room: NexusRoom) => {
    const agents = getStore().agents;
    return room.memberIds.map((id) => agents.find((a) => a.id === id)).filter((a): a is Agent => !!a);
  };
  const facilitatorOf = (room: NexusRoom) => {
    const inRoom = members(room);
    return LEAD_IDS.map((id) => inRoom.find((a) => a.id === id)).find(Boolean) || inRoom[0];
  };

  const post = (room: NexusRoom, m: Omit<NexusMessage, 'seq' | 'at'>) => {
    const message: NexusMessage = { ...m, seq: ++data().seq, at: now() };
    room.messages.push(message);
    if (room.messages.length > KEEP) room.messages.splice(0, room.messages.length - KEEP);
    room.updatedAt = message.at;
    save();
    return message;
  };

  const transcript = (room: NexusRoom) =>
    room.messages
      .filter((m) => m.role !== 'system')
      .slice(-CONTEXT)
      .map((m) => `${m.role === 'user' ? 'Owner' : m.author}: ${m.text}`)
      .join('\n\n');

  // Names on a trailing "NEXT: A, B" / "ASK: A" line, matched to members. The line is removed from the text.
  const readDirective = (text: string, keyword: string, team: Agent[]) => {
    const pattern = new RegExp(`^\\s*\\**${keyword}\\**\\s*:\\s*(.*)$`, 'im');
    const match = text.match(pattern);
    if (!match) return { text: text.trim(), names: [] as Agent[] };
    const wanted = match[1].toLowerCase();
    const names = team.filter((a) => new RegExp(`\\b${firstName(a).toLowerCase()}\\b`).test(wanted));
    return { text: text.replace(pattern, '').trim(), names };
  };

  // In a free-only room, a member whose own AI is Gemini keeps their model; everyone else uses free Gemini.
  const modelsFor = (room: NexusRoom, agent: Agent) => {
    if (!room.freeOnly) return undefined;
    return providerFor(agent.model) === 'google' ? [agent.model, ...FREE_MODELS.filter((m) => m !== agent.model)] : FREE_MODELS;
  };

  async function speak(room: NexusRoom, state: Live, agent: Agent, system: string): Promise<{ text: string; via: string } | null> {
    state.speaking = agent.name;
    try {
      const answer = await askTeammate(agent, system, `The conversation so far:\n\n${transcript(room)}\n\nNow it is your turn, ${agent.name}.`, {
        maxTokens: 1500,
        onlyModels: modelsFor(room, agent),
      });
      state.turnsLeft -= 1;
      const via = room.freeOnly && providerFor(agent.model) !== 'google' ? 'free Gemini' : answer.via || '';
      return { text: answer.text.replace(new RegExp(`^\\s*\\**${agent.name}\\**\\s*:\\s*`, 'i'), ''), via };
    } catch (err: any) {
      post(room, { role: 'system', author: 'Nexus', text: `${agent.name} couldn't reply: ${err?.message || 'unknown error'}` });
      logActivity('error', `Nexus (${room.name}): ${agent.name} could not reply: ${err?.message || 'unknown error'}`);
      state.turnsLeft -= 1; // a failed attempt still uses the turn, so a broken AI cannot loop forever
      return null;
    } finally {
      state.speaking = '';
    }
  }

  async function discuss(room: NexusRoom, depth: number, startWith: Agent[]) {
    const lead = facilitatorOf(room);
    if (!lead) return;
    const team = members(room).filter((a) => a.id !== lead.id);
    const roster = team.map((a) => `${firstName(a)} (${a.role})`).join(', ') || 'nobody else';
    const state: Live = { running: true, speaking: '', turnsLeft: depth, stop: false };
    live.set(room.id, state);
    logActivity('work', `Nexus (${room.name}): a discussion started (up to ${depth} AI messages${room.freeOnly ? ', free only' : ''}).`);

    const common = `This is NEXUS, the studio's shared rooms. You are in the room "${room.name}": a live conversation between the owner and part of the AI team of a small studio that makes games and digital products and sells them online.
Talk like a colleague in a meeting. Keep it under 120 words. Add something new: build on, question or disagree with what others said, and address them by name. No headings, no restating what was already said.
You can only talk. You cannot change files, the app or anything else, so never say that you did.`;

    const leadSystem = (mustWrap: boolean) => `${lead.systemInstruction}
${common}
You are ${lead.name}, facilitating this room. The members you can call on: ${roster}. Only call on them.
${
  mustWrap || !team.length
    ? `Wrap up now. Give the outcome as a short plan: the decision in one sentence, then 3 to 6 next steps, each starting with who owns it. End your message with a final line that says exactly: DONE`
    : `Either move the discussion forward or wrap it up.
- To continue: say briefly what you think, put specific questions to specific members, and end with a final line "NEXT: Name, Name" listing at most 3 members who should speak next.
- To finish (when the question is answered or the room is going in circles): give the outcome as a short plan (the decision in one sentence, then 3 to 6 next steps, each starting with who owns it) and end with a final line that says exactly: DONE`
}`;

    const mateSystem = (agent: Agent) => `${agent.systemInstruction}
${common}
You are ${agent.name} (${agent.role}). Speak from your specialty. If one other member's input is essential and they have not been asked yet, you may end with a final line "ASK: Name". Otherwise do not add any such line.`;

    try {
      let queue = startWith.filter((a) => a.id !== lead.id);
      let leadHasOpened = queue.length > 0;

      while (!state.stop && state.turnsLeft > 0) {
        if (queue.length && state.turnsLeft > 1) {
          // A member's turn. One turn is always held back so the facilitator can wrap up.
          const agent = queue.shift()!;
          const said = await speak(room, state, agent, mateSystem(agent));
          if (!said) continue;
          const ask = readDirective(said.text, 'ASK', team);
          const text = stripDirections(ask.text);
          post(room, { role: 'agent', author: agent.name, authorId: agent.id, text, via: said.via || undefined });
          const invited = ask.names.find((a) => a.id !== agent.id && !queue.includes(a));
          if (invited) queue.push(invited);
          continue;
        }

        // The facilitator's turn: open, steer, or wrap up.
        const mustWrap = state.turnsLeft <= 1 || (leadHasOpened && state.turnsLeft <= 2);
        const said = await speak(room, state, lead, leadSystem(mustWrap));
        leadHasOpened = true;
        if (!said) break;
        const next = readDirective(said.text, 'NEXT', team);
        const finished = /^\s*\**DONE\**\.?\s*$/im.test(next.text) || mustWrap || !team.length;
        const body = stripDirections(next.text);
        post(room, { role: 'agent', author: lead.name, authorId: lead.id, text: body, via: said.via || undefined, kind: finished ? 'plan' : undefined });
        if (finished) break;
        queue = next.names.slice(0, 3);
        if (!queue.length) break;
      }

      if (state.stop) post(room, { role: 'system', author: 'Nexus', text: aiPaused() ? 'Discussion stopped: the AI was paused.' : 'Discussion stopped.' });
      logActivity('done', `Nexus (${room.name}): the discussion ended.`);
    } catch (err: any) {
      post(room, { role: 'system', author: 'Nexus', text: `The discussion stopped because of an error: ${err?.message || 'unknown error'}` });
      logActivity('error', `Nexus (${room.name}): discussion failed: ${err?.message || 'unknown error'}`);
    } finally {
      live.delete(room.id);
    }
  }

  const summary = (r: NexusRoom) => {
    const last = r.messages[r.messages.length - 1];
    const state = liveOf(r.id);
    return {
      id: r.id,
      name: r.name,
      memberIds: r.memberIds,
      freeOnly: r.freeOnly,
      pinned: r.pinned,
      order: r.order,
      updatedAt: r.updatedAt,
      latest: last?.seq || 0,
      preview: last ? `${last.role === 'user' ? 'You' : last.author}: ${last.text.replace(/\s+/g, ' ').slice(0, 80)}` : '',
      running: state.running,
    };
  };

  // ---- Rooms
  app.get('/api/nexus/rooms', (_req, res) => {
    res.json({ rooms: data().rooms.map(summary), depths: DEPTHS });
  });

  // Create (no id) or change (id) a room.
  app.post('/api/nexus/rooms', (req, res) => {
    const b = req.body || {};
    const agents = getStore().agents;
    const existing = b.id ? findRoom(b.id) : undefined;
    if (b.id && !existing) return res.status(404).json({ error: 'Room not found.' });
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : existing?.name || '';
    if (!name) return res.status(400).json({ error: 'Give the room a name.' });
    const memberIds = Array.isArray(b.memberIds)
      ? [...new Set<string>(b.memberIds.filter((id: unknown) => typeof id === 'string' && agents.some((a) => a.id === id)))]
      : existing?.memberIds || [];
    if (!memberIds.length) return res.status(400).json({ error: 'Choose at least one teammate for the room.' });

    if (existing) {
      if (liveOf(existing.id).running && Array.isArray(b.memberIds)) return res.status(409).json({ error: 'Wait for the discussion to end before changing who is in the room.' });
      Object.assign(existing, {
        name,
        memberIds,
        freeOnly: typeof b.freeOnly === 'boolean' ? b.freeOnly : existing.freeOnly,
        pinned: typeof b.pinned === 'boolean' ? b.pinned : existing.pinned,
      });
      save();
      return res.json({ room: summary(existing) });
    }
    const n = data();
    const room: NexusRoom = {
      id: newId(),
      name,
      memberIds,
      freeOnly: !!b.freeOnly,
      pinned: false,
      order: Math.max(0, ...n.rooms.map((r) => r.order)) + 1,
      createdAt: now(),
      updatedAt: now(),
      messages: [],
    };
    n.rooms.push(room);
    save();
    res.json({ room: summary(room) });
  });

  // New order for the rooms, as a list of ids (pinned rooms always list first on the page).
  app.post('/api/nexus/rooms/order', (req, res) => {
    const ids: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    data().rooms.forEach((r) => {
      const i = ids.indexOf(r.id);
      if (i >= 0) r.order = i;
    });
    save();
    res.json({ ok: true });
  });

  app.delete('/api/nexus/rooms/:id', (req, res) => {
    const n = data();
    if (!findRoom(req.params.id)) return res.status(404).json({ error: 'Room not found.' });
    if (liveOf(req.params.id).running) return res.status(409).json({ error: 'Stop the discussion before deleting the room.' });
    if (n.rooms.length <= 1) return res.status(400).json({ error: 'Keep at least one room.' });
    n.rooms = n.rooms.filter((r) => r.id !== req.params.id);
    save();
    res.json({ ok: true });
  });

  // ---- Conversation in one room. `since` is the last message number the page already has.
  app.get('/api/nexus', (req, res) => {
    const room = findRoom(req.query.room) || data().rooms[0];
    const since = Number(req.query.since) || 0;
    const state = liveOf(room.id);
    res.json({
      room: summary(room),
      messages: room.messages.filter((m) => m.seq > since),
      latest: room.messages[room.messages.length - 1]?.seq || 0,
      state: { running: state.running, speaking: state.speaking, turnsLeft: state.turnsLeft },
      depths: DEPTHS,
    });
  });

  // The owner speaks. If the room is quiet this starts a discussion; if one is running, the members see
  // the message on their next turn.
  app.post('/api/nexus/message', (req, res) => {
    const room = findRoom(req.body?.room) || data().rooms[0];
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 4000) : '';
    if (!text) return res.status(400).json({ error: 'Write a message first.' });
    const inRoom = members(room);
    if (!inRoom.length) return res.status(400).json({ error: 'This room has nobody in it. Add teammates in its settings.' });
    post(room, { role: 'user', author: 'You', text });

    if (aiPaused()) {
      post(room, { role: 'system', author: 'Nexus', text: 'The AI is paused, so nobody will reply. Resume it from the sidebar.' });
      return res.json({ ok: true, paused: true });
    }
    if (!liveOf(room.id).running) {
      const depth = DEPTHS[String(req.body?.depth)] || DEPTHS.normal;
      // Members named with @ speak first; otherwise the facilitator opens and chooses.
      const mentioned = [...text.matchAll(/@([\w-]+)/g)].map((m) => m[1].toLowerCase());
      const everyone = mentioned.includes('all') || mentioned.includes('team');
      const lead = facilitatorOf(room);
      const startWith = inRoom.filter((a) => a.id !== lead?.id && (everyone || mentioned.includes(firstName(a).toLowerCase())));
      discuss(room, depth, startWith.slice(0, Math.max(1, depth - 1)));
    }
    res.json({ ok: true });
  });

  app.post('/api/nexus/stop', (req, res) => {
    const state = live.get(String(req.body?.room || ''));
    if (state) state.stop = true;
    res.json({ ok: true });
  });

  app.post('/api/nexus/clear', (req, res) => {
    const room = findRoom(req.body?.room);
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    if (liveOf(room.id).running) return res.status(409).json({ error: 'Stop the discussion before clearing the room.' });
    room.messages = [];
    save();
    res.json({ ok: true });
  });
}
