// Project chat: one ongoing conversation with Chief per project, kept on the hub so it survives closing the page,
// plus a "to discuss" list (an agenda, e.g. for a meeting at 5). Chief sees the project, the list and the recent
// conversation, and can add to the list by ending a line with [agenda] in its reply.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import { askTeammate } from './cardRunner';
import type { Agent, Project, Card } from './src/types/index';

export interface ChatLine { role: 'owner' | 'chief'; text: string; at: string }
export interface AgendaItem { id: string; text: string; done: boolean; at: string }
interface ProjectChat { messages: ChatLine[]; agenda: AgendaItem[]; meeting?: string; meetingAt?: string }

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

export function registerProjectChat(app: Express, getStore: () => { agents: Agent[]; projects?: Project[]; cards?: Card[] }) {
  const projectOf = (id: string) => (getStore().projects || []).find((p) => p.id === id);

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
When the owner wants something added to the to-discuss list, put each item on its own line starting with "[agenda] ". Keep replies short and direct. You can only reply with text; never claim to have done anything else.`;
    const history = chat.messages.slice(-CONTEXT_MESSAGES).map((m) => `${m.role === 'owner' ? 'Owner' : lead.name}: ${m.text}`).join('\n\n');
    try {
      const answer = await askTeammate(lead, system, `${history}\n\n${lead.name}:`, { maxTokens: 1500 });
      const { text: reply, items } = takeAgenda(answer.text || '');
      for (const item of items) chat.agenda.push({ id: newId(), text: item, done: false, at: now() });
      chat.messages.push({ role: 'chief', text: reply || (items.length ? `Added ${items.length} to the list.` : '…'), at: now() });
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
      return { projectId: p.id, name: p.name, color: p.color, meeting: c?.meeting, meetingAt: c?.meetingAt, agenda: c?.agenda || [] };
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
    const item = chat.agenda.find((a) => a.id === req.body?.id);
    if (item && typeof req.body?.done === 'boolean') item.done = req.body.done;
    if (item && req.body?.remove === true) chat.agenda = chat.agenda.filter((a) => a !== item);
    if (req.body?.clearDone === true) chat.agenda = chat.agenda.filter((a) => !a.done);
    save();
    res.json(chat);
  });
}
