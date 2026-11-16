import React, { useEffect, useState } from 'react';
import { Activity, ChevronDown, Cpu, HardDrive, MemoryStick, MonitorPlay, Sparkles } from 'lucide-react';
import { api } from '../api.ts';

// Devices > Performance: like Task Manager. Live graphs for CPU, memory and GPU, each core, disks,
// the busiest programs, and how much Eden and the AI it runs are using right now.
interface Point { at: number; cpu: number; memGb: number; gpu?: number }
interface Perf {
  cores: number[];
  cpuName?: string;
  memTotalGb: number;
  memUsedGb: number;
  uptimeHours: number;
  gpu: { name: string; percent: number; memUsedGb: number; memTotalGb: number; tempC?: number } | null;
  disks: { name: string; usedGb: number; totalGb: number }[];
  history: Point[];
  hubMemMb: number;
  programs: { name: string; cpu: number; memMb: number; count: number; group: string | null }[] | null;
  eden: { id: string; name: string; cpu: number; memMb: number; count: number }[] | null;
}

const KEY = 'eden_perf_folded';
const tone = (p: number) => (p > 85 ? 'text-red-600 dark:text-red-400' : p > 60 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400');
const bar = (p: number) => (p > 85 ? 'bg-red-500' : p > 60 ? 'bg-amber-500' : 'bg-emerald-500');
const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);

// A filled line graph of the last 3 minutes, 0 to 100%.
const Graph: React.FC<{ values: number[]; color: string; label: string }> = ({ values, color, label }) => {
  const w = 300;
  const h = 70;
  const pts = values.length > 1 ? values : [0, ...values, 0].slice(-2);
  const step = w / Math.max(1, 89);
  const start = w - (pts.length - 1) * step;
  const line = pts.map((v, i) => `${(start + i * step).toFixed(1)},${(h - (Math.min(100, v) / 100) * h).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label} className="h-20 w-full rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60">
      {[25, 50, 75].map((g) => (
        <line key={g} x1="0" x2={w} y1={h - (g / 100) * h} y2={h - (g / 100) * h} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      <polygon points={`${start},${h} ${line} ${w},${h}`} fill={color} fillOpacity="0.18" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const Tile: React.FC<{ icon: React.ReactNode; title: string; value: string; percent: number; sub?: string; values: number[]; color: string }> = ({ icon, title, value, percent, sub, values, color }) => (
  <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">{icon} {title}</span>
      <span className={`text-xl font-bold tabular-nums ${tone(percent)}`}>{value}</span>
    </div>
    <Graph values={values} color={color} label={`${title} over the last 3 minutes`} />
    {sub && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{sub}</p>}
  </div>
);

export const PerformancePanel: React.FC = () => {
  const [perf, setPerf] = useState<Perf | null>(null);
  const [error, setError] = useState('');
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setFolded((f) => {
      try {
        localStorage.setItem(KEY, f ? '0' : '1');
      } catch {}
      return !f;
    });

  useEffect(() => {
    if (folded) return;
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await api<Perf>('GET', '/api/perf?programs=1');
        if (alive) {
          setPerf(d);
          setError('');
        }
      } catch (err: any) {
        if (alive) setError(err.message || "Couldn't read performance.");
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [folded]);

  const last = perf?.history[perf.history.length - 1];
  const cpu = last?.cpu ?? 0;
  const memPct = perf ? Math.round((perf.memUsedGb / perf.memTotalGb) * 100) : 0;
  const edenCpu = perf?.eden ? Math.round(perf.eden.reduce((s, g) => s + g.cpu, 0) * 10) / 10 : null;
  const edenMem = perf?.eden ? perf.eden.reduce((s, g) => s + g.memMb, 0) : null;

  return (
    <section aria-label="Performance" className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <Activity className="mt-0.5 h-6 w-6 shrink-0 text-indigo-500" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900 dark:text-white">Performance</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Like Task Manager, live for this PC.{' '}
            {edenCpu !== null && edenMem !== null && (
              <>
                Eden and its AI are using <b className="text-slate-800 dark:text-slate-200">{edenCpu}% CPU</b> and <b className="text-slate-800 dark:text-slate-200">{mb(edenMem)}</b> memory.
              </>
            )}
          </p>
        </div>
        <button onClick={toggle} aria-expanded={!folded} aria-label={`${folded ? 'Show' : 'Hide'} performance`} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <ChevronDown className={`h-5 w-5 transition-transform ${folded ? '-rotate-90' : ''}`} />
        </button>
      </div>

      {!folded && (
        <div className="mt-4 space-y-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {!perf && !error && <p className="text-sm text-slate-500">Reading this PC…</p>}
          {perf && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Tile icon={<Cpu className="h-4 w-4 text-slate-400" />} title="CPU" value={`${cpu}%`} percent={cpu} values={perf.history.map((p) => p.cpu)} color="#6366f1" sub={`${perf.cores.length} cores${perf.cpuName ? ` · ${perf.cpuName}` : ''}`} />
                <Tile icon={<MemoryStick className="h-4 w-4 text-slate-400" />} title="Memory" value={`${memPct}%`} percent={memPct} values={perf.history.map((p) => (p.memGb / perf.memTotalGb) * 100)} color="#0ea5e9" sub={`${perf.memUsedGb} of ${perf.memTotalGb} GB used`} />
                {perf.gpu && (
                  <Tile
                    icon={<MonitorPlay className="h-4 w-4 text-slate-400" />}
                    title="GPU"
                    value={`${perf.gpu.percent}%`}
                    percent={perf.gpu.percent}
                    values={perf.history.map((p) => p.gpu ?? 0)}
                    color="#10b981"
                    sub={`${perf.gpu.name} · ${perf.gpu.memUsedGb} of ${perf.gpu.memTotalGb} GB${perf.gpu.tempC ? ` · ${perf.gpu.tempC}°C` : ''}`}
                  />
                )}
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium text-slate-900 dark:text-white">Each core</h4>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                  {perf.cores.map((c, i) => (
                    <div key={i} title={`Core ${i + 1}: ${c}%`}>
                      <div className="flex h-12 items-end overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                        <div className={`w-full ${bar(c)}`} style={{ height: `${Math.max(2, c)}%` }} />
                      </div>
                      <p className="mt-0.5 text-center text-xs tabular-nums text-slate-500">{c}%</p>
                    </div>
                  ))}
                </div>
              </div>

              {perf.eden && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white"><Sparkles className="h-4 w-4 text-indigo-500" /> What Eden is using</h4>
                  <div className="space-y-2">
                    {perf.eden.map((g) => (
                      <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="w-56 min-w-0 text-slate-800 dark:text-slate-200">{g.name}</span>
                        {g.count === 0 ? (
                          <span className="text-slate-500">Not running</span>
                        ) : (
                          <>
                            <span className={`w-20 tabular-nums ${tone(g.cpu)}`}>{g.cpu}% CPU</span>
                            <span className="w-24 tabular-nums text-slate-700 dark:text-slate-300">{mb(g.memMb)}</span>
                            <span className="h-2 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, (g.memMb / 1024 / perf.memTotalGb) * 100)}%` }} />
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {perf.programs && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-slate-900 dark:text-white">Busiest programs</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700">
                          <th className="py-1.5 pr-3 font-medium">Program</th>
                          <th className="py-1.5 pr-3 text-right font-medium">CPU</th>
                          <th className="py-1.5 text-right font-medium">Memory</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perf.programs.map((p) => (
                          <tr key={`${p.group || ''}:${p.name}`} className={`border-b border-slate-100 dark:border-slate-800 ${p.group ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : ''}`}>
                            <td className="py-1.5 pr-3 text-slate-800 dark:text-slate-200">
                              {p.name}
                              {p.count > 1 && <span className="text-slate-500"> ({p.count})</span>}
                              {p.group && <span className="ml-2 rounded bg-indigo-500/15 px-1.5 py-0.5 text-xs text-indigo-700 dark:text-indigo-300">{p.group}</span>}
                            </td>
                            <td className={`py-1.5 pr-3 text-right tabular-nums ${tone(p.cpu)}`}>{p.cpu}%</td>
                            <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{mb(p.memMb)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {perf.disks.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white"><HardDrive className="h-4 w-4 text-slate-400" /> Disks</h4>
                  <div className="space-y-2">
                    {perf.disks.map((d) => {
                      const pct = Math.round((d.usedGb / d.totalGb) * 100);
                      return (
                        <div key={d.name}>
                          <div className="mb-1 flex justify-between text-sm text-slate-600 dark:text-slate-400">
                            <span>{d.name}</span>
                            <span>{d.totalGb - d.usedGb} GB free of {d.totalGb} GB</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${bar(pct)}`} style={{ width: `${pct}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500">PC on for {perf.uptimeHours} hours. Updates every 3 seconds while this page is open.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
};
