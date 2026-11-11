// Delegation: the lead (Chief) reads a goal for a project and proposes a set of cards, each assigned
// to the teammate best suited to it. Nothing is added to the board until the owner approves the plan.
import type { Express } from 'express';
import { askTeammate } from './cardRunner';
import { logActivity } from './activity';
import type { Agent, Project, Card } from './src/types/index';

interface PlannerStore {
  agents: Agent[];
  projects?: Project[];
  cards?: Card[];
}

const LEAD_ID = 'agent-synthesizer';
const MAX_CARDS = 8;

// Models often wrap JSON in a code fence or add a sentence around it; take the outermost object.
function extractJson(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The plan came back in a form the app could not read. Try again.');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('The plan came back in a form the app could not read. Try again.');
  }
}

export function registerPlannerRoutes(app: Express, getStore: () => PlannerStore) {
  app.post('/api/projects/:id/plan', async (req, res) => {
    const store = getStore();
    const project = (store.projects || []).find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const goal = typeof req.body?.goal === 'string' ? req.body.goal.trim().slice(0, 2000) : '';
    if (!goal) return res.status(400).json({ error: 'Describe what you want done first.' });
    const lead = store.agents.find((a) => a.id === LEAD_ID) || store.agents[0];
    if (!lead) return res.status(400).json({ error: 'There is nobody on the team to plan this.' });

    const team = store.agents.filter((a) => a.id !== lead.id);
    const roster = team.map((a) => `- ${a.name}: ${a.role}`).join('\n');
    const existing = (store.cards || []).filter((c) => c.projectId === project.id && c.column !== 'done').map((c) => `- ${c.title}`);

    const system = `${lead.systemInstruction}
You are planning work for the studio owner. Break the goal into task cards and assign each to one teammate.
Reply with ONLY a JSON object, no other text, in exactly this shape:
{"summary": "one or two sentences on the approach", "cards": [{"title": "short imperative title", "details": "what to produce and what done looks like, 1-3 sentences", "assignee": "teammate name", "priority": "high" | "normal" | "low", "waitsFor": [numbers]}]}
Rules:
- Between 3 and ${MAX_CARDS} cards. Fewer, well-scoped cards beat many small ones.
- Each card must be something one teammate can finish alone as a written deliverable (a plan, a spec, copy, a list, code as text). They cannot run tools, edit files or contact anyone.
- Each card must make sense on its own: put any context the teammate needs into its details.
- "assignee" must be exactly one of the teammate names listed. Pick by role.
- Mark as "high" only what the rest depends on.
- "waitsFor" lists the positions (1 for the first card, 2 for the second...) of EARLIER cards in your list whose finished result this card needs. Use [] when it can start straight away. Only add a link when the later card truly needs the earlier result.
- Do not repeat work already on the board.`;

    const prompt = [
      `Project: ${project.name}`,
      project.goal ? `Project goal: ${project.goal}` : '',
      project.repo ? `GitHub repository: ${project.repo}` : '',
      `\nTeammates you can assign:\n${roster}`,
      existing.length ? `\nAlready on the board:\n${existing.join('\n')}` : '',
      `\nWhat the owner wants now:\n${goal}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const answer = await askTeammate(lead, system, prompt, { maxTokens: 4000 });
      const plan = extractJson(answer.text);
      const byName = new Map(team.map((a) => [a.name.toLowerCase(), a]));
      const cards = (Array.isArray(plan.cards) ? plan.cards : [])
        .slice(0, MAX_CARDS)
        .map((c: any, index: number) => {
          const title = typeof c?.title === 'string' ? c.title.trim().slice(0, 160) : '';
          const assignee = byName.get(String(c?.assignee || '').trim().toLowerCase().replace(/^@/, ''));
          return {
            title,
            details: typeof c?.details === 'string' ? c.details.trim().slice(0, 2000) : '',
            assigneeId: assignee?.id || '',
            priority: ['high', 'normal', 'low'].includes(c?.priority) ? c.priority : 'normal',
            // 0-based positions of earlier cards only, so a plan can never contain a loop.
            waitsFor: (Array.isArray(c?.waitsFor) ? c.waitsFor : [])
              .map((n: unknown) => Number(n) - 1)
              .filter((n: number) => Number.isInteger(n) && n >= 0 && n < index),
          };
        })
        .filter((c: any) => c.title);
      if (!cards.length) throw new Error('Chief did not propose any cards. Try describing the goal in more detail.');
      logActivity('done', `${lead.name} proposed ${cards.length} cards for ${project.name}. Waiting for your approval.`);
      res.json({
        summary: typeof plan.summary === 'string' ? plan.summary.trim().slice(0, 600) : '',
        cards,
        plannedBy: lead.name,
        via: answer.via || '',
      });
    } catch (err: any) {
      logActivity('error', `Planning for ${project.name} failed: ${err?.message || 'unknown error'}`);
      res.status(502).json({ error: err?.message || 'Planning failed.' });
    }
  });
}
