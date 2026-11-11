// Projects and their boards of cards. A project is one game or product; a card is one piece of work.
import type { Express } from 'express';
import type { Agent, Project, Card, CardColumn } from './src/types/index';

export const COLUMNS: CardColumn[] = ['todo', 'ready', 'doing', 'review', 'done'];

interface ProjectStore {
  agents: Agent[];
  projects?: Project[];
  cards?: Card[];
}

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// First run: one starter project for the repository already linked to the hub.
export function ensureProjects(store: ProjectStore): boolean {
  if (store.projects && store.cards) return false;
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
        createdAt: now(),
        updatedAt: now(),
      },
    ];
  }
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
      priority: ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal',
      order: typeof b.order === 'number' && isFinite(b.order) ? b.order : lastInColumn + 1,
      notes: [],
      dependsOn: deps || [],
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
