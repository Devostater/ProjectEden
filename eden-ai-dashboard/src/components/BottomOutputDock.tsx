import React, { useState } from 'react';
import {
  Terminal,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Trash2,
  Zap,
  Activity,
  Layers,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import type { SwarmRun, UsageMetric } from '../types/index.ts';

interface BottomOutputDockProps {
  latestSwarmRun: SwarmRun | null;
  recentLogs: UsageMetric[];
  activePipelineOutput?: { name: string; output: string } | null;
  onOpenInVault?: (path: string) => void;
}

export const BottomOutputDock: React.FC<BottomOutputDockProps> = ({
  latestSwarmRun,
  recentLogs,
  activePipelineOutput,
  onOpenInVault,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeDockTab, setActiveDockTab] = useState<'swarm' | 'logs' | 'pipeline' | 'terminal'>('swarm');
  const [copied, setCopied] = useState(false);
  const [cleared, setCleared] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentContent = () => {
    if (cleared) return '// Output buffer cleared.';

    if (activeDockTab === 'swarm') {
      if (!latestSwarmRun) {
        return '// No swarm executions yet. Run a prompt in Swarm Studio to see live parallel output streamed here.';
      }
      let out = `// Session Run ID: ${latestSwarmRun.id}\n`;
      out += `// Prompt: "${latestSwarmRun.prompt}"\n`;
      out += `// Timestamp: ${new Date(latestSwarmRun.timestamp).toLocaleString()}\n`;
      out += `// Participating Agents: ${latestSwarmRun.agentIds.join(', ')}\n\n`;

      if (latestSwarmRun.synthesis) {
        out += `=======================================================\n`;
        out += `=== NEXUS COORDINATOR SYNTHESIS                     ===\n`;
        out += `=======================================================\n`;
        out += `${latestSwarmRun.synthesis}\n\n`;
      }

      latestSwarmRun.results.forEach((r, idx) => {
        out += `-------------------------------------------------------\n`;
        out += `[${idx + 1}] Agent: ${r.agentName} (${r.agentRole}) | ${r.latencyMs}ms | ${r.tokens} tokens\n`;
        out += `-------------------------------------------------------\n`;
        out += `${r.content}\n\n`;
      });
      return out;
    }

    if (activeDockTab === 'pipeline') {
      if (!activePipelineOutput) {
        return '// No active pipeline trace. Select a DAG workflow and click "Execute Pipeline" to view step traces.';
      }
      return `// Pipeline: ${activePipelineOutput.name}\n// Execution Timestamp: ${new Date().toLocaleTimeString()}\n\n${activePipelineOutput.output}`;
    }

    if (activeDockTab === 'logs') {
      if (recentLogs.length === 0) {
        return '// Telemetry buffer empty.';
      }
      return recentLogs
        .map(
          (l) =>
            `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.operation.padEnd(20)}] Agent: ${l.agentName.padEnd(18)} | Tokens: ${String(l.tokens).padStart(5)} | Latency: ${String(l.latencyMs).padStart(4)}ms | Status: ${l.status.toUpperCase()}`
        )
        .join('\n');
    }

    if (activeDockTab === 'terminal') {
      return `NexusFlow AI Core Runtime v2.4.0 [aistudio-build]
Active Provider Engine: Google GenAI (gemini-3.6-flash, gemini-3.5-flash-lite)
Orchestration Mode: Parallel Swarm & Topological DAG Execution
WebSocket & Webhook Event Bus: Nominal (0 errors)
Local Vault Storage: Ready (Indexed & Persisted)
Ready for dispatch. Type commands or trigger workflows above.`;
    }

    return '';
  };

  const outputText = currentContent();

  return (
    <div
      className={`fixed bottom-0 right-0 z-30 transition-all duration-200 border-t bg-slate-950 text-slate-200 border-slate-800 shadow-2xl flex flex-col ${
        isOpen ? (isExpanded ? 'h-96' : 'h-48 sm:h-56') : 'h-10'
      } left-0 md:left-64`}
    >
      {/* Dock Header & Controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/90 border-b border-slate-800 select-none text-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 font-semibold text-slate-200 hover:text-white transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            <span>Output Console</span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 ml-0.5" /> : <ChevronUp className="w-3.5 h-3.5 ml-0.5" />}
          </button>

          {isOpen && (
            <div className="flex items-center gap-1 ml-2 border-l border-slate-700/60 pl-3">
              <button
                onClick={() => {
                  setActiveDockTab('swarm');
                  setCleared(false);
                }}
                className={`px-2.5 py-1 rounded text-2xs font-mono transition-colors ${
                  activeDockTab === 'swarm'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                Swarm Stream
              </button>
              <button
                onClick={() => {
                  setActiveDockTab('pipeline');
                  setCleared(false);
                }}
                className={`px-2.5 py-1 rounded text-2xs font-mono transition-colors ${
                  activeDockTab === 'pipeline'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                Pipeline Trace
              </button>
              <button
                onClick={() => {
                  setActiveDockTab('logs');
                  setCleared(false);
                }}
                className={`px-2.5 py-1 rounded text-2xs font-mono transition-colors ${
                  activeDockTab === 'logs'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                Audit Logs ({recentLogs.length})
              </button>
              <button
                onClick={() => {
                  setActiveDockTab('terminal');
                  setCleared(false);
                }}
                className={`px-2.5 py-1 rounded text-2xs font-mono transition-colors ${
                  activeDockTab === 'terminal'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                System Terminal
              </button>
            </div>
          )}
        </div>

        {isOpen && (
          <div className="flex items-center gap-2 text-slate-400">
            {latestSwarmRun?.savedArtifactPath && (
              <button
                onClick={() => onOpenInVault && onOpenInVault(latestSwarmRun.savedArtifactPath!)}
                className="hidden sm:flex items-center gap-1 text-2xs text-indigo-400 hover:text-indigo-300 mr-2 font-mono"
              >
                <span>Open in Vault</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}

            <button
              onClick={() => handleCopy(outputText)}
              title="Copy output"
              className="p-1 hover:text-white rounded hover:bg-slate-800 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={() => setCleared(true)}
              title="Clear output"
              className="p-1 hover:text-white rounded hover:bg-slate-800 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Restore dock height' : 'Expand dock'}
              className="p-1 hover:text-white rounded hover:bg-slate-800 transition-colors"
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>

      {/* Dock Content Body */}
      {isOpen && (
        <div className="flex-1 p-3.5 overflow-y-auto font-mono text-xs leading-relaxed text-slate-300 whitespace-pre-wrap selection:bg-indigo-600 selection:text-white bg-slate-950">
          {outputText}
        </div>
      )}
    </div>
  );
};
