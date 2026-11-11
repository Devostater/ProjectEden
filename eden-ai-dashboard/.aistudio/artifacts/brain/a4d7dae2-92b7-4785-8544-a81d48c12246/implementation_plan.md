# NexusFlow — Multi-Agent Command Center, DAG Orchestrator & Artifact Vault

NexusFlow is a unified desktop-class web application for managing, monitoring, and coordinating a fleet of specialized AI agents. It combines real-time agent usage analytics, dual-mode orchestration (parallel multi-agent swarm chat + visual DAG workflow pipelines), external tool and GitHub repository connectors, and an integrated file/artifact hosting repository in a cohesive developer console.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Choices from Phase 1 Clarifications**:
> - **Agent Fleet & Integrations**: Powered by server-side Gemini models (`gemini-3.8-flash` and `gemini-3.1-flash-lite`) with configurable agent personas, system prompts, and custom REST/webhook & GitHub API integration endpoints. *(Note: To protect credentials in accordance with platform security standards, secret API keys are injected via the server environment / Secrets panel rather than browser text inputs, while custom webhook URLs, headers, and tool schemas are configurable directly in the UI).*
> - **Dual-Mode Orchestration**: Seamless switching between **Swarm Command Mode** (broadcast prompts to multiple agents in parallel or let a coordinator synthesize their responses) and **Visual DAG Pipeline Builder** (chain agents, GitHub actions, and API hooks where upstream outputs feed downstream inputs).
> - **Unified File & GitHub Hosting (1 + 2)**: Combines an **Integrated Code & Asset Browser with GitHub Sync/Export** and a **Pipeline Artifact Repository** that automatically captures, versions, and hosts every code file, markdown report, JSON payload, and execution log produced by agent runs.

---

## 1. Overview & Core Concept

- **What It Does**: Provides a single command center where developers and AI engineers can inspect token consumption and latency across all configured agents, broadcast parallel instructions or voice-transcribed commands to an agent swarm, design multi-stage automated pipelines, and browse/export hosted files and pipeline artifacts directly to GitHub.
- **Target Audience / Persona**: AI engineers, full-stack developers, and technical leads orchestrating multi-agent workflows across repositories and external APIs.
- **Key Value**: Eliminates context-switching between isolated chat tabs, CI/CD logs, and file hosts by uniting agent execution, DAG pipelines, GitHub file tree inspection, and artifact hosting in one workspace.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Fleet Overview & Usage Telemetry**: Inspect active agents (e.g., *Architect Agent*, *Security Auditor*, *GitHub PR Bot*, *API Integrator*, *Data Synthesizer*), compare token throughput, request counts, error rates, and cost breakdowns, and create or tune agent configurations.
2. **Swarm Command & Parallel Execution**: Select 2–5 agents simultaneously, enter a text or voice command, and watch each agent stream or resolve its output in parallel side-by-side panes—followed by an optional automated **Coordinator Synthesis** that merges their findings into a single actionable file.
3. **Visual DAG Pipeline Execution**: Build or load a multi-stage workflow (e.g., `GitHub Repo Fetch` $\rightarrow$ `[Parallel: Code Review Agent + Security Audit Agent]` $\rightarrow$ `Patch Generator Agent` $\rightarrow$ `Artifact Host & GitHub Commit`). Click **Run Pipeline** to execute each stage via the backend Gemini proxy and inspect live node inputs/outputs.
4. **File Hosting & Pipeline Artifact Vault**: Browse a hierarchical workspace of hosted project files alongside auto-captured pipeline outputs. Preview syntax-highlighted code or structured JSON, compare diffs, upload new context files, download bundles, or sync/push directly to a connected GitHub repository.

### Visual Identity & Theme
- **Aesthetic Direction**: High-precision developer console and enterprise SaaS workspace following strict single-elevation depth and anti-slop discipline.
- **Color Palette & Mood (60-30-10 Distribution)**:
  - **60% Dominant Neutral Canvas**: Deep slate canvas (`#0B0F17` / `bg-slate-950`) in dark mode and crisp alabaster (`#F8FAFC` / `bg-slate-50`) in light mode.
  - **30% Structural Surfaces**: Flat elevated panels (`#111827` / `bg-slate-900` dark, `#FFFFFF` light) bounded by `1px solid` hairline dividers (`border-slate-800` / `border-slate-200`).
  - **10% Accent Budget**: Electric Indigo (`#6366F1` / `indigo-500`) for primary execution actions and active stage nodes, paired with semantic state indicators paired with explicit text labels: Emerald (`#16A34A` Nominal/Completed), Amber (`#D97706` Running/Warning), and Crimson (`#DC2626` Failed/Alert).
- **Typography & Hierarchy (2+1 Font Rule)**:
  - **Display & Navigation**: `Outfit` (SemiBold 600) for workspace headers, section titles, and brand wordmark.
  - **Body & UI Controls**: `Plus Jakarta Sans` (Regular 400 / Medium 500) for high-density legibility at 13px–15px.
  - **Data, Telemetry & Code**: `JetBrains Mono` with `font-variant-numeric: tabular-nums` for token counts, latency metrics, timestamps, SHA hashes, and file previews.
- **Component Styling & Layout**:
  - **Top Bar Contract**: Strict 3-zone header separated by `gap-8`: single-line brand wordmark (`NexusFlow`) on the left, 4 concise single-line navigation links (`Fleet & Usage`, `Swarm Studio`, `DAG Pipelines`, `Files & GitHub`) in the center, and 1 primary CTA button (`New Agent Run`) on the right.
  - **Zero-Pill Metadata**: All agent model identifiers, token rates, and timestamps render as clean unboxed inline text separated by `·` or `/`.

### Interactive Feedback & Motion
- **Routine Feedback ($\le 200\text{ms}$)**: Compositor-only transitions (`opacity`, `transform`) on drawer panels, node selection, and tab switches.
- **State Completeness**: Every view includes populated states, skeleton loading rows during real Gemini API execution, live client-side filtering, and clear empty states with primary action triggers.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Side Express + `@google/genai` Proxy Execution**
  - *Chosen Approach*: All AI agent invocations, parallel swarm broadcasts, and DAG node executions run through an Express backend (`server.ts`) calling `@google/genai` (`gemini-3.8-flash` and `gemini-3.1-flash-lite`), alongside server-proxied GitHub REST API calls and custom webhook dispatchers.
  - *Why*: Protects environment credentials, avoids browser CORS issues when querying GitHub or external webhook endpoints, and enables genuine parallel multi-agent execution with accurate server-timed latency and token usage telemetry.
  - *Alternatives Considered*: Client-side mock timers were rejected to ensure every agent command and pipeline run produces real, intelligent outputs.
- **Decision 2: Unified In-Memory + Persistent JSON Workspace Store**
  - *Chosen Approach*: Maintain a structured server-side state store (persisted to a local workspace JSON file with automatic seed data) for agents, usage history, DAG pipelines, hosted files, and GitHub connection settings.
  - *Why*: Guarantees immediate zero-config startup while persisting new agents, custom pipelines, uploaded files, and generated artifacts across page reloads.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        TOP BAR (3-Zone Contract)                             │
│  [NexusFlow]        [Fleet & Usage · Swarm · Pipelines · Files]   [+ Run]    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       ▼                               ▼                               ▼
┌─────────────────────┐   ┌─────────────────────────┐   ┌──────────────────────┐
│  1. FLEET & USAGE   │   │  2. SWARM & DAG STUDIO  │   │  3. FILES & GITHUB   │
│  ─────────────────  │   │  ─────────────────────  │   │  ──────────────────  │
│ • KPI Stat Strip    │   │ • Mode Switcher:        │   │ • Virtual File Tree  │
│   (Tokens, Cost,    │   │   [Swarm Chat | DAG]    │   │   (/src, /artifacts, │
│    Latency, Runs)   │   │ • Swarm Broadcast Bar   │   │    /workflows, /logs)│
│ • Agent Roster Grid │   │   + Voice Mic Input     │   │ • Code/Markdown/JSON │
│   & Config Drawer   │   │ • Parallel Agent Lanes  │   │   Inspector & Editor │
│ • Usage Ledger      │   │   & Synthesis Merger    │   │ • GitHub Repo Sync   │
│   Table (tabular)   │   │ • Interactive DAG Node  │   │   (Fetch Tree, Diff, │
│ • Tool & Webhook    │   │   Canvas & Step Runner  │   │    Export Artifact)  │
│   Connector Modal   │   │ • Save Output to Vault  │   │ • File Upload &      │
└──────────┬──────────┘   └────────────┬────────────┘   │   Shareable Raw Link │
           │                           │                └──────────┬───────────┘
           └───────────────────────────┼───────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     EXPRESS BACKEND & GEMINI ORCHESTRATOR                    │
│  • POST /api/swarm/execute     → Parallel Promise.all() Gemini Agent Calls   │
│  • POST /api/pipeline/execute  → Topological DAG Stage Runner + Context Pass │
│  • GET/POST /api/agents        → Agent Persona, Model & Tool CRUD            │
│  • GET/POST /api/files         → Hosted Files & Pipeline Artifact Vault      │
│  • POST /api/github/sync       → Public/Token GitHub Repo Tree & File Fetch  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State
- **`AgentConfig`**: `id`, `name`, `role`, `model` (`gemini-3.8-flash` | `gemini-3.1-flash-lite`), `systemInstruction`, `connectedTools` (`github`, `webhook`, `code_exec`, `artifact_writer`), `webhookUrl`, `totalTokens`, `totalRuns`, `avgLatencyMs`, `status`.
- **`SwarmSession`**: `id`, `prompt`, `selectedAgentIds`, `responses` (array of `{ agentId, output, latencyMs, tokensUsed, status }`), `synthesisOutput`, `createdAt`.
- **`PipelineDAG`**: `id`, `name`, `description`, `nodes` (`id`, `label`, `type`: `agent` | `github_fetch` | `webhook` | `artifact_save`, `agentId`, `config`, `position`), `edges` (`from`, `to`), `lastRunStatus`.
- **`HostedFile`**: `id`, `path` (e.g., `/artifacts/security-audit-2026.md`, `/workflows/release-pipeline.json`, `/repo/README.md`), `name`, `category` (`repo_file` | `pipeline_artifact` | `user_upload`), `mimeType`, `sizeBytes`, `content`, `sourceAgentId`, `githubRef`, `updatedAt`.
- **`UsageLog`**: `id`, `timestamp`, `agentId`, `agentName`, `operation` (`Swarm Broadcast` | `DAG Node` | `Synthesis`), `tokens`, `latencyMs`, `status`.

### Interactive Component & State Mapping
- **Agent Configuration & Connector Drawer**: Clicking any agent opens an editor to modify its system instruction, model (`gemini-3.8-flash` vs `gemini-3.1-flash-lite`), attached GitHub repository target (`owner/repo`), or custom webhook endpoint, immediately persisting via `POST /api/agents`.
- **Parallel Swarm Execution & Voice Command**: Users toggle which agents participate in the swarm, type a prompt (or use Web Speech API / audio transcription), and trigger `POST /api/swarm/execute`. All selected agents execute concurrently on the server; the UI renders individual timing/token metrics and offers one-click **Synthesize Consensus** and **Save to Artifact Vault**.
- **Interactive DAG Pipeline Builder & Runner**: Users can select from pre-built production pipelines or add/connect nodes, inspect node prompts, and click **Execute Pipeline** (`POST /api/pipeline/execute`) to watch stages resolve sequentially and in parallel while automatically depositing generated artifacts into the File Vault.
- **File Hosting & GitHub Sync Browser**: Users filter by `All Files`, `Pipeline Artifacts`, or `GitHub Synced`, edit file contents inline, create new hosted files, pull live files from any public GitHub repository (`owner/repo`), and download or export artifacts.
