// Projects and their boards of cards. A project is one game or product; a card is one piece of work.
import type { Express } from 'express';
import type { Agent, Project, Card, CardColumn, Branch } from './src/types/index';

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
        status,
        autoRun: typeof b.autoRun === 'boolean' ? b.autoRun : existing.autoRun,
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
