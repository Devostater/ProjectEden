// NEXUS: one shared room where the AI teammates talk to each other, and the owner can watch and join in.
//
// How a discussion runs. The lead (Chief) facilitates:
//   1. Chief opens with a short take and names who should weigh in.
//   2. Each named teammate speaks in turn. Each one sees everything said so far, so they answer each
//      other rather than giving separate monologues. A teammate may pull in one more colleague.
//   3. Chief speaks again: either asks specific people a follow-up, or wraps up with a plan.
// Every AI message costs one message of usage, so a discussion has a fixed budget of AI turns
// (its "depth") and Chief must wrap up before it runs out. The owner can speak or stop it at any time.
//
// It runs on the server, so it carries on while the owner looks at other pages.
import type { Express } from 'express';
import { askTeammate } from './cardRunner';
import { logActivity } from './activity';
import type { Agent } from './src/types/index';

export interface NexusMessage {
  seq: number;
  at: string;
  role: 'user' | 'agent' | 'system';
  author: string;
  authorId?: string;
  text: string;
  via?: string; // set when another AI answered for the teammate
  kind?: 'plan'; // Chief's wrap-up
}

interface NexusStore {
  agents: Agent[];
  nexus?: { seq: number; messages: NexusMessage[] };
}

const LEAD_ID = 'agent-synthesizer';
const DEPTHS: Record<string, number> = { quick: 4, normal: 8, deep: 14 };
const KEEP = 400; // messages kept on disk
const CONTEXT = 30; // most recent messages shown to each speaker

// Only one discussion at a time; this is its live state.
const live = { running: false, speaking: '', turnsLeft: 0, stop: false };

const firstName = (a: Agent) => a.name.split(' ')[0];

export function registerNexusRoutes(app: Express, getStore: () => NexusStore, save: () => void) {
  const room = () => {
    const store = getStore();
    if (!store.nexus) store.nexus = { seq: 0, messages: [] };
    return store.nexus;
  };

  const post = (m: Omit<NexusMessage, 'seq' | 'at'>) => {
    const r = room();
    const message: NexusMessage = { ...m, seq: ++r.seq, at: new Date().toISOString() };
    r.messages.push(message);
    if (r.messages.length > KEEP) r.messages.splice(0, r.messages.length - KEEP);
    save();
    return message;
  };

  const transcript = () =>
    room()
      .messages.filter((m) => m.role !== 'system')
      .slice(-CONTEXT)
      .map((m) => `${m.role === 'user' ? 'Owner' : m.author}: ${m.text}`)
      .join('\n\n');

  // Names on a trailing "NEXT: A, B" / "ASK: A" line, matched to teammates. The line is removed from the text.
  const readDirective = (text: string, keyword: string, team: Agent[]) => {
    const pattern = new RegExp(`^\\s*\\**${keyword}\\**\\s*:\\s*(.*)$`, 'im');
    const match = text.match(pattern);
    if (!match) return { text: text.trim(), names: [] as Agent[], found: false };
    const wanted = match[1].toLowerCase();
    const names = team.filter((a) => new RegExp(`\\b${firstName(a).toLowerCase()}\\b`).test(wanted));
    return { text: text.replace(pattern, '').trim(), names, found: true };
  };

  async function speak(agent: Agent, system: string): Promise<string | null> {
    live.speaking = agent.name;
    try {
      const answer = await askTeammate(agent, system, `The conversation so far:\n\n${transcript()}\n\nNow it is your turn, ${agent.name}.`, { maxTokens: 1500 });
      const cleaned = answer.text.replace(new RegExp(`^\\s*\\**${agent.name}\\**\\s*:\\s*`, 'i'), '');
      live.turnsLeft -= 1;
      return JSON.stringify({ text: cleaned, via: answer.via || '' });
    } catch (err: any) {
      post({ role: 'system', author: 'Nexus', text: `${agent.name} couldn't reply: ${err?.message || 'unknown error'}` });
      logActivity('error', `Nexus: ${agent.name} could not reply: ${err?.message || 'unknown error'}`);
      live.turnsLeft -= 1; // a failed attempt still ends that turn, so a broken AI cannot loop forever
      return null;
    } finally {
      live.speaking = '';
    }
  }

  async function discuss(depth: number, startWith: Agent[]) {
    const store = getStore();
    const lead = store.agents.find((a) => a.id === LEAD_ID) || store.agents[0];
    const team = store.agents.filter((a) => a.id !== lead.id);
    const roster = team.map((a) => `${firstName(a)} (${a.role})`).join(', ');
    live.running = true;
    live.stop = false;
    live.turnsLeft = depth;
    logActivity('work', `Nexus: a team discussion started (up to ${depth} AI messages).`);

    const common = `This is NEXUS, the studio's shared room: a live conversation between the owner and the AI team of a small studio that makes games and digital products and sells them online.
Talk like a colleague in a meeting. Keep it under 120 words. Add something new: build on, question or disagree with what others said, and address them by name. No headings, no restating what was already said.
You can only talk. You cannot change files, the app or anything else, so never say that you did.`;

    const leadSystem = (mustWrap: boolean) => `${lead.systemInstruction}
${common}
You are ${lead.name}, facilitating. The team you can call on: ${roster}.
${
  mustWrap
    ? `Wrap up now. Give the outcome as a short plan: the decision in one sentence, then 3 to 6 next steps, each starting with the teammate who owns it. End your message with a final line that says exactly: DONE`
    : `Either move the discussion forward or wrap it up.
- To continue: say briefly what you think, put specific questions to specific teammates, and end with a final line "NEXT: Name, Name" listing at most 3 teammates who should speak next.
- To finish (when the question is answered or the team is going in circles): give the outcome as a short plan (the decision in one sentence, then 3 to 6 next steps, each starting with the teammate who owns it) and end with a final line that says exactly: DONE`
}`;

    const mateSystem = (agent: Agent) => `${agent.systemInstruction}
${common}
You are ${agent.name} (${agent.role}). Speak from your specialty. If one other teammate's input is essential and they have not been asked yet, you may end with a final line "ASK: Name". Otherwise do not add any such line.`;

    try {
      let queue = [...startWith];
      let leadHasOpened = startWith.length > 0;

      while (!live.stop && live.turnsLeft > 0) {
        if (queue.length && live.turnsLeft > 1) {
          // A teammate's turn. One turn is always held back so Chief can wrap up.
          const agent = queue.shift()!;
          const raw = await speak(agent, mateSystem(agent));
          if (!raw) continue;
          const { text, via } = JSON.parse(raw);
          const ask = readDirective(text, 'ASK', team);
          const done = readDirective(ask.text, 'DONE', team);
          post({ role: 'agent', author: agent.name, authorId: agent.id, text: done.text, via: via || undefined });
          const invited = ask.names.find((a) => a.id !== agent.id && !queue.includes(a));
          if (invited) queue.push(invited);
          continue;
        }

        // Chief's turn: open, steer, or wrap up.
        const mustWrap = live.turnsLeft <= 1 || (leadHasOpened && live.turnsLeft <= 2);
        const raw = await speak(lead, leadSystem(mustWrap));
        leadHasOpened = true;
        if (!raw) break;
        const { text, via } = JSON.parse(raw);
        const next = readDirective(text, 'NEXT', team);
        const finished = /^\s*\**DONE\**\.?\s*$/im.test(next.text) || mustWrap;
        const body = next.text.replace(/^\s*\**DONE\**\.?\s*$/gim, '').trim();
        post({ role: 'agent', author: lead.name, authorId: lead.id, text: body, via: via || undefined, kind: finished ? 'plan' : undefined });
        if (finished) break;
        queue = next.names.slice(0, 3);
        if (!queue.length) break; // Chief named nobody and did not wrap up: nothing more to do
      }

      if (live.stop) post({ role: 'system', author: 'Nexus', text: 'Discussion stopped.' });
      logActivity('done', 'Nexus: the team discussion ended.');
    } catch (err: any) {
      post({ role: 'system', author: 'Nexus', text: `The discussion stopped because of an error: ${err?.message || 'unknown error'}` });
      logActivity('error', `Nexus: discussion failed: ${err?.message || 'unknown error'}`);
    } finally {
      live.running = false;
      live.speaking = '';
      live.turnsLeft = 0;
      live.stop = false;
    }
  }

  // `since` is the last message number the page already has.
  app.get('/api/nexus', (req, res) => {
    const since = Number(req.query.since) || 0;
    const r = room();
    res.json({
      messages: r.messages.filter((m) => m.seq > since),
      latest: r.seq,
      state: { running: live.running, speaking: live.speaking, turnsLeft: live.turnsLeft },
      depths: DEPTHS,
    });
  });

  // The owner speaks. If the room is quiet this starts a discussion; if one is running, the team sees
  // the message on the next turn.
  app.post('/api/nexus/message', (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 4000) : '';
    if (!text) return res.status(400).json({ error: 'Write a message first.' });
    const store = getStore();
    if (!store.agents.length) return res.status(400).json({ error: 'There is nobody on the team yet.' });
    post({ role: 'user', author: 'You', text });

    if (!live.running) {
      const depth = DEPTHS[String(req.body?.depth)] || DEPTHS.normal;
      // Teammates named with @ speak first; otherwise Chief opens and chooses.
      const mentioned = [...text.matchAll(/@([\w-]+)/g)].map((m) => m[1].toLowerCase());
      const everyone = mentioned.includes('all') || mentioned.includes('team');
      const startWith = store.agents.filter((a) => a.id !== LEAD_ID && (everyone || mentioned.includes(firstName(a).toLowerCase())));
      discuss(depth, startWith.slice(0, Math.max(1, depth - 1)));
    }
    res.json({ ok: true, state: { running: true, speaking: live.speaking, turnsLeft: live.turnsLeft } });
  });

  app.post('/api/nexus/stop', (_req, res) => {
    if (live.running) live.stop = true;
    res.json({ ok: true });
  });

  app.post('/api/nexus/clear', (_req, res) => {
    if (live.running) return res.status(409).json({ error: 'Stop the discussion before clearing the room.' });
    const r = room();
    r.messages = [];
    save();
    res.json({ ok: true, latest: r.seq });
  });
}
