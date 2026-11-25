import { useEffect, useState } from 'react';

interface RunnerRow {
  id: string;
  name: string;
  args?: 'issueNumbers';
  state: string;
  startedAt?: string;
  exitCode?: number | null;
  error?: string;
  progress?: { done: number; total: number; current?: { index: number; id?: string; text: string } };
  log?: string;
  projectLog?: string;
}

interface PanelStatus {
  running: number;
  runners: RunnerRow[];
}

async function request(action: string, body: object) {
  const response = await fetch('/api/runners/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load runners.');
  return data;
}

export default function RunnersPanel() {
  const [status, setStatus] = useState<PanelStatus>();
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState('');
  const [logId, setLogId] = useState<string>();
  const [args, setArgs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await request('status', { logId });
        if (!cancelled) {
          setStatus(next);
          setLoadError('');
        }
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      } finally {
        if (!cancelled) timer = setTimeout(refresh, 2000);
      }
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [logId, pending]);

  async function act(action: 'start' | 'stop', id: string) {
    setPending(id);
    setError('');
    try {
      await request(action, { id, args: action === 'start' ? args[id] : undefined });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending('');
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-white/10" aria-labelledby="runners-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="runners-heading" className="font-semibold">Runners</h2>
        {status && <p className="text-sm text-slate-500 dark:text-slate-400">{status.running} running, 0 windows</p>}
      </div>
      {(error || loadError) && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{loadError || error}</p>}
      {status?.runners.length === 0 && <p className="mt-2 text-sm">Add runners in .eden-runners.json to get started.</p>}
      {status && status.runners.map((runner) => {
        const running = runner.state === 'Running';
        const progress = runner.progress;
        const current = progress?.current;
        return (
          <div key={runner.id} className="mt-3 border-t border-slate-200 pt-3 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{runner.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${running ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>
                {runner.state}{runner.exitCode != null && ` (code ${runner.exitCode})`}
              </span>
              {running && runner.startedAt && <time className="text-xs" dateTime={runner.startedAt}>Since {new Date(runner.startedAt).toLocaleString()}</time>}
            </div>
            {runner.error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{runner.error}</p>}
            {progress && progress.total > 0 && (
              <div className="mt-2 text-sm">
                <div>{progress.done} of {progress.total} done{current && ` · ${current.id || current.index} of ${progress.total}: ${current.text}`}</div>
                <progress className="w-full accent-indigo-600" aria-label={runner.name + ' progress'} value={progress.done} max={progress.total} />
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {runner.args && !running && (
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  Issue numbers
                  <input className="rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-white/20" placeholder="39 40" maxLength={200}
                    value={args[runner.id] || ''} onChange={(event) => setArgs({ ...args, [runner.id]: event.target.value })} />
                </label>
              )}
              <button type="button" disabled={!!pending || !!loadError || runner.state === 'Stopping'} onClick={() => void act(running ? 'stop' : 'start', runner.id)}
                className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                {running ? 'Stop' : 'Start'}
              </button>
              <button type="button" aria-expanded={logId === runner.id} onClick={() => setLogId(logId === runner.id ? undefined : runner.id)}
                className="rounded-md px-2 py-1 text-sm underline">
                {logId === runner.id ? 'Hide log' : 'Show log'}
              </button>
            </div>
            {logId === runner.id && (
              <div className="mt-2 space-y-2">
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs text-slate-100">{runner.log ?? 'Loading log…'}</pre>
                {runner.projectLog && <pre aria-label="Project log" className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs text-slate-100">{runner.projectLog}</pre>}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
