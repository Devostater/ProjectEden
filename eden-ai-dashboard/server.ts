import { hubPort } from './config.mjs';
import { registerConversationRoutes } from './server/routes/chat';
import { workspaceStore } from './server/workspaceStore';
import express from 'express';
import { dashboardMode, registerHealthRoute, serveDashboard } from './dashboardSite';
import { GoogleGenAI } from '@google/genai';
import { startProviderStatusRefresh, generate, withSpendingNotice, replyToTabletChat, models, defaultModel, providerStatus, costByProvider } from './providers';
import { registerSettingsRoutes } from './settings';
import { registerPairing } from './server/routes/pairing';
import { registerTabletChat } from './tabletChat';
import { sendApprovedWebhook } from './permissions';
import { registerHunterGuard } from './hunterGuard';
import { registerProjectRoutes, ensureProjects, noteOnCard } from './server/routes/projects';
import { registerNewProjectRoutes } from './newproject';
import { registerToolboxRoutes } from './toolbox';
import { startCardRunner, askTeammate, runningCards } from './cardRunner';
import { registerPlannerRoutes } from './planner';
import { registerProjectChat } from './projectChat';
import { registerPreviewProxy } from './previewProxy';
import { registerActivityRoutes, logActivity } from './activity';
import { registerTerminalRoutes } from './terminal';
import { registerLyraRoutes } from './lyra';
import { appendToChat, registerChatRoutes } from './chats';
import { registerRepoRoutes } from './repos';
import { registerNexusRoutes, runningRooms } from './nexus';
import { registerControlRoutes } from './control';
import { registerUsageGuard } from './usageGuard';
import { registerUpdateRoutes } from './updates';
import { registerRestartRoutes } from './restart';
import { registerBusyRoutes } from './busy';
import { registerOfflineRoutes } from './offline';
import { registerKnowledgeRoutes } from './knowledge';
import { registerGraphicsRoutes } from './graphics';
import { registerBackupRoutes } from './backup';
import { registerDeviceRoutes } from './devices';
import { registerPerfRoutes } from './perf';
import { registerProfileRoutes } from './profile';
import { registerTeamDeviceRoutes } from './teamDevices';
import { registerTeamReformRoutes } from './teamReform';
import { registerDeviceHubRoutes, ON_DEVICE } from './deviceHub';
import { startExtraScan } from './extraAI';
import { parseRepo, githubFetch, githubError, githubStatus } from './github';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  Agent,
  SwarmRun,
  SwarmAgentResult,
  DAGPipeline,
  DAGNode,
  HostedFile,
} from './src/types/index.ts';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local') });
dotenv.config();

// Windows: the AI programs (claude, codex, gemini) are installed by npm into %APPDATA%\npm. Two things can
// hide them and make every code update fail with "'claude' is not recognized":
//   - Eden started from somewhere with an older search path: add %APPDATA%\npm ourselves.
//   - A program installed from inside a Store-style app (such as the Claude desktop app) goes into that app's
//     private copy of AppData, which only that app can see. Eden started from Windows then can't find it, so we
//     also look in those private copies, but only for programs missing from the normal folder.
if (process.platform === 'win32' && process.env.APPDATA) {
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'Path';
  const parts = (process.env[key] || '').split(';').filter(Boolean);
  const has = (dir: string) => parts.some((p) => p.replace(/\\+$/, '').toLowerCase() === dir.toLowerCase());
  const npmBin = path.join(process.env.APPDATA, 'npm');
  if (fs.existsSync(npmBin) && !has(npmBin)) parts.push(npmBin);
  if (!fs.existsSync(path.join(npmBin, 'claude.cmd')) && process.env.LOCALAPPDATA) {
    try {
      const pkgs = path.join(process.env.LOCALAPPDATA, 'Packages');
      for (const name of fs.readdirSync(pkgs)) {
        const dir = path.join(pkgs, name, 'LocalCache', 'Roaming', 'npm');
        if (fs.existsSync(path.join(dir, 'claude.cmd')) && !has(dir)) {
          parts.push(dir);
          console.log(`Claude Code found only inside ${name}; using it from there. Install it normally with: npm install -g @anthropic-ai/claude-code`);
          break;
        }
      }
    } catch {}
  }
  process.env[key] = parts.join(';');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// One stray error in a background job shouldn't take the whole hub down (and interrupt whatever the team is
// doing). It is written to the log instead, at most once a minute per message, and the hub carries on.
const strayErrors = new Map<string, number>();
const stray = (kind: string, err: any) => {
  const message = String(err?.message || err).slice(0, 200);
  console.error(`${kind}:`, err?.stack || err);
  if (Date.now() - (strayErrors.get(message) || 0) < 60000) return;
  strayErrors.set(message, Date.now());
  try {
    logActivity('error', `Something went wrong inside the hub (it kept running): ${message}`);
  } catch {}
};
process.on('unhandledRejection', (err) => stray('Unhandled promise rejection', err));
process.on('uncaughtException', (err) => stray('Uncaught error', err));
// If whatever started the hub goes away, writing to its log must not crash the hub.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const STORE_PATH = path.join(__dirname, '.nexusflow-store.json');

function getGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const { load: loadStore, save: saveStore } = workspaceStore(STORE_PATH);
const store = loadStore();
if (ensureProjects(store)) saveStore(store);

function estimateTokens(text: string): number {
  return Math.max(32, Math.ceil(text.length / 3.6));
}

async function runSingleAgent(
  agent: Agent,
  userPrompt: string,
  extraContext?: string
): Promise<{ text: string; latencyMs: number; tokens: number }> {
  const start = Date.now();
  const fullContents = extraContext
    ? `Context / Upstream Data:\n${extraContext}\n\nTask / Command:\n${userPrompt}`
    : userPrompt;

  const response = await askTeammate(
    agent,
    `${agent.systemInstruction}\nYou are ${agent.name} (${agent.role}), doing one step of a workflow for the studio owner. Deliver the finished result for this step in clear Markdown. You can only produce text: you cannot change files or contact anyone.`,
    fullContents
  );

  const outputText = withSpendingNotice(response) || 'No output returned by model.';
  const latencyMs = Math.max(120, Date.now() - start);
  const tokens = response.tokens || estimateTokens(fullContents + outputText);

  return { text: outputText, latencyMs, tokens };
}

async function fetchGitHubRepoSummary(repoTarget: string): Promise<{
  summary: string;
  filesImported: HostedFile[];
}> {
  const cleanRepo = parseRepo(repoTarget).repo;
  const repoRes = await githubFetch(`https://api.github.com/repos/${cleanRepo}`);

  if (!repoRes.ok) {
    throw new Error(githubError(repoRes.status, cleanRepo, repoRes.headers.get('x-ratelimit-remaining')));
  }

  const repoData = (await repoRes.json()) as {
    full_name: string;
    description: string;
    default_branch: string;
    stargazers_count: number;
    language: string;
    updated_at: string;
  };

  const importedFiles: HostedFile[] = [];

  // Fetch README if available
  try {
    const readmeRes = await githubFetch(`https://api.github.com/repos/${cleanRepo}/readme`);
    if (readmeRes.ok) {
      const readmeJson = (await readmeRes.json()) as {
        name: string;
        content?: string;
        encoding?: string;
      };
      if (readmeJson.content && readmeJson.encoding === 'base64') {
        const decoded = Buffer.from(readmeJson.content, 'base64')
          .toString('utf-8')
          .slice(0, 12000);
        importedFiles.push({
          id: `gh-${Date.now()}-readme`,
          path: `/github/${cleanRepo}/${readmeJson.name}`,
          name: readmeJson.name,
          category: 'github_repo',
          language: 'markdown',
          sizeBytes: Buffer.byteLength(decoded, 'utf-8'),
          content: decoded,
          authorAgentName: 'GitHub Sync',
          githubRef: `${cleanRepo}@${repoData.default_branch}`,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Ignore optional README errors
  }

  // Fetch root directory listing
  let treeSummary = '';
  try {
    const contentsRes = await githubFetch(`https://api.github.com/repos/${cleanRepo}/contents`);
    if (contentsRes.ok) {
      const items = (await contentsRes.json()) as Array<{
        name: string;
        path: string;
        type: string;
        size: number;
      }>;
      if (Array.isArray(items)) {
        treeSummary = items
          .slice(0, 25)
          .map((item) => `- [${item.type}] ${item.path} (${item.size} B)`)
          .join('\n');

        const manifestContent = JSON.stringify(
          {
            repository: repoData.full_name,
            description: repoData.description,
            defaultBranch: repoData.default_branch,
            stars: repoData.stargazers_count,
            primaryLanguage: repoData.language,
            syncedAt: new Date().toISOString(),
            rootEntries: items.slice(0, 30).map((i) => ({
              name: i.name,
              type: i.type,
              size: i.size,
            })),
          },
          null,
          2
        );

        importedFiles.push({
          id: `gh-${Date.now()}-manifest`,
          path: `/github/${cleanRepo}/repo-tree.json`,
          name: 'repo-tree.json',
          category: 'github_repo',
          language: 'json',
          sizeBytes: Buffer.byteLength(manifestContent, 'utf-8'),
          content: manifestContent,
          authorAgentName: 'GitHub Sync',
          githubRef: `${cleanRepo}@${repoData.default_branch}`,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Ignore optional tree listing error
  }

  const summary = `Repository: ${repoData.full_name} (Branch: ${repoData.default_branch}, Language: ${repoData.language || 'Polyglot'}, Stars: ${repoData.stargazers_count})\nDescription: ${repoData.description || 'No description'}\nRoot Entries:\n${treeSummary || 'Standard repository structure'}`;

  return { summary, filesImported: importedFiles };
}

async function startServer() {
  const { dev, host } = dashboardMode(process.argv.slice(2));
  const app = express();
  registerHunterGuard(app, __dirname); // first of all: blocks DNS rebinding and other websites (reports them to HUNTER)
  registerPairing(app); // must come first: guards every route for devices other than this computer
  const PORT = hubPort();

  registerHealthRoute(app, dev);
  app.use(express.json({ limit: '5mb' }));
  registerTabletChat(app, replyToTabletChat);

  // 1. Get complete workspace state
  app.get('/api/workspace', (_req, res) => {
    const totalTokens = store.agents.reduce((acc, a) => acc + a.totalTokens, 0);
    const totalRuns = store.agents.reduce((acc, a) => acc + a.totalRuns, 0);
    const avgLatencyMs =
      store.agents.length > 0
        ? Math.round(
            store.agents.reduce((acc, a) => acc + a.avgLatencyMs, 0) /
              store.agents.length
          )
        : 0;

    const costs = costByProvider(store.agents);

    res.json({
      agents: store.agents,
      swarmRuns: store.swarmRuns,
      pipelines: store.pipelines,
      files: store.files,
      telemetry: {
        totalTokens,
        totalRuns,
        avgLatencyMs,
        activeAgentsCount: store.agents.filter((a) => a.status !== 'offline')
          .length,
        estimatedCost: costs.payPerUseCost, // pay-per-use AIs only; plan and free AIs count as $0
        payPerUseCost: costs.payPerUseCost,
        payPerUseTokens: costs.payPerUseTokens,
        coveredTokens: costs.coveredTokens,
        byProvider: costs.byProvider,
        recentLogs: store.usageLogs.slice(0, 40),
      },
    });
  });

  registerConversationRoutes(app, __dirname, () => store.agents, () => saveStore(store), appendToChat);

  registerSettingsRoutes(app);
  registerNewProjectRoutes(app, () => store, () => saveStore(store)); // before the /api/projects/:id routes
  registerToolboxRoutes(app, () => store, () => saveStore(store)); // a project's own tools, keys and links
  registerProjectRoutes(app, () => store, () => saveStore(store));
  registerPlannerRoutes(app, () => store);
  registerProjectChat(app, () => store); // ongoing project chat with Chief + to-discuss list
  const closePreviews = registerPreviewProxy(app, () => store);
  registerActivityRoutes(app);
  registerTerminalRoutes(app);
  registerLyraRoutes(app);
  registerChatRoutes(app); // owner chat history
  if (!ON_DEVICE) registerRepoRoutes(app); // GitHub repos in the workspace folder (only on the PC)
  registerProfileRoutes(app); // your picture, frame, bio, links and quick commands
  registerPerfRoutes(app); // live CPU, memory, GPU and what Eden uses (Devices > Performance)
  if (!ON_DEVICE) registerDeviceRoutes(app); // a hub running on a phone or tablet has no USB devices to manage
  if (!ON_DEVICE) registerTeamDeviceRoutes(app); // alerts and screens on connected devices for the AI team
  registerDeviceHubRoutes(app);
  startExtraScan();
  registerUpdateRoutes(app, {
    // A code change asked for from a card goes back to that card for review.
    onApplied: ({ cardId, codebase, files, needsRestart, restartHint }) => {
      if (!cardId) return;
      noteOnCard(store, cardId, `Code change applied to ${codebase} (${files} file${files === 1 ? '' : 's'}).${needsRestart ? ` To finish: ${restartHint}.` : ''}`, 'review');
      saveStore(store);
    },
  });
  registerRestartRoutes(app);
  registerBusyRoutes(app);
  registerOfflineRoutes(app);
  registerKnowledgeRoutes(app, () => store);
  registerGraphicsRoutes(app, () => store, () => saveStore(store));
  if (!process.env.EDEN_DEVICE_HUB) registerBackupRoutes(app);
  registerControlRoutes(app, () => ({ cards: runningCards(), rooms: runningRooms() }));
  registerUsageGuard(app); // warns at 85% of a plan, can pause the team at 95%
  registerNexusRoutes(app, () => store, () => saveStore(store));
  registerTeamReformRoutes(app, () => store.agents, () => saveStore(store), () => store.cards || []);
  logActivity('info', 'Hub started.');
  startCardRunner(() => store, () => saveStore(store));

  app.get('/api/models', (_req, res) => {
    res.set('X-Eden-Mode', dev ? 'development' : 'production');
    res.json({ models: models(), providers: providerStatus(), defaultModel: defaultModel() });
  });

  app.get('/api/agents', (_req, res) => {
    res.json({ agents: store.agents });
  });

  app.get('/api/usage', (_req, res) => {
    const totalTokens = store.agents.reduce((acc, a) => acc + a.totalTokens, 0);
    const totalRuns = store.agents.reduce((acc, a) => acc + a.totalRuns, 0);
    const avgLatencyMs =
      store.agents.length > 0
        ? Math.round(
            store.agents.reduce((acc, a) => acc + a.avgLatencyMs, 0) /
              store.agents.length
          )
        : 0;
    const costs = costByProvider(store.agents);

    res.json({
      totalTokens,
      totalRuns,
      avgLatencyMs,
      activeAgentsCount: store.agents.filter((a) => a.status !== 'offline').length,
      estimatedCost: costs.payPerUseCost, // pay-per-use AIs only; plan and free AIs count as $0
      payPerUseCost: costs.payPerUseCost,
      payPerUseTokens: costs.payPerUseTokens,
      coveredTokens: costs.coveredTokens,
      byProvider: costs.byProvider,
      recentLogs: store.usageLogs.slice(0, 50),
    });
  });

  app.post('/api/usage/grill', async (req, res) => {
    const { userDefense } = req.body || {};
    const totalTokens = store.agents.reduce((acc, a) => acc + a.totalTokens, 0);
    const totalRuns = store.agents.reduce((acc, a) => acc + a.totalRuns, 0);
    const sortedByTokens = [...store.agents].sort((a, b) => b.totalTokens - a.totalTokens);
    const agentBreakdown = sortedByTokens
      .map(
        (a) =>
          `- ${a.name} (${a.role}) [${a.model}]: ${a.totalTokens.toLocaleString()} tokens across ${a.totalRuns} runs (${Math.round((a.totalTokens / (totalTokens || 1)) * 100)}% share, ${a.avgLatencyMs}ms avg latency)`
      )
      .join('\n');

    try {
      const prompt = `Here is the current AI team usage for this games and digital products studio:
Total Tokens Burned: ${totalTokens.toLocaleString()} / 500,000 monthly quota (${Math.round((totalTokens / 500000) * 100)}%)
Total Swarm & Pipeline Runs: ${totalRuns}
Hosted Artifacts in Vault: ${store.files.length}

Agent-by-Agent Breakdown:
${agentBreakdown}

${userDefense ? `Owner's response: "${userDefense}"\n` : ''}
Task:
1. Give a candid, no-fluff audit of how AI spend is distributed across the team's agents and providers (Claude, Gemini, OpenAI).
2. Call out imbalances: expensive models on simple work, cheap models on high-stakes work, or broadcasting to every agent when 2-3 would do.
3. Ask 3 pointed questions about what is actually moving the business forward (revenue, customers, shipping) versus busywork.
4. Give 3 concrete next commands to fix the imbalance immediately.`;

      const response = await generate({ model: req.body?.model || defaultModel(), prompt: prompt, system: 'You are an AI operations auditor for a small games and digital products studio. Be direct and constructive about cost versus business value.' });

      res.json({
        grillReport: withSpendingNotice(response) || 'Audit complete.',
        totalTokens,
        totalRuns,
        quotaPercent: Math.min(100, Math.round((totalTokens / 500000) * 100)),
        topConsumer: sortedByTokens[0]?.name || 'Claude Engine Specialist',
        lowestConsumer: sortedByTokens[sortedByTokens.length - 1]?.name || 'Pulse DevOps',
      });
    } catch (err: any) {
      res.status(500).json({
        error: err?.message || 'Failed to generate usage grill report.',
      });
    }
  });

  app.get('/api/pipelines', (_req, res) => {
    res.json({ pipelines: store.pipelines });
  });

  app.get('/api/files', (_req, res) => {
    res.json({ files: store.files });
  });

  app.put('/api/files/:id', (req, res) => {
    const file = store.files.find((f) => f.id === req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const { content, path: newPath, language } = req.body;
    if (content !== undefined) {
      file.content = content;
      file.sizeBytes = Buffer.byteLength(content, 'utf-8');
    }
    if (newPath) file.path = newPath;
    if (language) file.language = language;
    file.updatedAt = new Date().toISOString();
    saveStore(store);
    res.json({ file });
  });

  app.post('/api/swarm/synthesize', async (req, res) => {
    const { prompt, results } = req.body;
    if (!prompt || !Array.isArray(results) || results.length === 0) {
      res.status(400).json({ error: 'Prompt and results array required' });
      return;
    }
    try {
      const agentSummaries = results
        .map((r: any) => `Agent [${r.agentName || r.agentId}]:\n${r.content}`)
        .join('\n\n---\n\n');
      const synthPrompt = `Synthesize the following parallel agent findings for prompt: "${prompt}"\n\n${agentSummaries}\n\nWrite one short combined plan: where the team agrees, any conflicts and how to settle them, then the next steps with an owner for each.`;
      const response = await generate({ model: req.body?.model || defaultModel(), prompt: synthPrompt, system: 'You are Chief, chief of staff for a small games and digital products studio. Combine the team answers into one clear, decisive plan. Be brief.' });
      res.json({ synthesis: withSpendingNotice(response) || 'Synthesis complete.' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Synthesis failed' });
    }
  });

  app.get('/api/github/status', async (req, res) => {
    res.json(await githubStatus(req.query.refresh === '1'));
  });

  app.post('/api/github/fetch-repo', async (req, res) => {
    const { repo: repoInput, filePath } = req.body || {};
    if (!repoInput) {
      res.status(400).json({ error: 'Enter a repository as owner/name or paste its GitHub link.' });
      return;
    }
    try {
      // Accept a pasted link as well as owner/name; a link to a folder or file sets the path too.
      const parsed = parseRepo(String(repoInput));
      const repo = parsed.repo;
      const subPath = String(filePath || parsed.path || '').replace(/^\/+|\/+$/g, '');
      const url = subPath
        ? `https://api.github.com/repos/${repo}/contents/${subPath.split('/').map(encodeURIComponent).join('/')}`
        : `https://api.github.com/repos/${repo}/contents`;
      const ghRes = await githubFetch(url);
      if (!ghRes.ok) {
        res
          .status(ghRes.status)
          .json({ error: githubError(ghRes.status, repo, ghRes.headers.get('x-ratelimit-remaining')) });
        return;
      }
      const data: any = await ghRes.json();
      if (Array.isArray(data)) {
        res.json({
          type: 'dir',
          items: data.map((item: any) => ({
            name: item.name,
            path: item.path,
            type: item.type,
            size: item.size,
          })),
        });
      } else if (data.content && data.encoding === 'base64') {
        const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
        const newFile: HostedFile = {
          id: `gh-${Date.now()}`,
          path: `/github/${repo}/${data.path}`,
          name: data.name,
          category: 'github_repo',
          language: data.name.endsWith('.ts') ? 'typescript' : data.name.endsWith('.json') ? 'json' : 'markdown',
          sizeBytes: data.size,
          content: decoded,
          authorAgentName: 'GitHub Sync',
          githubRef: `${repo}@main`,
          updatedAt: new Date().toISOString(),
        };
        store.files.unshift(newFile);
        saveStore(store);
        res.json({ type: 'file', file: newFile });
      } else {
        res.json({ data });
      }
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to fetch from GitHub' });
    }
  });

  // 2. Create or update an agent
  app.post('/api/agents', (req, res) => {
    const payload = req.body as Partial<Agent>;
    if (!payload.name || !payload.role || !payload.systemInstruction) {
      res
        .status(400)
        .json({ error: 'Name, role, and systemInstruction are required.' });
      return;
    }

    const existingIdx = store.agents.findIndex((a) => a.id === payload.id);
    if (existingIdx >= 0) {
      store.agents[existingIdx] = {
        ...store.agents[existingIdx],
        ...payload,
      };
      saveStore(store);
      res.json({ agent: store.agents[existingIdx] });
      return;
    }

    const initials = payload.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const newAgent: Agent = {
      id: `agent-${Date.now()}`,
      name: payload.name,
      role: payload.role,
      avatar: payload.avatar || initials || 'AG',
      model: payload.model && models().some((m) => m.id === payload.model) ? payload.model : defaultModel(),
      systemInstruction: payload.systemInstruction,
      color: payload.color || '#6366F1',
      connectedTools: payload.connectedTools || ['artifact_vault'],
      localModel: payload.localModel || undefined,
      webhookUrl: payload.webhookUrl || '',
      githubRepo: payload.githubRepo || '',
      totalTokens: 0,
      totalRuns: 0,
      avgLatencyMs: 0,
      status: 'idle',
    };

    store.agents.push(newAgent);
    saveStore(store);
    res.json({ agent: newAgent });
  });

  // 3. Delete an agent
  app.delete('/api/agents/:id', (req, res) => {
    const { id } = req.params;
    if (id === 'agent-synthesizer') {
      res.status(400).json({ error: 'Chief is your lead and cannot be removed.' });
      return;
    }
    if (store.agents.length <= 1) {
      res
        .status(400)
        .json({ error: 'At least one agent must remain in the workspace.' });
      return;
    }
    store.agents = store.agents.filter((a) => a.id !== id);
    for (const c of store.cards || []) if (c.assigneeId === id) c.assigneeId = '';
    saveStore(store);
    res.json({ ok: true });
  });

  // 4. Execute Parallel Swarm Broadcast across multiple agents
  app.post('/api/swarm/execute', async (req, res) => {
    try {
      const {
        prompt,
        agentIds,
        attachedFileIds = [],
        synthesize = true,
        saveAsArtifact = false,
      } = req.body as {
        prompt: string;
        agentIds: string[];
        attachedFileIds?: string[];
        synthesize?: boolean;
        saveAsArtifact?: boolean;
      };

      if (!prompt || !Array.isArray(agentIds) || agentIds.length === 0) {
        res.status(400).json({
          error: 'Please provide a command prompt and select at least one agent.',
        });
        return;
      }

      const selectedAgents = store.agents.filter((a) =>
        agentIds.includes(a.id)
      );
      if (selectedAgents.length === 0) {
        res.status(400).json({ error: 'No matching agents found.' });
        return;
      }

      // Build shared file context if user attached hosted files
      const attachedFiles = store.files.filter((f) =>
        attachedFileIds.includes(f.id)
      );
      const fileContext =
        attachedFiles.length > 0
          ? attachedFiles
              .map(
                (f) =>
                  `--- Hosted File: ${f.path} (${f.githubRef || f.category}) ---\n${f.content.slice(0, 4000)}`
              )
              .join('\n\n')
          : undefined;

      // Execute all selected agents in parallel!
      const results: SwarmAgentResult[] = await Promise.all(
        selectedAgents.map(async (agent): Promise<SwarmAgentResult> => {
          try {
            const { text, latencyMs, tokens } = await runSingleAgent(
              agent,
              prompt,
              fileContext
            );

            // Update agent stats
            agent.totalTokens += tokens;
            agent.totalRuns += 1;
            agent.avgLatencyMs =
              agent.avgLatencyMs === 0
                ? latencyMs
                : Math.round((agent.avgLatencyMs + latencyMs) / 2);

            store.usageLogs.unshift({
              id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp: new Date().toISOString(),
              agentId: agent.id,
              agentName: agent.name,
              operation: 'Swarm Broadcast',
              tokens,
              latencyMs,
              status: 'success',
            });

            return {
              agentId: agent.id,
              agentName: agent.name,
              agentRole: agent.role,
              color: agent.color,
              content: text,
              latencyMs,
              tokens,
              status: 'completed',
            };
          } catch (err: any) {
            const errorMessage =
              err instanceof Error ? err.message : 'Agent execution failed';
            store.usageLogs.unshift({
              id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp: new Date().toISOString(),
              agentId: agent.id,
              agentName: agent.name,
              operation: 'Swarm Broadcast',
              tokens: 0,
              latencyMs: 0,
              status: 'error',
            });
            return {
              agentId: agent.id,
              agentName: agent.name,
              agentRole: agent.role,
              color: agent.color,
              content: `Error executing ${agent.name}: ${errorMessage}`,
              latencyMs: 0,
              tokens: 0,
              status: 'error',
              error: errorMessage,
            };
          }
        })
      );

      let synthesisText: string | undefined;
      let savedArtifactPath: string | undefined;

      const successfulResults = results.filter((r) => r.status === 'completed');

      if (synthesize && successfulResults.length > 1) {
        try {
          const coordinator =
            store.agents.find((a) => a.id === 'agent-synthesizer') ||
            selectedAgents[0];
          const synthesisPrompt = `Synthesize the following parallel agent responses to the user command: "${prompt}".\nHighlight consensus recommendations, resolve trade-offs, and provide a unified action plan.\n\n${successfulResults
            .map(
              (r) =>
                `=== Agent: ${r.agentName} (${r.agentRole}) ===\n${r.content}`
            )
            .join('\n\n')}`;

          const synRes = await runSingleAgent(coordinator, synthesisPrompt);
          synthesisText = synRes.text;

          coordinator.totalTokens += synRes.tokens;
          coordinator.totalRuns += 1;
          store.usageLogs.unshift({
            id: `log-${Date.now()}-syn`,
            timestamp: new Date().toISOString(),
            agentId: coordinator.id,
            agentName: coordinator.name,
            operation: 'Consensus Synthesis',
            tokens: synRes.tokens,
            latencyMs: synRes.latencyMs,
            status: 'success',
          });
        } catch (synErr: any) {
          synthesisText = `Synthesis note: ${synErr?.message || 'Unable to synthesize automatically.'}`;
        }
      }

      if (saveAsArtifact) {
        const slug = prompt
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 32);
        const fileName = `swarm-${slug || 'run'}-${Date.now().toString().slice(-4)}.md`;
        savedArtifactPath = `/artifacts/${fileName}`;

        const compiledMarkdown = `# Swarm Execution Artifact\n\n- **Command**: ${prompt}\n- **Executed At**: ${new Date().toISOString()}\n- **Agents Coordinated**: ${results.map((r) => r.agentName).join(', ')}\n\n${
          synthesisText
            ? `## Coordinator Consensus Synthesis\n\n${synthesisText}\n\n---\n\n`
            : ''
        }## Individual Parallel Agent Outputs\n\n${results
          .map(
            (r) =>
              `### ${r.agentName} (${r.agentRole}) — ${r.latencyMs}ms · ${r.tokens} tokens\n\n${r.content}`
          )
          .join('\n\n---\n\n')}`;

        const artifactFile: HostedFile = {
          id: `file-${Date.now()}`,
          path: savedArtifactPath,
          name: fileName,
          category: 'pipeline_artifact',
          language: 'markdown',
          sizeBytes: Buffer.byteLength(compiledMarkdown, 'utf-8'),
          content: compiledMarkdown,
          authorAgentName: 'Swarm Coordinator',
          githubRef: 'swarm/parallel-run',
          updatedAt: new Date().toISOString(),
        };

        store.files.unshift(artifactFile);
      }

      const newRun: SwarmRun = {
        id: `swarm-${Date.now()}`,
        prompt,
        timestamp: new Date().toISOString(),
        agentIds,
        results,
        synthesis: synthesisText,
        savedArtifactPath,
      };

      store.swarmRuns.unshift(newRun);
      saveStore(store);

      res.json({
        swarmRun: newRun,
        agents: store.agents,
        files: store.files,
      });
    } catch (error: any) {
      res.status(500).json({
        error: error?.message || 'Failed to execute parallel swarm command.',
      });
    }
  });

  // 5. Save or export an existing SwarmRun as a hosted artifact
  app.post('/api/swarm/:id/save-artifact', (req, res) => {
    const { id } = req.params;
    const run = store.swarmRuns.find((r) => r.id === id);
    if (!run) {
      res.status(404).json({ error: 'Swarm run not found.' });
      return;
    }

    const slug = run.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
    const fileName = `swarm-${slug || 'report'}-${Date.now().toString().slice(-4)}.md`;
    const filePath = `/artifacts/${fileName}`;

    const content = `# Swarm Execution Report\n\n**Prompt**: ${run.prompt}\n**Timestamp**: ${run.timestamp}\n\n${
      run.synthesis ? `## Consensus Synthesis\n\n${run.synthesis}\n\n` : ''
    }## Agent Responses\n\n${run.results
      .map(
        (r) =>
          `### ${r.agentName} (${r.agentRole})\n*Latency: ${r.latencyMs}ms · Tokens: ${r.tokens}*\n\n${r.content}`
      )
      .join('\n\n---\n\n')}`;

    const newFile: HostedFile = {
      id: `file-${Date.now()}`,
      path: filePath,
      name: fileName,
      category: 'pipeline_artifact',
      language: 'markdown',
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      content,
      authorAgentName: 'Swarm Coordinator',
      githubRef: 'swarm/artifact',
      updatedAt: new Date().toISOString(),
    };

    run.savedArtifactPath = filePath;
    store.files.unshift(newFile);
    saveStore(store);

    res.json({ file: newFile, swarmRun: run });
  });

  // 6a. Draft a workflow from a description. Returns steps only; nothing is saved until the owner presses Save.
  app.post('/api/pipelines/draft', async (req, res) => {
    const about = String(req.body?.description || '').trim().slice(0, 1500);
    if (!about) return res.status(400).json({ error: 'Describe what the workflow should do.' });
    const lead = store.agents.find((a) => a.id === 'agent-synthesizer') || store.agents[0];
    if (!lead) return res.status(400).json({ error: 'Add a teammate first.' });
    const roster = store.agents.map((a) => `- ${a.name} (${a.role})`).join('\n');
    const system = `You design short workflows: chains of 2 to 6 steps run in order, where each step gets the result of the step before it. Reply with JSON only, no other text:
{"name":"short name","description":"one sentence","steps":[{"label":"2-4 words","who":"a teammate's exact name","prompt":"what this step should do, 1-3 sentences"}]}
Pick the best-fitting teammate for each step. To save the final result as a file, end with {"label":"Save to Files","save":"workflows/<short-file-name>.md"}.`;
    try {
      const answer = await askTeammate(lead, system, `Teammates:\n${roster}\n\nThe owner wants a workflow that does this:\n${about}`, { maxTokens: 1200 });
      const cleaned = answer.text.replace(/```(?:json)?/gi, '');
      const plan = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
      const byName = new Map(store.agents.map((a) => [a.name.toLowerCase(), a.id]));
      const steps = (Array.isArray(plan.steps) ? plan.steps : []).slice(0, 8).map((s: any) =>
        typeof s?.save === 'string'
          ? { label: String(s.label || 'Save to Files').slice(0, 60), save: s.save.replace(/[^\w./ -]/g, '').slice(0, 120) || 'workflows/result.md' }
          : { label: String(s?.label || '').slice(0, 60), agentId: byName.get(String(s?.who || '').trim().toLowerCase()) || lead.id, prompt: String(s?.prompt || '').slice(0, 1500) }
      ).filter((s: any) => s.label);
      if (!steps.length) throw new Error('empty');
      res.json({ name: String(plan.name || '').slice(0, 80), description: [answer.notice, String(plan.description || '').slice(0, 300)].filter(Boolean).join(' '), steps });
    } catch (err: any) {
      res.status(502).json({ error: err?.message && err.message !== 'empty' && !/JSON|position/i.test(err.message) ? err.message : 'The draft came back in a form the app could not read. Try again, or start from a template.' });
    }
  });

  // 6. Create or update a DAG Pipeline
  app.post('/api/pipelines', (req, res) => {
    const payload = req.body as DAGPipeline;
    if (!payload.name || !Array.isArray(payload.nodes)) {
      res.status(400).json({ error: 'Pipeline name and nodes are required.' });
      return;
    }

    const idx = store.pipelines.findIndex((p) => p.id === payload.id);
    if (idx >= 0) {
      store.pipelines[idx] = {
        ...store.pipelines[idx],
        ...payload,
      };
      saveStore(store);
      res.json({ pipeline: store.pipelines[idx] });
      return;
    }

    const created: DAGPipeline = {
      ...payload,
      id: payload.id || `pipe-${Date.now()}`,
      edges: payload.edges || [],
      lastStatus: 'idle',
    };
    store.pipelines.unshift(created);
    saveStore(store);
    res.json({ pipeline: created });
  });

  // 7. Execute a DAG Pipeline topologically
  app.delete('/api/pipelines/:id', (req, res) => {
    if (!store.pipelines.some((p) => p.id === req.params.id)) {
      res.status(404).json({ error: 'Workflow not found.' });
      return;
    }
    store.pipelines = store.pipelines.filter((p) => p.id !== req.params.id);
    saveStore(store);
    res.json({ ok: true });
  });

  app.post('/api/pipelines/:id/execute', async (req, res) => {
    try {
      const { id } = req.params;
      const { customInput } = req.body as { customInput?: string };
      const pipeline = store.pipelines.find((p) => p.id === id);
      if (!pipeline) {
        res.status(404).json({ error: 'Pipeline not found.' });
        return;
      }

      pipeline.lastStatus = 'running';
      logActivity('work', `Workflow "${pipeline.name}" started.`);
      const nodeOutputs = new Map<string, string>();

      // Group nodes into topological levels so independent nodes at the same level run in parallel
      const inDegree = new Map<string, number>();
      const parentsMap = new Map<string, string[]>();

      for (const node of pipeline.nodes) {
        inDegree.set(node.id, 0);
        parentsMap.set(node.id, []);
        node.status = 'idle';
        node.error = undefined;
      }

      for (const edge of pipeline.edges) {
        if (inDegree.has(edge.target) && inDegree.has(edge.source)) {
          inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
          parentsMap.get(edge.target)?.push(edge.source);
        }
      }

      const remaining = new Set(pipeline.nodes.map((n) => n.id));

      while (remaining.size > 0) {
        const readyIds = Array.from(remaining).filter(
          (nodeId) => (inDegree.get(nodeId) || 0) <= 0
        );

        // Fallback if cycle exists: pick first remaining node
        const batchIds =
          readyIds.length > 0 ? readyIds : [Array.from(remaining)[0]];

        // Execute current topological wave in parallel
        await Promise.all(
          batchIds.map(async (nodeId) => {
            const node = pipeline.nodes.find((n) => n.id === nodeId)!;
            node.status = 'running';
            const parentIds = parentsMap.get(node.id) || [];
            const upstreamContext = [
              customInput ? `Pipeline Trigger Input: ${customInput}` : '',
              ...parentIds.map((pid) => {
                const parentNode = pipeline.nodes.find((n) => n.id === pid);
                return `Output from [${parentNode?.label || pid}]:\n${nodeOutputs.get(pid) || ''}`;
              }),
            ]
              .filter(Boolean)
              .join('\n\n');

            const startMs = Date.now();

            try {
              if (node.type === 'github_fetch') {
                const repoTarget =
                  node.repoTarget || 'modelcontextprotocol/servers';
                try {
                  const { summary, filesImported } =
                    await fetchGitHubRepoSummary(repoTarget);
                  for (const f of filesImported) {
                    const existingIdx = store.files.findIndex(
                      (ef) => ef.path === f.path
                    );
                    if (existingIdx >= 0) {
                      store.files[existingIdx] = f;
                    } else {
                      store.files.unshift(f);
                    }
                  }
                  node.lastOutput = summary;
                } catch (ghErr: any) {
                  node.lastOutput = `GitHub repository snapshot (${repoTarget}):\n${ghErr?.message || 'Using cached workspace index.'}`;
                }
                node.latencyMs = Math.max(80, Date.now() - startMs);
                node.tokens = 0;
                node.status = 'completed';
                nodeOutputs.set(node.id, node.lastOutput);
              } else if (node.type === 'api_webhook') {
                const status = await sendApprovedWebhook(node.webhookUrl, {
                  'Content-Type': 'application/json',
                  'X-NexusFlow-Pipeline': pipeline.id,
                }, JSON.stringify({
                  pipeline: pipeline.name,
                  node: node.label,
                  timestamp: new Date().toISOString(),
                  upstreamPreview: upstreamContext.slice(0, 600),
                }));
                node.lastOutput = `Webhook delivered (HTTP ${status}).`;
                node.latencyMs = Math.max(60, Date.now() - startMs);
                node.tokens = 0;
                node.status = 'completed';
                nodeOutputs.set(node.id, node.lastOutput);
              } else if (node.type === 'artifact_save') {
                const targetPath =
                  node.outputPath ||
                  `/artifacts/${pipeline.id}-${Date.now().toString().slice(-4)}.md`;
                const fileName =
                  targetPath.split('/').filter(Boolean).pop() ||
                  'pipeline-artifact.md';
                const compiledBody = `# Pipeline Deliverable: ${pipeline.name}\n\n- **Generated At**: ${new Date().toISOString()}\n- **Pipeline ID**: \`${pipeline.id}\`\n\n---\n\n${upstreamContext || 'No upstream node outputs provided.'}`;

                const artifactFile: HostedFile = {
                  id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                  path: targetPath.startsWith('/')
                    ? targetPath
                    : `/${targetPath}`,
                  name: fileName,
                  category: 'pipeline_artifact',
                  language: fileName.endsWith('.json') ? 'json' : 'markdown',
                  sizeBytes: Buffer.byteLength(compiledBody, 'utf-8'),
                  content: compiledBody,
                  authorAgentName: `Pipeline: ${pipeline.name}`,
                  githubRef: `dag/${pipeline.id}`,
                  updatedAt: new Date().toISOString(),
                };

                const existingFileIdx = store.files.findIndex(
                  (f) => f.path === artifactFile.path
                );
                if (existingFileIdx >= 0) {
                  store.files[existingFileIdx] = artifactFile;
                } else {
                  store.files.unshift(artifactFile);
                }

                node.lastOutput = `Saved ${artifactFile.sizeBytes} bytes to ${artifactFile.path}`;
                node.latencyMs = Math.max(25, Date.now() - startMs);
                node.tokens = 0;
                node.status = 'completed';
                nodeOutputs.set(node.id, node.lastOutput);
              } else {
                // Default: 'agent' node
                const agent =
                  store.agents.find((a) => a.id === node.agentId) ||
                  store.agents[0];
                const promptToRun =
                  node.prompt ||
                  `Execute step "${node.label}" for pipeline "${pipeline.name}".`;

                const { text, latencyMs, tokens } = await runSingleAgent(
                  agent,
                  promptToRun,
                  upstreamContext
                );

                node.lastOutput = text;
                node.latencyMs = latencyMs;
                node.tokens = tokens;
                node.status = 'completed';
                nodeOutputs.set(node.id, text);

                agent.avgLatencyMs =
                  agent.avgLatencyMs === 0
                    ? latencyMs
                    : Math.round((agent.avgLatencyMs + latencyMs) / 2);

                store.usageLogs.unshift({
                  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  timestamp: new Date().toISOString(),
                  agentId: agent.id,
                  agentName: agent.name,
                  operation: 'DAG Step',
                  tokens,
                  latencyMs,
                  status: 'success',
                });
              }
            } catch (nodeErr: any) {
              const errMsg =
                nodeErr instanceof Error
                  ? nodeErr.message
                  : 'Node execution failed';
              node.status = 'error';
              node.error = errMsg;
              node.lastOutput = `Error: ${errMsg}`;
              nodeOutputs.set(node.id, node.lastOutput);
            }
          })
        );

        // Remove batchIds and decrement downstream inDegrees
        for (const completedId of batchIds) {
          remaining.delete(completedId);
          for (const edge of pipeline.edges) {
            if (edge.source === completedId && remaining.has(edge.target)) {
              inDegree.set(edge.target, (inDegree.get(edge.target) || 1) - 1);
            }
          }
        }
      }

      const hasError = pipeline.nodes.some((n) => n.status === 'error');
      pipeline.lastStatus = hasError ? 'error' : 'completed';
      const failed = pipeline.nodes.filter((n) => n.status === 'error');
      logActivity(hasError ? 'error' : 'done', hasError ? `Workflow "${pipeline.name}" finished with ${failed.length} failed step(s): ${failed.map((n) => n.label).join(', ')}.` : `Workflow "${pipeline.name}" finished.`);
      pipeline.lastRunAt = new Date().toISOString();
      saveStore(store);

      res.json({
        pipeline,
        agents: store.agents,
        files: store.files,
      });
    } catch (err: any) {
      res.status(500).json({
        error: err?.message || 'Failed to execute DAG pipeline.',
      });
    }
  });

  // 8. Create or update a Hosted File in the File Vault
  app.post('/api/files', (req, res) => {
    const { id, path: rawPath, name, content, category, language, githubRef } =
      req.body as Partial<HostedFile>;

    if (!content && content !== '') {
      res.status(400).json({ error: 'File content is required.' });
      return;
    }

    const cleanName =
      name ||
      rawPath?.split('/').filter(Boolean).pop() ||
      `artifact-${Date.now()}.md`;
    const cleanPath = rawPath
      ? rawPath.startsWith('/')
        ? rawPath
        : `/${rawPath}`
      : `/workspace/${cleanName}`;

    const ext = cleanName.split('.').pop()?.toLowerCase() || 'md';
    const inferredLang =
      language ||
      (ext === 'json'
        ? 'json'
        : ext === 'ts' || ext === 'tsx'
          ? 'typescript'
          : ext === 'py'
            ? 'python'
            : 'markdown');

    const existingIdx = store.files.findIndex(
      (f) => f.id === id || f.path === cleanPath
    );

    if (existingIdx >= 0) {
      store.files[existingIdx] = {
        ...store.files[existingIdx],
        name: cleanName,
        path: cleanPath,
        content,
        language: inferredLang,
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
        updatedAt: new Date().toISOString(),
        ...(githubRef ? { githubRef } : {}),
      };
      saveStore(store);
      res.json({ file: store.files[existingIdx] });
      return;
    }

    const newFile: HostedFile = {
      id: `file-${Date.now()}`,
      path: cleanPath,
      name: cleanName,
      category: category || 'user_upload',
      language: inferredLang,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      content,
      authorAgentName: 'Workspace User',
      githubRef: githubRef || 'local/workspace',
      updatedAt: new Date().toISOString(),
    };

    store.files.unshift(newFile);
    saveStore(store);
    res.json({ file: newFile });
  });

  // 9. Delete a Hosted File
  app.delete('/api/files/:id', (req, res) => {
    const { id } = req.params;
    store.files = store.files.filter((f) => f.id !== id);
    saveStore(store);
    res.json({ ok: true });
  });

  // 10. Sync a public GitHub repository into the Hosted File Vault
  app.post('/api/github/sync', async (req, res) => {
    try {
      const { repo } = req.body as { repo: string };
      if (!repo || !repo.trim()) {
        res
          .status(400)
          .json({ error: 'Please provide a GitHub repository (owner/repo).' });
        return;
      }

      const { summary, filesImported } = await fetchGitHubRepoSummary(repo);

      for (const file of filesImported) {
        const idx = store.files.findIndex((f) => f.path === file.path);
        if (idx >= 0) {
          store.files[idx] = file;
        } else {
          store.files.unshift(file);
        }
      }

      saveStore(store);
      res.json({
        summary,
        importedCount: filesImported.length,
        files: store.files,
      });
    } catch (err: any) {
      res.status(400).json({
        error: err?.message || 'Failed to sync from GitHub.',
      });
    }
  });

  if (dev) {
    // Loaded only here, so the packed hub (for phones and tablets) doesn't need Vite.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { host, middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api/')) {
        return next();
      }
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    serveDashboard(app, __dirname);
  }

  const httpServer = app.listen(PORT, host, () => {
    startProviderStatusRefresh();
    console.log(`NexusFlow AI Server running on http://localhost:${PORT}`);
  });
  // If the port is already taken, another copy of the hub is almost certainly running. This copy can never
  // serve anything, so say so plainly and stop (code 64 tells the supervisor not to keep restarting it).
  httpServer.once('close', () => void closePreviews());
  httpServer.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      const msg = `The hub could not start because port ${PORT} is already in use, most likely by another copy of the hub that is still running. Close the other Eden window (or restart the PC) and start the hub again.`;
      console.error(msg);
      try {
        logActivity('error', msg);
      } catch {}
      setTimeout(() => process.exit(64), 500);
      return;
    }
    stray('Server error', err);
  });
}

startServer().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
