export interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  model: string; // any id from /api/models (Claude, Gemini, OpenAI)
  localModel?: string; // AI on this PC used offline and in local-first mode; empty = picked by role
  systemInstruction: string;
  color: string;
  connectedTools: string[]; // abilities; 'web' = may search the web and read pages (Team page switch)
  webhookUrl?: string;
  githubRepo?: string;
  totalTokens: number;
  totalRuns: number;
  avgLatencyMs: number;
  status: 'idle' | 'running' | 'offline';
}

export interface SwarmAgentResult {
  agentId: string;
  agentName: string;
  agentRole: string;
  color: string;
  content: string;
  latencyMs: number;
  tokens: number;
  status: 'completed' | 'error';
  error?: string;
}

export interface SwarmRun {
  id: string;
  prompt: string;
  timestamp: string;
  agentIds: string[];
  results: SwarmAgentResult[];
  synthesis?: string;
  savedArtifactPath?: string;
}

export type DAGNodeType = 'agent' | 'github_fetch' | 'api_webhook' | 'artifact_save';

export interface DAGNode {
  id: string;
  label: string;
  type: DAGNodeType;
  agentId?: string;
  prompt?: string;
  repoTarget?: string; // e.g. "owner/repo" or "facebook/react"
  webhookUrl?: string;
  outputPath?: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  lastOutput?: string;
  latencyMs?: number;
  tokens?: number;
  error?: string;
  x: number;
  y: number;
}

export interface DAGEdge {
  id: string;
  source: string;
  target: string;
}

export interface DAGPipeline {
  id: string;
  name: string;
  description: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  lastRunAt?: string;
  lastStatus?: 'idle' | 'running' | 'completed' | 'error';
}

export interface HostedFile {
  id: string;
  path: string;
  name: string;
  category: 'pipeline_artifact' | 'github_repo' | 'user_upload' | 'agent_scratchpad';
  language: string;
  sizeBytes: number;
  content: string;
  authorAgentName?: string;
  githubRef?: string;
  updatedAt: string;
}

export interface UsageMetric {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  operation: 'Swarm Broadcast' | 'DAG Step' | 'Consensus Synthesis' | 'Tool Execution';
  tokens: number;
  latencyMs: number;
  status: 'success' | 'error';
}

export interface TelemetrySummary {
  totalTokens: number;
  totalRuns: number;
  avgLatencyMs: number;
  activeAgentsCount: number;
  estimatedCost: number; // calculated at standard rate
  recentLogs: UsageMetric[];
}

// ---- Projects and boards ----
export type CardColumn = 'todo' | 'ready' | 'doing' | 'review' | 'done';

// A workstream inside a project, e.g. "Build" or "Marketing". Its members are the teammates who
// pick up its unassigned Ready cards whenever they have nothing else to do.
export interface Branch {
  id: string;
  name: string;
  color: string;
  memberIds: string[];
}

export interface Project {
  id: string;
  name: string;
  goal: string;
  color: string;
  status: 'active' | 'paused' | 'done';
  repo?: string; // "owner/name" on GitHub
  autoRun?: boolean; // AI picks up assigned cards in Ready (on unless set to false)
  codebaseId?: string; // the code this project changes (see Code updates), e.g. "lyra"
  branches?: Branch[]; // workstreams; every project has at least "Main"
  roadmap?: RoadmapGoal[]; // long-term goals made of building blocks (not AI tasks); progress is worked out from them
  toolbox?: { tools: ProjectTool[]; links: ProjectLink[] }; // this project's own tools and links (its keys live in Security\Keys)
  // Which AI works this project's cards: the team's usual AIs (not set), or one of the project's own connections.
  // fallback: if the project's connection fails, use the team's AIs instead (off = the card waits, nothing leaves).
  ai?: { use: ProjectAiKind; fallback?: boolean };
  createdAt: string;
  updatedAt: string;
}

export type ProjectAiKind = 'azure-openai' | 'openai' | 'anthropic' | 'gemini';

// A script or command that belongs to one project; it runs in that project's folder with that project's keys.
export interface ProjectTool {
  id: string;
  name: string;
  command: string;
  description?: string;
  folder?: string; // inside the project folder, e.g. "eden-ai-dashboard"
}
export interface ProjectLink {
  id: string;
  title: string;
  url: string;
}

// A building block on the way to a goal: planned -> building -> done.
export type BlockState = 'planned' | 'building' | 'done';
export interface RoadmapBlock {
  id: string;
  title: string;
  state: BlockState;
  note?: string;
}
// A long-term goal of a project, e.g. "Store page" or "Website", made of building blocks.
export interface RoadmapGoal {
  id: string;
  title: string;
  icon: string; // an emoji
  blocks: RoadmapBlock[];
}

export interface CardNote {
  id: string;
  author: string;
  text: string;
  at: string;
  kind?: 'note' | 'result' | 'error' | 'feedback'; // 'result' is a teammate's finished work; 'feedback' is the owner sending it back
  via?: string; // set when another AI answered for the teammate
  web?: boolean; // the teammate looked things up on the web for this result
  revised?: boolean; // a result the owner sent back: a newer version replaces it
  revisedAt?: string;
}

// Where a card came from, so it can be traced back.
export interface CardSource {
  kind: 'nexus' | 'plan'; // a Nexus discussion's plan, or "Plan with Chief" on the board
  roomId?: string;
  roomName?: string;
  messageSeq?: number; // the plan message in that room
  label?: string; // what was asked, shortened
  runId?: string; // the cards made together in one go share this
  at: string;
}

export interface Card {
  id: string;
  projectId: string;
  title: string;
  details: string;
  column: CardColumn;
  assigneeId?: string; // a teammate's id
  branchId?: string; // the workstream it belongs to (Main if missing)
  source?: CardSource;
  priority: 'low' | 'normal' | 'high';
  order: number; // position within its column, lowest first
  notes: CardNote[];
  dependsOn?: string[]; // ids of cards that must be Done before the AI starts this one
  startAfter?: string; // queued: the AI won't start it before this time
  reviewAt?: string; // when it last entered Review
  doneAt?: string; // when it was finished
  deliverablePath?: string; // where its approved result was saved on this PC (Deliverables folder)
  runState?: 'running' | 'waiting' | 'failed'; // set by the card runner
  runMessage?: string;
  runStartedAt?: string;
  createdAt: string;
  updatedAt: string;
}
