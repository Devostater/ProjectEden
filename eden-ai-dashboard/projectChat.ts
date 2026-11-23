// Project chat: one ongoing conversation with Chief per project, kept on the hub so it survives closing the page,
// plus a "to discuss" list (an agenda, e.g. for a meeting at 5). Chief sees the project, the list and the recent
// conversation, and can add to the list by ending a line with [agenda] in its reply.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import { hubPort } from './config.mjs';
import { isLocal } from './permissions';
import { askTeammate } from './cardRunner';
import type { Agent, Project, Card } from './src/types/index';

export interface ChatLine { role: 'owner' | 'chief'; text: string; at: string }
export interface AgendaItem { id: string; text: string; done: boolean; at: string }
interface ProjectChat {
  messages: ChatLine[];
  agenda: AgendaItem[];
  meeting?: string; // shown text, e.g. "Tue, Nov 17, 6:00 PM"
  meetingAt?: string; // exact local time "YYYY-MM-DDTHH:MM" when picked or set by the AI
  meetingHost?: boolean; // the AI opens the meeting by itself at that time
  hostedAt?: string; // the meetingAt that was already opened (so it opens once)
  meetingRoomId?: string; // the Nexus room the meeting is held in (reused next time)
}

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-project-chats.json');
const MAX_MESSAGES = 400;
const CONTEXT_MESSAGES = 30;

let chats: Record<string, ProjectChat> = (() => {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
})();
const save = () => fs.writeFileSync(FILE, JSON.stringify(chats, null, 2));
const chatOf = (id: string): ProjectChat => (chats[id] ||= { messages: [], agenda: [] });
const now = () => new Date().toISOString();
const newId = () => `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Lines Chief marks with [agenda] become list items; the marker is removed from what the owner reads.
export function takeAgenda(reply: string): { text: string; items: string[] } {
  const items: string[] = [];
  const text = reply
    .split('\n')
    .filter((line) => {
      const m = line.match(/^\s*[-*]?\s*\[agenda\]\s*(.+)$/i) || line.match(/^(.+?)\s*\[agenda\]\s*$/i);
      if (m && m[1].trim()) { items.push(m[1].trim().slice(0, 300)); return false; }
      return true;
    })
    .join('\n')
    .trim();
  return { text, items };
}

// A line "[meeting] 2026-11-17T18:00" in Chief's reply sets the project's meeting (removed from what the owner reads).
export function takeMeeting(reply: string): { text: string; at: string | null } {
  let at: string | null = null;
  const text = reply
    .split('\n')
    .filter((line) => {
      const m = line.match(/\[meeting\]\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/i);
      if (m && !Number.isNaN(Date.parse(m[1]))) { at = m[1]; return false; }
      return true;
    })
    .join('\n')
    .trim();
  return { text, at };
}

// The shown text for a meeting time: always a real date, never "Today", so it still reads right tomorrow.
export function meetingText(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function registerProjectChat(app: Express, getStore: () => { agents: Agent[]; projects?: Project[]; cards?: Card[] }) {
  const projectOf = (id: string) => (getStore().projects || []).find((p) => p.id === id);
  const PORT = hubPort();
  const self = (p: string, body: unknown) =>
    fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }).then(async (r) => {
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `${r.status}`);
      return d;
    });

  const setMeeting = (chat: ProjectChat, at: string, host?: boolean) => {
    chat.meetingAt = at;
    chat.meeting = meetingText(at);
    if (typeof host === 'boolean') chat.meetingHost = host;
  };

  // Hold the meeting: a Nexus room with Chief and the people working on the project, the agenda posted, Chief leading.
  async function startMeeting(projectId: string): Promise<{ roomId: string }> {
    const store = getStore();
    const project = projectOf(projectId);
    if (!project) throw new Error('Project not found.');
    const chat = chatOf(projectId);
    const lead = store.agents.find((a) => a.id === 'agent-synthesizer') || store.agents[0];
    if (!lead) throw new Error('There is nobody on the team to hold the meeting.');
    const workers = (store.cards || []).filter((c) => c.projectId === projectId && c.column !== 'done' && c.assigneeId).map((c) => c.assigneeId as string);
    const memberIds = [...new Set([lead.id, ...workers])].filter((id) => store.agents.some((a) => a.id === id)).slice(0, 6);
    let roomId = chat.meetingRoomId;
    try {
      const d = await self('/api/nexus/rooms', roomId ? { id: roomId, name: `${project.name} meeting`, memberIds } : { name: `${project.name} meeting`, memberIds });
      roomId = d.room?.id;
    } catch {
      const d = await self('/api/nexus/rooms', { name: `${project.name} meeting`, memberIds });
      roomId = d.room?.id;
    }
    if (!roomId) throw new Error('Could not open a meeting room.');
    const topics = chat.agenda.filter((a) => !a.done).map((a) => `- ${a.text}`);
    const cards = (store.cards || []).filter((c) => c.projectId === projectId && c.column !== 'done').slice(0, 12).map((c) => `- [${c.column}] ${c.title}`);
    await self('/api/nexus/message', {
      room: roomId,
      text: `Meeting for ${project.name}${chat.meeting ? ` (${chat.meeting})` : ''}.\nGoal: ${project.goal || '(not set)'}\nTopics to discuss:\n${topics.join('\n') || '- (none yet: start with where the project stands and what is next)'}\nOpen cards:\n${cards.join('\n') || '- (none)'}\n\n@${lead.name.split(' ')[0]}, please host: go through each topic with the team, then end with a short list of decisions and action items for the owner.`,
    });
    chat.meetingRoomId = roomId;
    chat.hostedAt = chat.meetingAt || now();
    save();
    return { roomId };
  }

  // The AI opens meetings it hosts by itself at the meeting time (checked every 30 s, up to 15 minutes late).
  setInterval(() => {
    for (const [projectId, c] of Object.entries(chats)) {
      if (!c.meetingHost || !c.meetingAt || c.hostedAt === c.meetingAt) continue;
      const at = Date.parse(c.meetingAt);
      if (Number.isNaN(at) || Date.now() < at || Date.now() - at > 15 * 60_000 || !projectOf(projectId)) continue;
      c.hostedAt = c.meetingAt; // once, even if it fails
      save();
      startMeeting(projectId).catch(() => {});
    }
  }, 30_000).unref?.();

  app.post('/api/projects/:id/meeting/start', async (req, res) => {
    if (!projectOf(req.params.id)) return res.status(404).json({ error: 'Project not found.' });
    try {
      res.json(await startMeeting(req.params.id));
    } catch (err: any) {
      res.status(500).json({ error: `Could not start the meeting: ${err.message}` });
    }
  });

  // For other programs on this PC (e.g. LYRA): schedule a project's meeting.
  // { project: id or name, when: "YYYY-MM-DDTHH:MM" (local time), topics?: string[], host?: boolean }
  app.post('/api/meetings/schedule', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only programs on this computer can schedule meetings.' });
    const key = clean(req.body?.project, 120).toLowerCase();
    const projects = getStore().projects || [];
    const project = projects.find((p) => p.id === key) || projects.find((p) => p.name.toLowerCase() === key) || projects.find((p) => key && p.name.toLowerCase().includes(key));
    if (!project) return res.status(404).json({ error: 'No project with that name.' });
    const when = clean(req.body?.when, 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(when) || Number.isNaN(Date.parse(when))) return res.status(400).json({ error: 'Give the time as YYYY-MM-DDTHH:MM (local time).' });
    const chat = chatOf(project.id);
    setMeeting(chat, when.slice(0, 16), req.body?.host !== false);
    for (const t of Array.isArray(req.body?.topics) ? req.body.topics.slice(0, 20) : []) {
      const text = clean(t, 300);
      if (text) chat.agenda.push({ id: newId(), text, done: false, at: now() });
    }
    save();
    res.json({ projectId: project.id, ...chat, messages: undefined });
  });

  app.get('/api/projects/:id/chat', (req, res) => {
    if (!projectOf(req.params.id)) return res.status(404).json({ error: 'Project not found.' });
    res.json(chatOf(req.params.id));
  });

  app.post('/api/projects/:id/chat', async (req, res) => {
    const store = getStore();
    const project = projectOf(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const text = clean(req.body?.text, 4000);
    if (!text) return res.status(400).json({ error: 'Write something first.' });
    const chat = chatOf(project.id);
    chat.messages.push({ role: 'owner', text, at: now() });

    const lead = store.agents.find((a) => a.id === 'agent-synthesizer') || store.agents[0];
    if (!lead) { save(); return res.status(400).json({ error: 'There is nobody on the team to talk to.' }); }
    const cards = (store.cards || []).filter((c) => c.projectId === project.id && c.column !== 'done').slice(0, 25).map((c) => `- [${c.column}] ${c.title}`);
    const open = chat.agenda.filter((a) => !a.done).map((a) => `- ${a.text}`);
    const system = `${lead.systemInstruction}
You are ${lead.name}, in the ongoing project chat for "${project.name}" with the studio owner. This conversation is kept, so refer back to earlier messages when useful.
Project goal: ${project.goal || '(not set)'}
${chat.meeting ? `Next meeting: ${chat.meeting}\n` : ''}To-discuss list:
${open.join('\n') || '(empty)'}
Open cards:
${cards.join('\n') || '(none)'}
When the owner wants something added to the to-discuss list, put each item on its own line starting with "[agenda] ".
When the owner wants to set or move the project's meeting, put one line "[meeting] YYYY-MM-DDTHH:MM" (24-hour local time; today is ${localDay()}). You will host it: at that time a meeting room opens with the team and you lead it.
Keep replies short and direct. You can only reply with text; never claim to have done anything else.`;
    const history = chat.messages.slice(-CONTEXT_MESSAGES).map((m, i, all) => `${m.role === 'owner' ? 'Owner' : lead.name}: ${i < all.length - 6 && m.text.length > 800 ? `${m.text.slice(0, 800)} […]` : m.text}`).join('\n\n'); // token saver: older long messages are cut short
    try {
      const answer = await askTeammate(lead, system, `${history}\n\n${lead.name}:`, { maxTokens: 1500 });
      const { text: afterAgenda, items } = takeAgenda(answer.text || '');
      const { text: reply, at: meetAt } = takeMeeting(afterAgenda);
      for (const item of items) chat.agenda.push({ id: newId(), text: item, done: false, at: now() });
      if (meetAt) setMeeting(chat, meetAt, true);
      const fallback = [items.length ? `Added ${items.length} to the list.` : '', meetAt ? `Meeting set for ${meetingText(meetAt)}; I'll host it.` : ''].filter(Boolean).join(' ');
      chat.messages.push({ role: 'chief', text: reply || fallback || '…', at: now() });
      chat.messages = chat.messages.slice(-MAX_MESSAGES);
      save();
      res.json(chat);
    } catch (err: any) {
      save();
      res.status(502).json({ error: `Chief couldn't answer: ${String(err?.message || err).slice(0, 200)}`, ...chat });
    }
  });

  // Meetings page: every project's next meeting and topics.
  app.get('/api/meetings', (_req, res) => {
    const meetings = (getStore().projects || []).map((p) => {
      const c = chats[p.id];
      return { projectId: p.id, name: p.name, color: p.color, meeting: c?.meeting, meetingAt: c?.meetingAt, meetingHost: !!c?.meetingHost, hostedAt: c?.hostedAt, meetingRoomId: c?.meetingRoomId, agenda: c?.agenda || [] };
    });
    res.json({ meetings });
  });

  // The to-discuss list: add, tick off, remove; and the meeting time shown above it.
  app.post('/api/projects/:id/agenda', (req, res) => {
    if (!projectOf(req.params.id)) return res.status(404).json({ error: 'Project not found.' });
    const chat = chatOf(req.params.id);
    const text = clean(req.body?.text, 300);
    if (text) chat.agenda.push({ id: newId(), text, done: false, at: now() });
    if (typeof req.body?.meeting === 'string') {
      chat.meeting = clean(req.body.meeting, 80) || undefined;
      // The exact time when the meeting was picked from a calendar (so it can later count as past); cleared when typed by hand.
      const at = clean(req.body?.meetingAt, 40);
      chat.meetingAt = at && !Number.isNaN(Date.parse(at)) ? at : undefined;
    }
    if (typeof req.body?.meetingHost === 'boolean') chat.meetingHost = req.body.meetingHost;
    const item = chat.agenda.find((a) => a.id === req.body?.id);
    if (item && typeof req.body?.done === 'boolean') item.done = req.body.done;
    if (item && req.body?.remove === true) chat.agenda = chat.agenda.filter((a) => a !== item);
    if (req.body?.clearDone === true) chat.agenda = chat.agenda.filter((a) => !a.done);
    save();
    res.json(chat);
  });
}
