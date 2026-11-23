import { jsonObject, jsonStore } from '../jsonStore';
import type { NexusData } from '../nexus';
import type { Agent, Card, DAGPipeline, HostedFile, Project, SwarmRun, UsageMetric } from '../src/types/index';

interface WorkspaceStore {
  agents: Agent[];
  swarmRuns: SwarmRun[];
  pipelines: DAGPipeline[];
  files: HostedFile[];
  usageLogs: UsageMetric[];
  teamVersion?: number;
  projects?: Project[];
  cards?: Card[];
  nexus?: NexusData;
}

// Starter team for the AI business hub. Mixed providers on purpose: heavy reasoning on Claude Opus,
// writing on GPT, fast research/ops on Gemini. Edit freely in the Agents page.
const agent = (
  id: string, name: string, role: string, model: string, color: string, systemInstruction: string, connectedTools: string[] = ['artifact_vault']
): Agent => ({
  id, name, role, model, color, systemInstruction, connectedTools,
  avatar: name.slice(0, 2).toUpperCase(), webhookUrl: '', githubRepo: '',
  totalTokens: 0, totalRuns: 0, avgLatencyMs: 0, status: 'idle',
});

// Bump when the starter team or pipelines change; saved data is updated to match on next start.
const TEAM_VERSION = 5;

const INITIAL_AGENTS: Agent[] = [
  agent('agent-synthesizer', 'Chief', 'Your lead', 'claude-sonnet-5-5', '#8B5CF6',
    "You are Chief, the owner's lead and chief of staff at a small studio that makes games and digital products and sells them online. You are who the owner talks to most. Answer directly and briefly, help decide what to do next, and keep track of what was agreed in this conversation. When a specialist would do a better job, say who to bring in with @name. When asked to combine the team's answers, give one plan: where they agree, conflicts and how to settle them, then next steps with an owner for each."),
  agent('agent-deputy', 'Lyra', 'Deputy lead', 'gemini-3.6-flash', '#06B6D4',
    "You are Lyra, deputy lead and second in command at a small studio that makes games and digital products and sells them online. You work directly under Chief. Turn the direction the owner and Chief set into concrete tasks, follow up on the details, check plans for gaps and risks, and step in for Chief when the owner asks. Be brief and practical, and when a specialist would do a better job, say who to bring in with @name."),
  agent('agent-strategist', 'Atlas', 'Strategy & Release Planning', 'claude-opus-5-5', '#6366F1',
    'You are Atlas, strategy lead for a small studio that makes games and digital products and sells them online. Decide what to build next, cut scope to something shippable, and plan releases. Weigh trade-offs honestly and end with a decision and the next 3 concrete actions.'),
  agent('agent-research', 'Scout', 'Market & Competitor Research', 'gemini-3.6-flash', '#0EA5E9',
    'You are Scout, market researcher for a games and digital products studio. Track genre and store trends, competing games and products, price points, tags and what players complain about in reviews. Separate facts from assumptions and say what should be verified.'),
  agent('agent-design', 'Quill', 'Game Design & Writing', 'claude-sonnet-5-5', '#A855F7',
    'You are Quill, game designer and writer. Design core loops, mechanics, progression, levels and balance, and write story, dialogue and in-game text. Keep designs small enough for a small team to finish, and explain why each choice is fun.'),
  agent('agent-art', 'Pixel', 'Art & Assets', 'gemini-3.6-flash', '#EC4899',
    'You are Pixel, art director. Define visual style, write clear asset briefs and image or 3D generation prompts, plan asset lists and pipelines (2D, 3D, UI, audio), and keep everything consistent and within a small budget.'),
  agent('agent-builder', 'Forge', 'Game & Product Engineering', 'claude-sonnet-5-5', '#10B981',
    'You are Forge, engineer for games and digital products. Write engine and gameplay code, tools and build scripts. Scope features to the smallest shippable version, write production-quality code, and flag performance and maintenance risks.', ['github_repo', 'artifact_vault']),
  agent('agent-marketing', 'Nova', 'Marketing & Launch', 'gpt-5', '#F97316',
    'You are Nova, marketing lead for games and digital products. Write store page copy, trailer scripts, social posts, devlogs, emails and press pitches with a clear hook and one call to action. Plan launch and wishlist campaigns.'),
  agent('agent-sales', 'Rex', 'Store & Sales', 'gemini-3.5-flash-lite', '#EAB308',
    'You are Rex, store and sales lead. Set pricing, bundles, discounts and regional prices, plan sales events, and prepare storefront listings (titles, tags, screenshot lists, descriptions) for online stores.'),
  agent('agent-support', 'Echo', 'Players & Community', 'claude-haiku-5-5', '#14B8A6',
    'You are Echo, community and player support. Draft friendly, accurate replies to players, reviews and bug reports, write FAQs and patch notes, and summarise feedback into themes. Escalate anything involving refunds, legal or account security.'),
  agent('agent-ops', 'Ledger', 'Money & Operations', 'gemini-3.6-flash', '#64748B',
    'You are Ledger, finance and operations. Track revenue, platform fees, costs and break-even per product, build budgets and simple forecasts, and write checklists for releases. Show your numbers and assumptions.'),
];

const INITIAL_PIPELINES: DAGPipeline[] = [
  {
    id: 'pipe-ship-product',
    name: 'Ship a Product',
    description: 'Check the market, define the game or product, plan the build, then prepare the store page and price, and save the release kit.',
    lastStatus: 'idle',
    nodes: [
      { id: 'n-research', label: 'Market check', type: 'agent', agentId: 'agent-research', status: 'idle', x: 40, y: 150,
        prompt: 'Research the market for this game or digital product idea: similar titles, their prices and reviews, and the gap we could fill.' },
      { id: 'n-design', label: 'Design', type: 'agent', agentId: 'agent-design', status: 'idle', x: 300, y: 60,
        prompt: 'Using the research, write a one-page design: core loop or core value, key features, and what is cut from version 1.' },
      { id: 'n-art', label: 'Art & asset list', type: 'agent', agentId: 'agent-art', status: 'idle', x: 300, y: 240,
        prompt: 'Using the research, define the visual style and list every asset version 1 needs, with a brief for each.' },
      { id: 'n-build', label: 'Build plan', type: 'agent', agentId: 'agent-builder', status: 'idle', x: 560, y: 150,
        prompt: 'From the design and asset list, write the build plan: milestones, technical approach, risks, and the first tasks.' },
      { id: 'n-store', label: 'Store page copy', type: 'agent', agentId: 'agent-marketing', status: 'idle', x: 820, y: 60,
        prompt: 'Write the store page: short description, full description, feature bullets, and a launch post.' },
      { id: 'n-price', label: 'Price & listing', type: 'agent', agentId: 'agent-sales', status: 'idle', x: 820, y: 240,
        prompt: 'Recommend the launch price, launch discount, tags and bundle ideas, with reasons.' },
      { id: 'n-save', label: 'Save release kit', type: 'artifact_save', outputPath: '/artifacts/release-kit.md', status: 'idle', x: 1080, y: 150 },
    ],
    edges: [
      { id: 'e1', source: 'n-research', target: 'n-design' },
      { id: 'e2', source: 'n-research', target: 'n-art' },
      { id: 'e3', source: 'n-design', target: 'n-build' },
      { id: 'e4', source: 'n-art', target: 'n-build' },
      { id: 'e5', source: 'n-build', target: 'n-store' },
      { id: 'e6', source: 'n-build', target: 'n-price' },
      { id: 'e7', source: 'n-store', target: 'n-save' },
      { id: 'e8', source: 'n-price', target: 'n-save' },
    ],
  },
];

export function workspaceStore(file: string) {
  const workspaceFile = jsonStore<WorkspaceStore>(file, (value) =>
    jsonObject(value) &&
    Array.isArray(value.agents) && value.agents.every(jsonObject) &&
    Array.isArray(value.pipelines) && value.pipelines.every(jsonObject) &&
    Array.isArray(value.swarmRuns) && Array.isArray(value.files) && Array.isArray(value.usageLogs), 2);

  function loadStore(): WorkspaceStore {
    const loaded = workspaceFile.read();
    if (loaded) {
      // Move agents off Gemini models that are retired or unavailable on the free tier.
      const RETIRED: Record<string, string> = {
        'gemini-3.8-flash': 'gemini-3.6-flash',
        'gemini-3.1-flash-lite': 'gemini-3.5-flash-lite',
      };
      for (const a of loaded.agents) if (RETIRED[a.model]) a.model = RETIRED[a.model];
      // Starter team changed: update the starter agents' roles and instructions (usage stats are kept),
      // add any new ones, and swap the starter pipelines. Agents and pipelines you created are untouched.
      if (loaded.teamVersion !== TEAM_VERSION) {
        const formerLyra = loaded.agents.find((a) => a.id === 'agent-audio');
        if (formerLyra && !loaded.agents.some((a) => a.id === 'agent-deputy')) formerLyra.id = 'agent-deputy';
        for (const seed of INITIAL_AGENTS) {
          const existing = loaded.agents.find((a) => a.id === seed.id);
          if (existing) {
            const { totalTokens, totalRuns, avgLatencyMs } = existing;
            Object.assign(existing, structuredClone(seed), { totalTokens, totalRuns, avgLatencyMs });
          } else {
            loaded.agents.push(structuredClone(seed));
          }
        }
        const order = (id: string) => {
          const i = INITIAL_AGENTS.findIndex((s) => s.id === id);
          return i < 0 ? 999 : i;
        };
        loaded.agents.sort((a, b) => order(a.id) - order(b.id));
        loaded.pipelines = [
          ...structuredClone(INITIAL_PIPELINES),
          ...loaded.pipelines.filter(
            (p) => p.id !== 'pipe-offer-launch' && !INITIAL_PIPELINES.some((s) => s.id === p.id)
          ),
        ];
        loaded.teamVersion = TEAM_VERSION;
        saveStore(loaded);
      }
      return loaded;
    }
    const initial: WorkspaceStore = {
      agents: structuredClone(INITIAL_AGENTS),
      swarmRuns: [],
      pipelines: structuredClone(INITIAL_PIPELINES),
      files: [],
      usageLogs: [],
      teamVersion: TEAM_VERSION,
    };
    saveStore(initial);
    return initial;
  }

  function saveStore(store: WorkspaceStore) {
    try {
      workspaceFile.write(store);
    } catch (err) {
      console.error('Failed to write store:', err);
    }
  }

  return { load: loadStore, save: saveStore };
}
