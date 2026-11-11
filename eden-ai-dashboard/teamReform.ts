// "Reform team": re-picks the AI behind each teammate to fit what is available right now.
//   - Heavy thinking (the lead, strategy, engineering, design and writing) goes on Claude while it has room.
//   - Lyra (deputy) goes on LYRA, your own AI, when it is running.
//   - Everyone else gets a different free model each (Google AI Studio models, free AIs you added, then
//     models on this PC), so each draws on its own free limit instead of all sharing one.
//   - AIs that are off, out of today's budget or have hit their plan limit are not used.
// The plan is shown first; nothing changes until you apply it.
import type { Express, Request } from 'express';
import type { Agent } from './src/types/index';
import { providerUsage, providerFor, models, type ProviderId } from './providers';
import { freeFallbacks } from './extraAI';
import { logActivity } from './activity';

export interface ReformChange {
  agentId: string;
  name: string;
  role: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  reason: string;
}

const HEAVY = /lead|chief|strateg|engineer|build|design|writ|code/i;

export function planReform(agents: Agent[]): { changes: ReformChange[]; summary: string } {
  const usage = providerUsage();
  const room = (p: ProviderId) => {
    const u = usage.find((x) => x.provider === p);
    if (!u || u.mode === 'off' || u.limitNote || u.real?.limited) return 0;
    return Math.max(0, 1 - u.messages / u.limit);
  };
  const label = (id: string) => models().find((m) => m.id === id)?.label || id;
  // Skip AI Studio copies of the models the regular Gemini already uses: same key, same Google limit.
  const geminiModels = models().filter((m) => m.provider === 'google').map((m) => m.id);
  const free = freeFallbacks(40).filter((id) => !geminiModels.some((g) => id.endsWith(`:${g}`)));
  let nextFree = 0;
  const takeFree = (avoid: Set<string>) => {
    for (let i = 0; i < free.length; i++) {
      const id = free[(nextFree + i) % free.length];
      if (!avoid.has(id)) {
        nextFree = (nextFree + i + 1) % free.length;
        return id;
      }
    }
    return free[0];
  };

  const claudeRoom = room('anthropic');
  const used = new Set<string>();
  // Claude seats: the lead always (if Claude works), other heavy roles only while there's plenty of room.
  let claudeSeats = claudeRoom <= 0 ? 0 : claudeRoom > 0.5 ? 4 : claudeRoom > 0.25 ? 2 : 1;

  const plan = agents.map((a) => {
    const lead = a.id === 'agent-synthesizer';
    const deputy = a.id === 'agent-deputy' || /deputy/i.test(a.role);
    const heavy = lead || HEAVY.test(a.role);
    let to = a.model;
    let reason = '';
    if (deputy && room('lyra') > 0) {
      to = 'lyra';
      reason = 'LYRA is your own AI and is running.';
    } else if (heavy && claudeSeats > 0) {
      claudeSeats--;
      to = providerFor(a.model) === 'anthropic' ? a.model : 'claude-sonnet-5-5';
      // Opus is the deepest thinker but uses the plan fastest: keep it only while there's lots of room.
      if (to === 'claude-opus-5-5' && claudeRoom < 0.5) to = 'claude-sonnet-5-5';
      reason = lead ? 'The lead needs the strongest AI.' : 'Heavy thinking work, and Claude has room today.';
    } else if (free.length) {
      to = takeFree(used);
      reason = heavy ? 'Claude is busy today, so a strong free model takes this.' : 'Free, with its own daily limit.';
    } else if (room('google') > 0) {
      to = 'gemini-3.6-flash';
      reason = 'Gemini still has room today.';
    } else if (claudeRoom > 0) {
      to = 'claude-haiku-5-5';
      reason = 'Claude Haiku is quick and light on your plan.';
    }
    used.add(to);
    return { a, to, reason };
  });

  const changes = plan
    .filter((p) => p.to && p.to !== p.a.model)
    .map((p) => ({ agentId: p.a.id, name: p.a.name, role: p.a.role, from: p.a.model, to: p.to, fromLabel: label(p.a.model), toLabel: label(p.to), reason: p.reason }));
  const freeCount = plan.filter((p) => p.to.startsWith('x:')).length;
  const summary = `${changes.length} of ${agents.length} teammates would switch. ${freeCount} would run on free models${claudeRoom > 0 ? `, Claude has ${Math.round(claudeRoom * 100)}% of today's budget left` : ', Claude is not available right now'}.`;
  return { changes, summary };
}

const isLocal = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');

export function registerTeamReformRoutes(app: Express, getAgents: () => Agent[], save: () => void) {
  app.get('/api/team/reform', (_req, res) => {
    res.json(planReform(getAgents()));
  });
  app.post('/api/team/reform', (req, res) => {
    // Applies the changes the page showed (only the ones still valid), so a stale preview can't surprise you.
    const wanted: { agentId: string; to: string }[] = Array.isArray(req.body?.changes) ? req.body.changes : [];
    const valid = new Set(models().map((m) => m.id));
    let n = 0;
    for (const c of wanted) {
      const agent = getAgents().find((a) => a.id === c.agentId);
      if (agent && typeof c.to === 'string' && valid.has(c.to)) {
        agent.model = c.to;
        n++;
      }
    }
    if (n) {
      save();
      logActivity('done', `Team reformed: ${n} teammate${n === 1 ? '' : 's'} moved to the AIs with room today.`);
    }
    res.json({ ok: true, changed: n, local: isLocal(req) });
  });
}
