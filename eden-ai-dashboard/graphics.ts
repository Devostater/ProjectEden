// Heavy graphics work goes to Unreal (through Aura) instead of making video or images on this PC with
// LYRA's generator, which ties up the PC's memory (that's what slowed it down before).
//   - cards that are graphics work (renders, trailers, cinematics, screenshots, 3D models, scenes, key art)
//     are given to Aura when it's open and you're online; otherwise they run as before
//   - LYRA (or anything on this PC) can hand a graphics job to the hub:
//       POST /api/graphics/jobs  { title, prompt, kind? }   -> { id }
//       GET  /api/graphics/jobs/:id                          -> { status, result? }
//     The job becomes a card in the "Graphics (Unreal)" project, assigned to Aura, and shows on the board.
import type { Express, Request } from 'express';
import { logActivity } from './activity';
import { auraLastKnownUp } from './aura';
import { isOffline } from './offline';
import type { Agent, Card } from './src/types/index';

const GRAPHICS = /\b(render(ing|s)?|trailer|cinematic|cutscene|screenshot|key ?art|3d (model|asset|scene)|environment art|level art|scene|lighting pass|turntable|video|animation|vfx|niagara|material|texture|thumbnail|capsule art)\b/i;

export const isGraphicsWork = (c: { title: string; details?: string }) => GRAPHICS.test(`${c.title} ${c.details || ''}`);

export const auraTeammate = (agents: Agent[]) => agents.find((a) => a.model?.startsWith('aura'));

// The model to try first for a card: Aura for graphics work when it can take it, otherwise nothing special.
export function graphicsModelFor(card: Card, agents: Agent[], agent: Agent): string | null {
  if (agent.model?.startsWith('aura')) return null; // already Aura
  if (!isGraphicsWork(card) || isOffline() || !auraLastKnownUp()) return null;
  const aura = auraTeammate(agents);
  return aura ? aura.model : null;
}

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

const PROJECT_NAME = 'Graphics (Unreal)';
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function registerGraphicsRoutes(app: Express, getStore: () => any, save: () => void) {
  app.post('/api/graphics/jobs', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only from this computer.' });
    const prompt = String(req.body?.prompt || '').trim().slice(0, 3000);
    if (!prompt) return res.status(400).json({ error: 'Describe the graphics job in "prompt".' });
    const title = String(req.body?.title || prompt).trim().slice(0, 90);
    const store = getStore();
    store.projects ||= [];
    store.cards ||= [];
    let project = store.projects.find((p: any) => p.name === PROJECT_NAME);
    const now = new Date().toISOString();
    if (!project) {
      project = {
        id: newId('project'),
        name: PROJECT_NAME,
        goal: 'Heavy graphics jobs (renders, trailers, scenes, 3D) done in Unreal through Aura, so this PC stays free.',
        color: '#8B5CF6',
        status: 'active',
        repo: '',
        branches: [{ id: 'main', name: 'Main', color: '#8B5CF6', memberIds: [] }],
        createdAt: now,
        updatedAt: now,
      };
      store.projects.push(project);
    }
    const aura = auraTeammate(store.agents || []);
    const order = Math.max(0, ...store.cards.filter((c: any) => c.projectId === project.id && c.column === 'ready').map((c: any) => c.order)) + 1;
    const card: Card = {
      id: newId('card'),
      projectId: project.id,
      title,
      details: `${prompt}\n\n(Sent by ${String(req.body?.from || 'LYRA').slice(0, 40)}${req.body?.kind ? `, kind: ${String(req.body.kind).slice(0, 30)}` : ''}.) Use Unreal through Aura's tools; give the output files' locations in the result.`,
      column: 'ready',
      assigneeId: aura?.id,
      priority: 'normal',
      order,
      notes: [],
      createdAt: now,
      updatedAt: now,
    };
    store.cards.push(card);
    save();
    logActivity('work', `Graphics job for Unreal: ${title}${aura ? '' : ' (add an Aura teammate to run it)'}`);
    res.json({ id: card.id, projectId: project.id, assigned: !!aura });
  });

  app.get('/api/graphics/jobs/:id', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only from this computer.' });
    const card = (getStore().cards || []).find((c: any) => c.id === req.params.id);
    if (!card) return res.status(404).json({ error: 'No such job.' });
    const result = [...(card.notes || [])].reverse().find((n: any) => n.kind === 'result');
    const status = card.column === 'done' || card.column === 'review' ? 'done' : card.runState === 'running' ? 'working' : card.runState === 'failed' ? 'failed' : 'waiting';
    res.json({ status, column: card.column, message: card.runMessage, result: result?.text });
  });
}
