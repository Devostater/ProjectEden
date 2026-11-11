import React, { useState } from 'react';
import type { DAGPipeline, DAGNode, Agent } from '../types/index.ts';
import {
  GitBranch,
  Play,
  Plus,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  GitPullRequest,
  Cpu,
  FileCode,
  Layers,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

interface PipelineDAGViewProps {
  pipelines: DAGPipeline[];
  agents: Agent[];
  onSavePipeline: (pipe: DAGPipeline) => Promise<void>;
  onRefreshData?: () => void;
}

export const PipelineDAGView: React.FC<PipelineDAGViewProps> = ({
  pipelines,
  agents,
  onSavePipeline,
  onRefreshData,
}) => {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(
    pipelines[0]?.id || ''
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [customRunInput, setCustomRunInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionOutputs, setExecutionOutputs] = useState<Record<string, string>>({});
  const [runError, setRunError] = useState('');

  const activePipeline =
    pipelines.find((p) => p.id === selectedPipelineId) || pipelines[0];

  const selectedNode =
    activePipeline?.nodes.find((n) => n.id === selectedNodeId) ||
    activePipeline?.nodes[0] ||
    null;

  const handleRunPipeline = async () => {
    if (!activePipeline || isExecuting) return;
    setIsExecuting(true);
    setRunError('');
    setExecutionOutputs({});

    try {
      const res = await fetch(`/api/pipelines/${encodeURIComponent(activePipeline.id)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInput: customRunInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `The workflow could not be run (error ${res.status}).`);
      }

      // Each step's result, keyed by step id, for the panel on the right.
      const steps: { id: string; label: string; status: string; lastOutput?: string; error?: string }[] = data.pipeline?.nodes || [];
      setExecutionOutputs(Object.fromEntries(steps.map((n) => [n.id, n.lastOutput || ''])));
      const failed = steps.filter((n) => n.status === 'error');
      if (failed.length) {
        setRunError(`${failed.length} step${failed.length === 1 ? '' : 's'} failed: ${failed.map((n) => `${n.label} (${n.error || 'unknown error'})`).join('; ')}`);
      }
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      console.error('Workflow error:', err);
      setRunError(err.message);
    } finally {
      setIsExecuting(false);
    }
  };

  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'github_fetch':
        return <GitPullRequest className="w-4 h-4 text-amber-500" />;
      case 'api_webhook':
        return <Cpu className="w-4 h-4 text-purple-500" />;
      case 'artifact_save':
        return <FileCode className="w-4 h-4 text-emerald-500" />;
      default:
        return <Layers className="w-4 h-4 text-indigo-500" />;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Workflows
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Chains of steps your team runs in order. Each step hands its result to the next.
          </p>
        </div>

        {/* Pipeline Selector */}
        <div className="flex items-center gap-3">
          <select
            value={selectedPipelineId}
            onChange={(e) => {
              setSelectedPipelineId(e.target.value);
              setSelectedNodeId(null);
            }}
            className="px-3 py-2 text-xs rounded-lg border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-medium focus:outline-none"
          >
            {pipelines.map((pipe) => (
              <option key={pipe.id} value={pipe.id}>
                {pipe.name}
              </option>
            ))}
          </select>

          <button
            onClick={handleRunPipeline}
            disabled={isExecuting || !activePipeline}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {isExecuting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Running…</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run workflow</span>
              </>
            )}
          </button>
        </div>
      </div>

      {activePipeline && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {runError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300 lg:col-span-3">
              {runError}
            </p>
          )}
          {/* Main Visual Pipeline Canvas & Step Sequence */}
          <div className="lg:col-span-2 space-y-4">
            <div className="p-4 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                <div>
                  <h3 className="font-semibold text-sm text-slate-900 dark:text-white">
                    {activePipeline.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {activePipeline.description}
                  </p>
                </div>
                <div className="text-xs font-mono text-slate-400">
                  {activePipeline.nodes.length} steps
                </div>
              </div>

              {/* Optional Custom Input Trigger */}
              <div className="mb-4">
                <label className="block text-2xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                  What is this run about?
                </label>
                <input
                  type="text"
                  value={customRunInput}
                  onChange={(e) => setCustomRunInput(e.target.value)}
                  placeholder="e.g. A cozy farming game for phones"
                  className="w-full px-3 py-2 text-xs rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              {/* Node Sequence List & Step Connections */}
              <div className="space-y-3">
                {activePipeline.nodes.map((node, index) => {
                  const isSelected = selectedNode?.id === node.id;
                  const agentAssigned = agents.find((a) => a.id === node.agentId);
                  const nodeOutput = executionOutputs[node.id] || node.lastOutput;

                  return (
                    <div key={node.id}>
                      <div
                        onClick={() => setSelectedNodeId(node.id)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20 shadow-xs'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center">
                              {getNodeIcon(node.type)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-xs text-slate-900 dark:text-white">
                                  {node.label}
                                </span>
                                <span className="text-2xs font-mono text-slate-400">
                                  · Step {index + 1}
                                </span>
                              </div>
                              <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate max-w-md">
                                {agentAssigned ? agentAssigned.name : node.type === 'artifact_save' ? 'Saves to Files' : node.type}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 text-xs font-mono">
                            {node.latencyMs && (
                              <span className="text-slate-400 tabular-nums">
                                {node.latencyMs}ms
                              </span>
                            )}
                            {node.status === 'completed' && (
                              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Done</span>
                              </span>
                            )}
                            {node.status === 'running' && (
                              <span className="text-amber-500 flex items-center gap-1 font-medium animate-pulse">
                                <Clock className="w-3.5 h-3.5" />
                                <span>Running</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Snippet preview */}
                        {nodeOutput && (
                          <div className="mt-3 text-2xs text-slate-600 dark:text-slate-300 font-mono bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-100 dark:border-slate-800 line-clamp-2">
                            {nodeOutput}
                          </div>
                        )}
                      </div>

                      {/* Edge connector line */}
                      {index < activePipeline.nodes.length - 1 && (
                        <div className="flex justify-center py-1.5">
                          <div className="w-0.5 h-4 bg-slate-300 dark:bg-slate-700" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Node Inspector & Output Viewer Panel */}
          <div className="rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-5 space-y-4 flex flex-col justify-between">
            {selectedNode ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    {getNodeIcon(selectedNode.type)}
                    <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                      {selectedNode.label}
                    </h4>
                  </div>
                  <span className="text-2xs font-mono text-slate-400 capitalize">
                    {selectedNode.type.replace('_', ' ')}
                  </span>
                </div>

                {selectedNode.agentId && (
                  <div>
                    <label className="block text-2xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Who does it
                    </label>
                    <div className="text-xs font-medium text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      {agents.find((a) => a.id === selectedNode.agentId)?.name || selectedNode.agentId}
                    </div>
                  </div>
                )}

                {selectedNode.repoTarget && (
                  <div>
                    <label className="block text-2xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Target GitHub Repository
                    </label>
                    <div className="text-xs font-mono text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      {selectedNode.repoTarget}
                    </div>
                  </div>
                )}

                {selectedNode.outputPath && (
                  <div>
                    <label className="block text-2xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Vault Destination Artifact
                    </label>
                    <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      {selectedNode.outputPath}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-2xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Instructions
                  </label>
                  <p className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 leading-relaxed font-mono">
                    {selectedNode.prompt || 'Default automated execution step.'}
                  </p>
                </div>

                <div>
                  <label className="block text-2xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Result
                  </label>
                  <div className="p-3 rounded-lg bg-slate-950 text-slate-200 font-mono text-2xs overflow-y-auto max-h-64 leading-relaxed whitespace-pre-wrap">
                    {executionOutputs[selectedNode.id] ||
                      selectedNode.lastOutput ||
                      'Run the workflow to see this step’s result.'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs">
                Select a stage node to inspect its execution state and generated code.
              </div>
            )}

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-2xs text-slate-400 flex items-center justify-between">
              <span>Results are saved to Files</span>
              <span>Steps run in order</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
