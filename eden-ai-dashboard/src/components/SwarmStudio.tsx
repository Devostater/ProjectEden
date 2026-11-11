import React, { useState, useEffect, useRef } from 'react';
import type { Agent, HostedFile, SwarmAgentResult } from '../types/index.ts';
import {
  Play,
  Mic,
  MicOff,
  Copy,
  Check,
  Sparkles,
  Save,
  Clock,
  Zap,
  Layers,
  FileCode,
  ShieldCheck,
  Terminal,
  Cpu,
  GitPullRequest,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

interface SwarmStudioProps {
  agents: Agent[];
  files: HostedFile[];
  preselectedAgentId?: string;
  onSaveToVault: (file: Partial<HostedFile>) => Promise<void>;
  onExecutionComplete?: () => void;
}

export const SwarmStudio: React.FC<SwarmStudioProps> = ({
  agents,
  files,
  preselectedAgentId,
  onSaveToVault,
  onExecutionComplete,
}) => {
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(
    agents.slice(0, 3).map((a) => a.id)
  );
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(
    'Pitch our next small game. Each of you covers your specialty, then agree on the top 3 actions for this week.'
  );

  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<SwarmAgentResult[]>([]);
  const [runStats, setRunStats] = useState<{ totalDurationMs: number; runId: string } | null>(null);

  // Synthesis state
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisOutput, setSynthesisOutput] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);

  // Speech Recognition
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (preselectedAgentId && !selectedAgentIds.includes(preselectedAgentId)) {
      setSelectedAgentIds((prev) => [...prev, preselectedAgentId]);
    }
  }, [preselectedAgentId]);

  useEffect(() => {
    // Check speech recognition support
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error('Failed to start speech recognition:', err);
      }
    }
  };

  const toggleAgent = (id: string) => {
    if (selectedAgentIds.includes(id)) {
      if (selectedAgentIds.length > 1) {
        setSelectedAgentIds(selectedAgentIds.filter((item) => item !== id));
      }
    } else {
      setSelectedAgentIds([...selectedAgentIds, id]);
    }
  };

  const toggleFile = (id: string) => {
    if (selectedFileIds.includes(id)) {
      setSelectedFileIds(selectedFileIds.filter((item) => item !== id));
    } else {
      setSelectedFileIds([...selectedFileIds, id]);
    }
  };

  const handleExecuteSwarm = async () => {
    if (!prompt.trim() || selectedAgentIds.length === 0 || isRunning) return;

    setIsRunning(true);
    setResults([]);
    setSynthesisOutput(null);
    setRunStats(null);
    setSavedStatus(null);

    try {
      const res = await fetch('/api/swarm/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          agentIds: selectedAgentIds,
          contextFileIds: selectedFileIds,
        }),
      });

      if (!res.ok) {
        throw new Error(`Execution error: ${res.statusText}`);
      }

      const data = await res.json();
      setResults(data.results || []);
      setRunStats({
        totalDurationMs: data.totalDurationMs || 0,
        runId: data.runId || '',
      });
      if (onExecutionComplete) onExecutionComplete();
    } catch (err: any) {
      console.error('Swarm run failed:', err);
      alert(`Swarm execution failed: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSynthesize = async () => {
    if (results.length === 0 || isSynthesizing) return;
    setIsSynthesizing(true);
    try {
      const res = await fetch('/api/swarm/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          results,
        }),
      });
      if (!res.ok) throw new Error('Synthesis failed');
      const data = await res.json();
      setSynthesisOutput(data.synthesis);
      if (onExecutionComplete) onExecutionComplete();
    } catch (err: any) {
      console.error('Synthesis error:', err);
      alert(`Synthesis failed: ${err.message}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const saveResultToVault = async (title: string, content: string, agentName?: string) => {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);
    const fileName = `${slug}-${Date.now().toString().slice(-4)}.md`;
    await onSaveToVault({
      path: `/artifacts/${fileName}`,
      name: fileName,
      category: 'pipeline_artifact',
      language: 'markdown',
      content,
      authorAgentName: agentName || 'Swarm Synthesis',
    });
    setSavedStatus(`Saved to /artifacts/${fileName}`);
    setTimeout(() => setSavedStatus(null), 4000);
  };

  const samplePrompts = [
    {
      label: 'Pitch the next game',
      text: 'Pitch our next small game. Scout: what is selling and where the gap is. Quill: core loop and hook. Pixel: art style we can afford. Forge: how long to build. Rex: price. Atlas: go or no-go.',
    },
    {
      label: 'Plan a launch',
      text: 'We are launching a product in 4 weeks. Each of you: list what must be done in your area before launch day, in order, and what you need from the others.',
    },
    {
      label: 'Fix weak sales',
      text: 'A released product is selling below expectations. Diagnose likely causes in your area (store page, price, quality, visibility, reviews) and propose the cheapest fix to test first.',
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Title & Description */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Swarm Command Studio
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Coordinate commands across multiple AI agents simultaneously. Broadcast parallel instructions, speak commands via voice, and synthesize unified consensus.
        </p>
      </div>

      {/* Swarm Setup Panel */}
      <div className="rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-5 space-y-5">
        {/* Step 1: Select Active Swarm Agents */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              1. Select Participating Agents ({selectedAgentIds.length} active)
            </label>
            <span className="text-xs text-slate-400">Agents execute concurrently in parallel</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {agents.map((agent) => {
              const isSelected = selectedAgentIds.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => toggleAgent(agent.id)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30 text-slate-900 dark:text-white shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-600 dark:text-slate-400 opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: agent.color }}
                    />
                    <span className="text-2xs font-mono text-slate-400">{agent.model.replace('gemini-', '')}</span>
                  </div>
                  <div className="font-semibold text-xs mt-2 truncate">{agent.name}</div>
                  <div className="text-2xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{agent.role}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Context Files Attachment */}
        {files.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                2. Attach Context Files from Workspace / GitHub ({selectedFileIds.length} attached)
              </label>
              <span className="text-xs text-slate-400">Files injected directly into agent context</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {files.map((file) => {
                const isAttached = selectedFileIds.includes(file.id);
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => toggleFile(file.id)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-mono flex items-center gap-1.5 border transition-colors ${
                      isAttached
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[200px]">{file.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Command Bar & Speech Mic */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              3. Parallel Command & Voice Input
            </label>
            {speechSupported && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <span>Microphone enabled</span>
              </span>
            )}
          </div>

          <div className="relative">
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter instructions to broadcast simultaneously across all selected agents..."
              className="w-full px-4 py-3 text-xs rounded-xl border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 pr-24"
            />

            {/* Quick Action Buttons inside bar */}
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  title={isListening ? 'Stop voice recording' : 'Speak command with voice'}
                  className={`p-2 rounded-lg border transition-all ${
                    isListening
                      ? 'bg-red-500 border-red-600 text-white animate-pulse'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600'
                  }`}
                >
                  {isListening ? <Mic className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}

              <button
                type="button"
                disabled={isRunning || !prompt.trim()}
                onClick={handleExecuteSwarm}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                {isRunning ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Executing Swarm...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Run Parallel Swarm</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Prompt Templates */}
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-400">Presets:</span>
            {samplePrompts.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setPrompt(p.text)}
                className="hover:text-indigo-600 dark:hover:text-indigo-400 underline decoration-slate-300 dark:decoration-slate-700 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Execution Feedback Notification */}
      {savedStatus && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>{savedStatus}</span>
        </div>
      )}

      {/* Swarm Results Grid */}
      {results.length > 0 && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Parallel Execution Outputs ({results.length} agents)
              </h2>
              {runStats && (
                <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mt-0.5">
                  <span>Completed in {runStats.totalDurationMs}ms</span>
                  <span>·</span>
                  <span>Run ID: {runStats.runId}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSynthesize}
                disabled={isSynthesizing}
                className="px-4 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 rounded-lg transition-colors flex items-center gap-1.5"
              >
                {isSynthesizing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    <span>Synthesizing Consensus...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Synthesize Consensus</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Master Coordinator Synthesis Output (if run) */}
          {synthesisOutput && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200">
                  <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="font-bold text-sm">Nexus Master Coordinator · Swarm Consensus</span>
                </div>
                <button
                  onClick={() =>
                    saveResultToVault('swarm-consensus', synthesisOutput, 'Master Coordinator')
                  }
                  className="px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 rounded-md transition-colors flex items-center gap-1 border border-indigo-200 dark:border-indigo-800"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save to Artifact Vault</span>
                </button>
              </div>

              <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-sans whitespace-pre-wrap bg-white/70 dark:bg-slate-900/70 p-4 rounded-lg border border-indigo-100 dark:border-indigo-900/60">
                {synthesisOutput}
              </div>
            </div>
          )}

          {/* Individual Parallel Agent Lanes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {results.map((res) => (
              <div
                key={res.agentId}
                className="rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col justify-between"
              >
                {/* Agent Card Header */}
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: res.color }}
                    />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {res.agentName}
                    </span>
                    <span className="text-2xs text-slate-400 font-mono">· {res.agentRole}</span>
                  </div>

                  <div className="flex items-center gap-3 text-2xs font-mono text-slate-400">
                    <span className="tabular-nums">{res.latencyMs}ms</span>
                    <span>·</span>
                    <span className="tabular-nums">{res.tokens} tok</span>
                    <button
                      onClick={() =>
                        saveResultToVault(`${res.agentName}-output`, res.content, res.agentName)
                      }
                      title="Save output to Artifact Vault"
                      className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Content Terminal Area */}
                <div className="p-4 overflow-y-auto max-h-96 text-xs text-slate-800 dark:text-slate-200 font-mono leading-relaxed whitespace-pre-wrap bg-slate-950/5 dark:bg-slate-950/30">
                  {res.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isRunning && results.length === 0 && (
        <div className="text-center py-12 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-8 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Ready to execute parallel agent swarm
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Choose your specialist agents above, attach relevant code files or GitHub repos, and click &quot;Run Parallel Swarm&quot; or use the mic to speak your prompt.
          </p>
        </div>
      )}
    </div>
  );
};
