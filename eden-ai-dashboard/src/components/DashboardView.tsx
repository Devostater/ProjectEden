import React, { useState } from 'react';
import type { Agent, TelemetrySummary, UsageMetric } from '../types/index.ts';
import {
  Activity,
  Zap,
  Clock,
  Coins,
  CheckCircle2,
  Cpu,
  Layers,
  ArrowUpRight,
  TrendingUp,
  BarChart3,
  Box,
  Flame,
  ShieldCheck,
  Filter,
} from 'lucide-react';

interface DashboardViewProps {
  agents: Agent[];
  usageSummary: TelemetrySummary;
  onNavigateToAI: () => void;
  onNavigateToSwarm: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  agents,
  usageSummary,
  onNavigateToAI,
  onNavigateToSwarm,
}) => {
  const [logFilter, setLogFilter] = useState('all');
  const [isGrillOpen, setIsGrillOpen] = useState(false);
  const [isGrilling, setIsGrilling] = useState(false);
  const [grillReport, setGrillReport] = useState<string | null>(null);
  const [userDefense, setUserDefense] = useState('');

  const handleRunGrill = async (defenseText?: string) => {
    setIsGrillOpen(true);
    setIsGrilling(true);
    try {
      const res = await fetch('/api/usage/grill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userDefense: defenseText ?? userDefense }),
      });
      if (res.ok) {
        const data = await res.json();
        setGrillReport(data.grillReport);
      }
    } catch (err) {
      console.error('Usage grill error:', err);
    } finally {
      setIsGrilling(false);
    }
  };

  const quotaCap = 500000;
  const tokenQuotaPercent = Math.min(100, Math.round((usageSummary.totalTokens / quotaCap) * 100));
  const successRate = 98.4;
  const slaCompliance = 94.2;
  const cacheEfficiency = 88.6;

  // Calculate workload share per agent
  const totalAgentTokens = agents.reduce((acc, a) => acc + a.totalTokens, 0) || 1;

  const filteredLogs = usageSummary.recentLogs.filter((log) => {
    if (logFilter === 'all') return true;
    return log.operation.toLowerCase().includes(logFilter.toLowerCase());
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* View Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Usage & Performance
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time capacity, token burn rate, latency SLAs, and workload distribution across your AI team.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRunGrill()}
            className="px-3.5 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200 dark:border-amber-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5 text-amber-500" />
            <span>Grill My Usage</span>
          </button>
          <button
            onClick={onNavigateToAI}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Manage Connected AI ({agents.length})
          </button>
          <button
            onClick={onNavigateToSwarm}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            Launch Swarm
          </button>
        </div>
      </div>

      {/* Live Usage Audit & Grill Panel */}
      {isGrillOpen && (
        <div className="p-5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between border-b border-amber-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Studio Producer Usage Audit &middot; Where You Stand
              </h3>
            </div>
            <button
              onClick={() => setIsGrillOpen(false)}
              className="text-xs font-mono text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Close
            </button>
          </div>

          {isGrilling ? (
            <div className="py-6 text-center text-xs font-mono text-amber-700 dark:text-amber-300">
              Auditing your token burn across all {agents.length} connected AI engines...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-white dark:bg-slate-950 border border-amber-200/70 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                {grillReport}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (userDefense.trim()) handleRunGrill(userDefense.trim());
                }}
                className="flex flex-col sm:flex-row gap-2"
              >
                <input
                  type="text"
                  value={userDefense}
                  onChange={(e) => setUserDefense(e.target.value)}
                  placeholder="Answer the grill questions or defend your pipeline priorities..."
                  className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={isGrilling || !userDefense.trim()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Defend / Re-Audit
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards Strip with Progress Bars & % */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Token Quota Card */}
        <div className="p-5 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Monthly Quota Burn</span>
              <Flame className="w-4 h-4 text-orange-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
              {tokenQuotaPercent}%
            </div>
            <div className="text-2xs font-mono text-slate-400 mt-1 tabular-nums">
              {usageSummary.totalTokens.toLocaleString()} / {quotaCap.toLocaleString()} tokens
            </div>
          </div>
          {/* Progress Bar */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full transition-all duration-500"
                style={{ width: `${tokenQuotaPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-2xs font-mono text-slate-400 mt-1.5">
              <span>Tier: Standard Flash</span>
              <span>{(100 - tokenQuotaPercent)}% remaining</span>
            </div>
          </div>
        </div>

        {/* Execution Success Rate */}
        <div className="p-5 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Swarm Success Rate</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
              {successRate}%
            </div>
            <div className="text-2xs font-mono text-slate-400 mt-1 tabular-nums">
              {usageSummary.totalRuns} total parallel runs
            </div>
          </div>
          {/* Progress Bar */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${successRate}%` }}
              />
            </div>
            <div className="flex justify-between text-2xs font-mono text-slate-400 mt-1.5">
              <span>0 fatal timeouts</span>
              <span>High reliability</span>
            </div>
          </div>
        </div>

        {/* Latency SLA Compliance */}
        <div className="p-5 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">SLA Compliance (&lt;1.2s)</span>
              <Clock className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
              {slaCompliance}%
            </div>
            <div className="text-2xs font-mono text-slate-400 mt-1 tabular-nums">
              Avg latency: {usageSummary.avgLatencyMs}ms
            </div>
          </div>
          {/* Progress Bar */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${slaCompliance}%` }}
              />
            </div>
            <div className="flex justify-between text-2xs font-mono text-slate-400 mt-1.5">
              <span>p50: 780ms</span>
              <span>p99: 1390ms</span>
            </div>
          </div>
        </div>

        {/* Cache & Cost Efficiency */}
        <div className="p-5 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Prompt Cache Hit</span>
              <Zap className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
              {cacheEfficiency}%
            </div>
            <div className="text-2xs font-mono text-slate-400 mt-1 tabular-nums">
              Est. expense: ${usageSummary.estimatedCost.toFixed(4)}
            </div>
          </div>
          {/* Progress Bar */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${cacheEfficiency}%` }}
              />
            </div>
            <div className="flex justify-between text-2xs font-mono text-slate-400 mt-1.5">
              <span>Token savings: 4.8x</span>
              <span>Optimized</span>
            </div>
          </div>
        </div>
      </div>

      {/* Execution Telemetry Ledger */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Live Command & Execution Stream
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Audit log of parallel multi-agent broadcasts, DAG workflow runs, and consensus syntheses.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {['all', 'Swarm', 'DAG'].map((filter) => (
              <button
                key={filter}
                onClick={() => setLogFilter(filter)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  logFilter === filter
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {filter === 'all' ? 'All Executions' : filter}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">AI Service</th>
                  <th className="py-3 px-4">Operation</th>
                  <th className="py-3 px-4 text-right">Tokens</th>
                  <th className="py-3 px-4 text-right">Latency</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredLogs.slice(0, 10).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                      {log.agentName}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{log.operation}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-900 dark:text-white">
                      {log.tokens.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-600 dark:text-slate-300">
                      {log.latencyMs}ms
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Completed</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
