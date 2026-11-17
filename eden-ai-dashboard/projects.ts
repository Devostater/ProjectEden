// Projects and their boards of cards. A project is one game or product; a card is one piece of work.
import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import type { Agent, Project, Card, CardColumn, Branch } from './src/types/index';
import { findCodebase } from './updates';
import { logActivity } from './activity';

export const COLUMNS: CardColumn[] = ['todo', 'ready', 'doing', 'review', 'done'];

interface ProjectStore {
  agents: Agent[];
  projects?: Project[];
  cards?: Card[];
}

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// A queue time: a valid date, or nothing ("start as soon as possible").
const validTime = (v: unknown) => (typeof v === 'string' && v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const MAIN_BRANCH = 'branch-main';
const mainBranch = (): Branch => ({ id: MAIN_BRANCH, name: 'Main', color: '#6366F1', memberIds: [] });

// Every project has at least the Main workstream, and every card belongs to one that exists.
function ensureBranches(store: ProjectStore): boolean {
  let changed = false;
  for (const p of store.projects || []) {
    if (!p.branches?.length) {
      p.branches = [mainBranch()];
      changed = true;
    }
  }
  for (const c of store.cards || []) {
    const p = (store.projects || []).find((x) => x.id === c.projectId);
    if (p && !p.branches!.some((b) => b.id === c.branchId)) {
      c.branchId = p.branches![0].id;
      changed = true;
    }
  }
  return changed;
}

// First run: one starter project for the repository already linked to the hub.
export function ensureProjects(store: ProjectStore): boolean {
  if (store.projects && store.cards) return ensureBranches(store);
  store.cards = store.cards || [];
  if (!store.projects) {
    store.projects = [
      {
        id: 'project-nova',
        name: 'Project Nova',
        goal: '',
        color: '#6366F1',
        status: 'active',
        repo: 'Devostater/Project-Nova',
        branches: [mainBranch()],
        createdAt: now(),
        updatedAt: now(),
      },
    ];
  }
  ensureBranches(store);
  return true;
}

// A safe file or folder name: no characters Windows refuses, no reserved names.
function safeName(raw: string, fallback: string): string {
  let n = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60);
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `_${n}`;
  return n || fallback;
}

// Saves an approved result as a Markdown file in <project folder>/Deliverables/<project name>/ and returns its full
// path. The project folder is the code folder linked to the project, or the hub's own folder if none is linked.
// Markdown is plain text: Word, Google Docs and Notepad all open it.
function writeDeliverable(project: Project, card: Card, resultText: string, author: string): string {
  const base = (findCodebase(project.codebaseId) || findCodebase())?.dir;
  if (!base || !fs.existsSync(base)) throw new Error('The project folder was not found on this PC.');
  const root = path.join(base, 'Deliverables');
  const folder = path.join(root, safeName(project.name, 'Project'));
  // Approving the same card again (after a revision) replaces its file; a different card with the same title gets its own.
  const again = card.deliverablePath && path.dirname(card.deliverablePath) === folder ? card.deliverablePath : '';
  let file = again || path.join(folder, `${safeName(card.title, 'Result')}.md`);
  if (!again && fs.existsSync(file)) file = path.join(folder, `${safeName(card.title, 'Result')} (${card.id.slice(-4)}).md`);
  if (path.relative(root, file).startsWith('..')) throw new Error('That file location is not allowed.');
  fs.mkdirSync(folder, { recursive: true });
  // Keep the results out of the code's history, whichever code folder this is, without touching its own settings.
  const ignore = path.join(root, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '# Approved results saved by Eden AI Hub. Not part of the code.\n*\n', 'utf-8');
  const body = `# ${card.title}\n\n*${project.name} · by ${author} · approved ${new Date().toLocaleString()}*\n\n${resultText.trim()}\n`;
  fs.writeFileSync(file, body, 'utf-8');
  return file;
}

// True if making `cardId` wait for `deps` would create a loop (A waits for B, B waits for A).
function createsLoop(cardId: string, deps: string[], all: Card[]): boolean {
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === cardId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(all.find((c) => c.id === id)?.dependsOn || []));
  }
  return false;
}

// Adds a note to a card from elsewhere in the hub (e.g. when its code change is applied).
export function noteOnCard(store: ProjectStore, cardId: string, text: string, moveTo?: CardColumn) {
  const card = (store.cards || []).find((c) => c.id === cardId);
  if (!card) return false;
  card.notes.push({ id: id('note'), author: 'Code update', text, at: now(), kind: 'result' });
  if (moveTo && card.column !== 'done') {
    card.column = moveTo;
    if (moveTo === 'review') card.reviewAt = now();
  }
  card.updatedAt = now();
  return true;
}

export function registerProjectRoutes(app: Express, getStore: () => ProjectStore, save: () => void) {
  const projects = () => getStore().projects!;
  const cards = () => getStore().cards!;

  app.get('/api/projects', (_req, res) => {
    res.json({ projects: projects(), cards: cards() });
  });

  // Create (no id) or update (id) a project.
  app.post('/api/projects', (req, res) => {
    const b = req.body || {};
    const existing = b.id ? projects().find((p) => p.id === b.id) : undefined;
    if (b.id && !existing) return res.status(404).json({ error: 'Project not found.' });
    const name = b.name !== undefined ? text(b.name, 80) : existing?.name || '';
    if (!name) return res.status(400).json({ error: 'A project needs a name.' });
    const status = ['active', 'paused', 'done'].includes(b.status) ? b.status : existing?.status || 'active';

    if (existing) {
      Object.assign(existing, {
        name,
        goal: b.goal !== undefined ? text(b.goal, 600) : existing.goal,
        color: b.color !== undefined ? text(b.color, 20) || existing.color : existing.color,
        repo: b.repo !== undefined ? text(b.repo, 200) : existing.repo,
        previewUrl: b.previewUrl !== undefined ? text(b.previewUrl, 300) || undefined : existing.previewUrl,
        status,
        autoRun: typeof b.autoRun === 'boolean' ? b.autoRun : existing.autoRun,
        checkpoints: typeof b.checkpoints === 'boolean' ? b.checkpoints : existing.checkpoints,
        codebaseId: b.codebaseId !== undefined ? text(b.codebaseId, 40) || undefined : existing.codebaseId,
        updatedAt: now(),
      });
      save();
      return res.json({ project: existing });
    }
    const project: Project = {
      id: id('project'),
      name,
      goal: text(b.goal, 600),
      color: text(b.color, 20) || '#6366F1',
      status,
      repo: text(b.repo, 200),
      branches: [mainBranch()],
      createdAt: now(),
      updatedAt: now(),
    };
    projects().push(project);
    save();
    res.json({ project });
  });

  // Replace a project's roadmap (its long-term goals and their building blocks). Checked and trimmed here.
  app.post('/api/projects/:id/roadmap', (req, res) => {
    const project = projects().find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const goals = Array.isArray(req.body?.roadmap) ? req.body.roadmap : null;
    if (!goals) return res.status(400).json({ error: 'Send the roadmap as a list of goals.' });
    const states = ['planned', 'building', 'done'];
    const wasDone = new Set((project.roadmap || []).flatMap((g) => g.blocks).filter((b) => b.state === 'done').map((b) => b.id));
    project.roadmap = goals.slice(0, 20).map((g: any) => ({
      id: text(g?.id, 40) || id('goal'),
      title: text(g?.title, 80) || 'Goal',
      icon: text(g?.icon, 8) || '🎯',
      blocks: (Array.isArray(g?.blocks) ? g.blocks : []).slice(0, 60).map((b: any) => ({
        id: text(b?.id, 40) || id('block'),
        title: text(b?.title, 120) || 'Block',
        state: states.includes(b?.state) ? b.state : 'planned',
        ...(text(b?.note, 400) ? { note: text(b.note, 400) } : {}),
      })),
    }));
    // Checkpoint: a block just finished, so the AI stops taking new cards until the owner presses Continue.
    const finished = (project.roadmap || []).flatMap((g) => g.blocks).filter((b) => b.state === 'done' && !wasDone.has(b.id));
    if (finished.length && project.checkpoints !== false && project.autoRun !== false) {
      project.autoRun = false;
      logActivity('info', `Checkpoint in ${project.name}: "${finished[0].title}" is done. The AI paused; look it over, then press Continue on Mission.`);
    }
    project.updatedAt = now();
    save();
    res.json({ project });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const store = getStore();
    if (!projects().some((p) => p.id === req.params.id)) return res.status(404).json({ error: 'Project not found.' });
    store.projects = projects().filter((p) => p.id !== req.params.id);
    store.cards = cards().filter((c) => c.projectId !== req.params.id);
    save();
    res.json({ ok: true });
  });

  // Create (no id) or change (id) a workstream in a project.
  app.post('/api/projects/:id/branches', (req, res) => {
    const project = projects().find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const b = req.body || {};
    const branches = project.branches!;
    const existing = b.id ? branches.find((x) => x.id === b.id) : undefined;
    if (b.id && !existing) return res.status(404).json({ error: 'Workstream not found.' });
    const name = b.name !== undefined ? text(b.name, 40) : existing?.name || '';
    if (!name) return res.status(400).json({ error: 'Give the workstream a name.' });
    if (branches.some((x) => x.id !== existing?.id && x.name.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: 'This project already has a workstream with that name.' });
    }
    const agents = getStore().agents;
    const memberIds = Array.isArray(b.memberIds)
      ? [...new Set<string>(b.memberIds.filter((m: unknown) => typeof m === 'string' && agents.some((a) => a.id === m)))]
      : existing?.memberIds || [];
    const color = text(b.color, 20) || existing?.color || '#06B6D4';
    if (existing) Object.assign(existing, { name, memberIds, color });
    else branches.push({ id: id('branch'), name, color, memberIds });
    project.updatedAt = now();
    save();
    res.json({ project });
  });

  // Deleting a workstream moves its cards to the first remaining one.
  app.delete('/api/projects/:id/branches/:branchId', (req, res) => {
    const project = projects().find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const branches = project.branches!;
    if (!branches.some((x) => x.id === req.params.branchId)) return res.status(404).json({ error: 'Workstream not found.' });
    if (branches.length <= 1) return res.status(400).json({ error: 'A project needs at least one workstream.' });
    project.branches = branches.filter((x) => x.id !== req.params.branchId);
    for (const c of cards()) if (c.projectId === project.id && c.branchId === req.params.branchId) c.branchId = project.branches[0].id;
    save();
    res.json({ project });
  });

  // Create (no id) or update (id) a card. Moving a card is an update of `column` and `order`.
  app.post('/api/cards', (req, res) => {
    const b = req.body || {};
    const existing = b.id ? cards().find((c) => c.id === b.id) : undefined;
    if (b.id && !existing) return res.status(404).json({ error: 'Card not found.' });

    const projectId = existing?.projectId || b.projectId;
    if (!projects().some((p) => p.id === projectId)) return res.status(400).json({ error: 'That project does not exist.' });
    const title = b.title !== undefined ? text(b.title, 160) : existing?.title || '';
    if (!title) return res.status(400).json({ error: 'A card needs a title.' });
    if (b.column !== undefined && !COLUMNS.includes(b.column)) return res.status(400).json({ error: 'Unknown column.' });
    if (b.assigneeId && !getStore().agents.some((a) => a.id === b.assigneeId)) {
      return res.status(400).json({ error: 'That teammate does not exist.' });
    }
    const column: CardColumn = b.column || existing?.column || 'todo';
    const projectBranches = projects().find((p) => p.id === projectId)!.branches!;
    if (b.branchId !== undefined && !projectBranches.some((x) => x.id === b.branchId)) {
      return res.status(400).json({ error: 'That workstream does not exist in this project.' });
    }
    const branchId: string = b.branchId || existing?.branchId || projectBranches[0].id;
    // Cards this one waits for: same project only, never itself, never a loop.
    let deps: string[] | undefined;
    if (Array.isArray(b.dependsOn)) {
      const wanted = [...new Set<string>(b.dependsOn.filter((d: unknown) => typeof d === 'string'))];
      deps = wanted.filter((d) => d !== existing?.id && cards().some((c) => c.id === d && c.projectId === projectId));
      if (existing && createsLoop(existing.id, deps, cards())) {
        return res.status(400).json({ error: 'Those cards would end up waiting on each other in a loop.' });
      }
    }
    const lastInColumn = Math.max(0, ...cards().filter((c) => c.projectId === projectId && c.column === column).map((c) => c.order));

    if (existing) {
      const movedColumn = column !== existing.column;
      if (existing.runState === 'running' && movedColumn) {
        // Taking a card out of "In progress" while the AI works: its result is still added as a note.
        existing.runState = undefined;
      }
      if (movedColumn || b.assigneeId !== undefined) {
        if (existing.runState !== 'running') existing.runState = undefined;
        existing.runMessage = undefined;
      }
      Object.assign(existing, {
        title,
        details: b.details !== undefined ? text(b.details, 4000) : existing.details,
        column,
        assigneeId: b.assigneeId !== undefined ? b.assigneeId || '' : existing.assigneeId,
        branchId,
        startAfter: b.startAfter !== undefined ? validTime(b.startAfter) : existing.startAfter,
        priority: ['low', 'normal', 'high'].includes(b.priority) ? b.priority : existing.priority,
        order: typeof b.order === 'number' && isFinite(b.order) ? b.order : movedColumn ? lastInColumn + 1 : existing.order,
        updatedAt: now(),
      });
      if (deps) existing.dependsOn = deps;
      if (movedColumn) {
        if (column === 'review') existing.reviewAt = now();
        existing.doneAt = column === 'done' ? now() : undefined;
      }
      if (typeof b.note === 'string' && b.note.trim()) {
        existing.notes.push({ id: id('note'), author: text(b.noteAuthor, 40) || 'You', text: text(b.note, 4000), at: now() });
      }
      save();
      return res.json({ card: existing });
    }

    const card: Card = {
      id: id('card'),
      projectId,
      title,
      details: text(b.details, 4000),
      column,
      assigneeId: b.assigneeId || '',
      branchId,
      priority: ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal',
      order: typeof b.order === 'number' && isFinite(b.order) ? b.order : lastInColumn + 1,
      notes: [],
      dependsOn: deps || [],
      startAfter: validTime(b.startAfter),
      source:
        b.source && (b.source.kind === 'nexus' || b.source.kind === 'plan')
          ? {
              kind: b.source.kind,
              roomId: text(b.source.roomId, 80) || undefined,
              roomName: text(b.source.roomName, 80) || undefined,
              messageSeq: Number.isInteger(b.source.messageSeq) ? b.source.messageSeq : undefined,
              label: text(b.source.label, 160) || undefined,
              runId: text(b.source.runId, 60) || undefined,
              at: now(),
            }
          : undefined,
      reviewAt: column === 'review' ? now() : undefined,
      doneAt: column === 'done' ? now() : undefined,
      createdAt: now(),
      updatedAt: now(),
    };
    cards().push(card);
    save();
    res.json({ card });
  });

  // Send a card in Review back with the owner's feedback. The same teammate gets the same card again, with the
  // feedback and their earlier result attached. The earlier result is marked "Revised".
  app.post('/api/cards/:id/send-back', (req, res) => {
    const card = cards().find((c) => c.id === req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found.' });
    if (card.column !== 'review') return res.status(400).json({ error: 'Only a card in Review can be sent back.' });
    const feedback = text(req.body?.note, 4000);
    if (!feedback) return res.status(400).json({ error: 'Write what should change first.' });
    if (!card.assigneeId || !getStore().agents.some((a) => a.id === card.assigneeId)) {
      return res.status(400).json({ error: 'Pick a teammate for this card first (open the card), so the same one can redo it.' });
    }
    // The result being replaced: the latest one that has not already been revised.
    const previous = [...card.notes].reverse().find((n) => n.kind === 'result' && !n.revised);
    if (previous) {
      previous.revised = true;
      previous.revisedAt = now();
    }
    card.notes.push({ id: id('note'), author: 'You', text: feedback, at: now(), kind: 'feedback' });
    card.column = 'ready';
    card.order = Math.max(0, ...cards().filter((c) => c.projectId === card.projectId && c.column === 'ready').map((c) => c.order)) + 1;
    card.runState = undefined;
    card.runMessage = undefined;
    card.reviewAt = undefined;
    card.doneAt = undefined;
    card.updatedAt = now();
    save();
    res.json({ card });
  });

  // Approve one or more cards waiting in Review: each goes to Done and its written result is saved to the
  // Deliverables folder. A card whose file can't be saved stays in Review, so nothing is approved without its file.
  app.post('/api/cards/approve', (req, res) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? [...new Set<string>(req.body.ids.filter((x: unknown) => typeof x === 'string'))].slice(0, 200) : [];
    if (!ids.length) return res.status(400).json({ error: 'Choose at least one card to approve.' });
    const approved: { id: string; title: string; path?: string }[] = [];
    const skipped: { id: string; title: string; reason: string }[] = [];
    for (const cardId of ids) {
      const card = cards().find((c) => c.id === cardId);
      if (!card) {
        skipped.push({ id: cardId, title: 'Unknown card', reason: 'This card no longer exists.' });
        continue;
      }
      if (card.column !== 'review') {
        skipped.push({ id: card.id, title: card.title, reason: 'It is no longer waiting for review.' });
        continue;
      }
      const project = projects().find((p) => p.id === card.projectId);
      const result = [...card.notes].reverse().find((n) => n.kind === 'result');
      let saved: string | undefined;
      if (project && result) {
        try {
          saved = writeDeliverable(project, card, result.text, result.author);
        } catch (err: any) {
          skipped.push({ id: card.id, title: card.title, reason: `The result could not be saved, so it was left in Review. ${err.message}` });
          continue;
        }
      }
      const lastDone = Math.max(0, ...cards().filter((c) => c.projectId === card.projectId && c.column === 'done').map((c) => c.order));
      card.column = 'done';
      card.order = lastDone + 1;
      card.doneAt = now();
      if (card.runState !== 'running') card.runState = undefined;
      card.runMessage = undefined;
      if (saved) card.deliverablePath = saved;
      card.updatedAt = now();
      approved.push({ id: card.id, title: card.title, path: saved });
    }
    if (approved.length) save();
    res.json({ approved, skipped });
  });

  app.delete('/api/cards/:id', (req, res) => {
    const store = getStore();
    if (!cards().some((c) => c.id === req.params.id)) return res.status(404).json({ error: 'Card not found.' });
    store.cards = cards().filter((c) => c.id !== req.params.id);
    // Nothing should keep waiting for a card that no longer exists.
    for (const c of store.cards) if (c.dependsOn?.includes(req.params.id)) c.dependsOn = c.dependsOn.filter((d) => d !== req.params.id);
    save();
    res.json({ ok: true });
  });
}
