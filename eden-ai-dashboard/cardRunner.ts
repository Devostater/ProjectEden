// The card runner: when a card sits in "Ready" with a teammate assigned, that teammate's AI does the
// work, the result is added to the card as a note, and the card moves to "Review" for the owner.
import { generate, providerFor, providerUnavailable, fallbackModels, providerLabel, providerUsage, defaultModel, type ProviderId } from './providers';
import type { Agent, Project, Card } from './src/types/index';
import { logActivity } from './activity';
import { aiPaused } from './control';

interface RunnerStore {
  agents: Agent[];
  projects?: Project[];
  cards?: Card[];
}

const MAX_AT_ONCE = 2; // cards worked on at the same time
const TICK_MS = 4000;
const running = new Set<string>();

const now = () => new Date().toISOString();
const noteId = () => `note-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// An AI is over budget when this app has already sent it the day's allowance of messages.
// Chat ignores the budget (you asked directly); automatic card work respects it.
function overBudget(p: ProviderId): boolean {
  const u = providerUsage().find((x) => x.provider === p);
  return !!u && u.messages >= u.limit;
}

// Models to try for this teammate, in order: their own AI first, then other connected ones.
function modelQueue(agent: Agent): string[] {
  const wanted = agent.model || defaultModel();
  const wantedProvider = providerFor(wanted);
  const own = providerUnavailable(wantedProvider) || overBudget(wantedProvider) ? [] : [wanted];
  return [...own, ...fallbackModels(wantedProvider).filter((m) => !overBudget(providerFor(m)))];
}

// Ask one teammate something directly, using their own AI first and other connected ones after.
// Card work passes respectBudget so it stops at the daily budget; direct requests do not.
export async function askTeammate(
  agent: Agent,
  system: string,
  prompt: string,
  opts: { respectBudget?: boolean; maxTokens?: number; onlyModels?: string[] } = {}
): Promise<{ text: string; provider: ProviderId; tokens: number; via?: string }> {
  const wanted = agent.model || defaultModel();
  const wantedProvider = providerFor(wanted);
  // `onlyModels` pins the AI (free-only rooms use Gemini only, never a paid fallback).
  const queue = opts.onlyModels
    ? opts.onlyModels
    : opts.respectBudget
    ? modelQueue(agent)
    : [...(providerUnavailable(wantedProvider) ? [] : [wanted]), ...fallbackModels(wantedProvider)];
  let lastError = 'No AI is available right now. Set one up in Account → Connections.';
  for (const model of queue) {
    try {
      const r = await generate({ model, system, prompt, maxTokens: opts.maxTokens ?? 8000 });
      if (r.text.trim()) {
        agent.totalRuns += 1;
        agent.totalTokens += r.tokens || 0;
        return { text: r.text.trim(), provider: r.provider, tokens: r.tokens || 0, via: r.provider !== wantedProvider ? providerLabel(r.provider) : undefined };
      }
      lastError = 'The AI returned an empty answer.';
    } catch (err: any) {
      lastError = err?.message || 'failed';
    }
  }
  throw new Error(lastError);
}

function buildPrompt(project: Project, card: Card, all: Card[] = []): string {
  const parts = [`Project: ${project.name}`];
  if (project.goal) parts.push(`Project goal: ${project.goal}`);
  if (project.repo) parts.push(`GitHub repository: ${project.repo}`);
  parts.push(`\nTask: ${card.title}`);
  if (card.details) parts.push(card.details);
  const earlier = (card.dependsOn || []).map((id) => all.find((c) => c.id === id)).filter((c): c is Card => !!c);
  if (earlier.length) {
    parts.push('\nFinished work from earlier cards that this task builds on:');
    for (const dep of earlier) {
      const result = [...dep.notes].reverse().find((n) => n.kind === 'result');
      parts.push(`--- "${dep.title}"${result ? ` (by ${result.author}):\n${result.text.slice(0, 4000)}` : ': finished, no written result.'}`);
    }
  }
  if (card.notes.length) {
    parts.push('\nNotes on this card so far, oldest first (earlier results and the owner\'s feedback):');
    for (const n of card.notes.filter((n) => n.kind !== 'error')) parts.push(`--- ${n.author}:\n${n.text}`);
    parts.push('\nIf the owner left feedback after the last result, deliver a revised result that addresses it.');
  }
  return parts.join('\n');
}

const systemFor = (agent: Agent) =>
  `${agent.systemInstruction}
You are ${agent.name} (${agent.role}), working on a task card for the studio owner. Deliver the finished work for this task in full, ready to use, in clear Markdown. Start with the result itself, not an introduction. If something essential is missing, make a sensible assumption, list it in one line at the end under "Assumptions", and carry on.
You can only produce text. You cannot change files or the app, run anything, or contact anyone, so never say that you did.`;

async function work(cardId: string, getStore: () => RunnerStore, save: () => void) {
  const find = () => (getStore().cards || []).find((c) => c.id === cardId);
  const card = find();
  const project = (getStore().projects || []).find((p) => p.id === card?.projectId);
  const agent = getStore().agents.find((a) => a.id === card?.assigneeId);
  if (!card || !project || !agent) return;

  let result: { text: string; provider: ProviderId } | null = null;
  let lastError = 'No AI is available right now.';
  const wantedProvider = providerFor(agent.model || defaultModel());
  for (const model of modelQueue(agent)) {
    try {
      const r = await generate({ model, system: systemFor(agent), prompt: buildPrompt(project, card, getStore().cards || []), maxTokens: 8000 });
      if (r.text.trim()) {
        agent.totalRuns += 1;
        agent.totalTokens += r.tokens || 0;
        result = { text: r.text.trim(), provider: r.provider };
        break;
      }
      lastError = 'The AI returned an empty answer.';
    } catch (err: any) {
      lastError = err?.message || 'failed';
    }
  }

  // The owner may have edited, moved or deleted the card while the AI was working.
  const current = find();
  if (!current) return;
  const stillOurs = current.column === 'doing' && current.runState === 'running';
  if (result) {
    current.notes.push({
      id: noteId(),
      author: agent.name,
      text: result.text,
      at: now(),
      kind: 'result',
      via: result.provider !== wantedProvider ? providerLabel(result.provider) : undefined,
    });
    if (stillOurs) {
      current.column = 'review';
      current.reviewAt = now();
      current.order = Date.now();
    }
    current.runState = undefined;
    current.runMessage = undefined;
    logActivity('done', `${agent.name} finished "${current.title}" (${project.name}). It is waiting in Review.`);
  } else {
    current.notes.push({ id: noteId(), author: 'System', text: `${agent.name} couldn't finish this: ${lastError}`, at: now(), kind: 'error' });
    if (stillOurs) current.column = 'todo';
    current.runState = 'failed';
    current.runMessage = lastError;
    logActivity('error', `${agent.name} could not finish "${current.title}" (${project.name}): ${lastError}`);
  }
  current.updatedAt = now();
  save();
}

// The scheduler. Each teammate works on one card at a time. When their card moves on (to Review, or
// it is waiting for something), they are free again and take, in order:
//   1. their own next Ready card, preferring the workstream they last worked in;
//   2. an unassigned Ready card in any workstream they are a member of, which they then own.
// So a teammate waiting on you in one workstream keeps busy in another until their next card is back.
const lastBranch = new Map<string, string>(); // teammate id -> workstream they last worked in

export const runningCards = () => running.size;

function tick(getStore: () => RunnerStore, save: () => void) {
  if (aiPaused()) return; // Pause AI: start nothing new
  const store = getStore();
  const projects = store.projects || [];
  const all = store.cards || [];
  const rank = { high: 0, normal: 1, low: 2 } as const;
  const runnable = (c: Card) => {
    const p = projects.find((p) => p.id === c.projectId);
    return c.column === 'ready' && !running.has(c.id) && !!p && p.status === 'active' && p.autoRun !== false;
  };
  const byPriority = (a: Card, b: Card) => rank[a.priority] - rank[b.priority] || a.order - b.order;
  const blockersOf = (c: Card) => (c.dependsOn || []).map((id) => all.find((x) => x.id === id)).filter((x) => x && x.column !== 'done') as Card[];
  const branchName = (c: Card) => projects.find((p) => p.id === c.projectId)?.branches?.find((b) => b.id === c.branchId)?.name || '';

  let changed = false;
  const hold = (card: Card, message: string) => {
    if (card.runState !== 'waiting' || card.runMessage !== message) {
      card.runState = 'waiting';
      card.runMessage = message;
      changed = true;
    }
  };

  // Mark cards that can't start yet, so the board says why.
  const candidates = all.filter(runnable);
  for (const card of candidates) {
    const blockers = blockersOf(card);
    if (blockers.length) hold(card, `Waiting for: ${blockers.map((c) => c.title).join(', ')}`.slice(0, 220));
    else if (card.runState === 'waiting' && card.runMessage?.startsWith('Waiting for:')) {
      card.runState = undefined;
      card.runMessage = undefined;
      changed = true;
    }
  }
  // Queued cards wait until their start time.
  const due = (c: Card) => !c.startAfter || Date.parse(c.startAfter) <= Date.now();
  for (const card of candidates) {
    if (!due(card) && !blockersOf(card).length) hold(card, `Queued: starts ${new Date(card.startAfter!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
    else if (due(card) && card.runState === 'waiting' && card.runMessage?.startsWith('Queued:')) {
      card.runState = undefined;
      card.runMessage = undefined;
      changed = true;
    }
  }
  const startable = candidates.filter((c) => !blockersOf(c).length && due(c)).sort(byPriority);

  const busy = new Set(all.filter((c) => c.runState === 'running' && c.assigneeId).map((c) => c.assigneeId!));
  for (const agent of store.agents) {
    if (running.size >= MAX_AT_ONCE) break;
    if (busy.has(agent.id)) continue;

    const mine = startable.filter((c) => c.assigneeId === agent.id);
    const preferred = lastBranch.get(agent.id);
    let card: Card | undefined = mine.find((c) => c.branchId === preferred) || mine[0];
    let claimed = false;
    if (!card) {
      // Nothing of their own: pick up unassigned work in a workstream they belong to.
      card = startable.find((c) => {
        if (c.assigneeId) return false;
        const branch = projects.find((p) => p.id === c.projectId)?.branches?.find((b) => b.id === c.branchId);
        return !!branch?.memberIds.includes(agent.id);
      });
      claimed = !!card;
    }
    if (!card) continue;

    if (!modelQueue(agent).length) {
      hold(card, "Waiting: no connected AI has messages left in today's budget.");
      continue;
    }
    if (claimed) {
      card.assigneeId = agent.id;
      startable.splice(startable.indexOf(card), 1);
    }
    busy.add(agent.id);
    running.add(card.id);
    if (card.branchId) lastBranch.set(agent.id, card.branchId);
    card.column = 'doing';
    card.runState = 'running';
    card.runMessage = undefined;
    card.runStartedAt = now();
    card.updatedAt = now();
    changed = true;
    const where = [projects.find((p) => p.id === card!.projectId)?.name, branchName(card)].filter(Boolean).join(' · ');
    logActivity('work', `${agent.name} ${claimed ? 'picked up' : 'started'} "${card.title}" (${where}).`);
    const cardId = card.id;
    work(cardId, getStore, save)
      .catch((err) => console.error('Card runner error:', err))
      .finally(() => running.delete(cardId));
  }
  if (changed) save();
}

export function startCardRunner(getStore: () => RunnerStore, save: () => void) {
  // Cards that were mid-run when the server last stopped go back to Ready and are picked up again.
  let recovered = false;
  for (const c of getStore().cards || []) {
    if (c.runState === 'running') {
      c.column = 'ready';
      c.runState = undefined;
      recovered = true;
    }
  }
  // Cards left in "In progress" that nothing is working on (moved there by hand, or left over from a
  // restart) go back to Ready if someone is assigned, so the team picks them up.
  for (const c of getStore().cards || []) {
    if (c.column === 'doing' && !c.runState && c.assigneeId && c.runStartedAt) {
      c.column = 'ready';
      recovered = true;
    }
  }
  if (recovered) save();
  setInterval(() => {
    try {
      tick(getStore, save);
    } catch (err) {
      console.error('Card runner tick failed:', err);
    }
  }, TICK_MS);
}
