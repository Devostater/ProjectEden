export interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  model: string; // any id from /api/models (Claude, Gemini, OpenAI)
  systemInstruction: string;
  color: string;
  connectedTools: string[];
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
  createdAt: string;
  updatedAt: string;
}

export interface CardNote {
  id: string;
  author: string;
  text: string;
  at: string;
  kind?: 'note' | 'result' | 'error'; // 'result' is a teammate's finished work
  via?: string; // set when another AI answered for the teammate
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
  runState?: 'running' | 'waiting' | 'failed'; // set by the card runner
  runMessage?: string;
  runStartedAt?: string;
  createdAt: string;
  updatedAt: string;
}
