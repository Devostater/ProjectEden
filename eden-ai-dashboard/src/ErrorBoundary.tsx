import React from 'react';

type LastUpdate = { id: string; request: string };
type State = { error: Error | null; last: LastUpdate | null; undoing: boolean; note: string };

// If a screen crashes while drawing, show what happened and a Reload button instead of a blank page. When the newest
// applied code update to EDEN may be the cause, offer to undo it right here (the Code updates page may be the one
// that is broken).
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, last: null, undoing: false, note: '' };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('EDEN screen crashed:', error);
    fetch('/api/updates')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Newest first. Only an update to EDEN itself can break EDEN's screens.
        const job = (d?.jobs || []).find((j: any) => j.status === 'applied' && j.codebaseId === 'hub');
        if (job) this.setState({ last: { id: job.id, request: String(job.request || '') } });
      })
      .catch(() => {});
  }
  undo = async () => {
    const { last } = this.state;
    if (!last || this.state.undoing) return;
    this.setState({ undoing: true, note: '' });
    try {
      const r = await fetch(`/api/updates/${encodeURIComponent(last.id)}/undo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Could not undo it (error ${r.status}).`);
      this.setState({ note: d.needsRestart ? 'Undone. Restart EDEN to finish, then reload.' : 'Undone. Reloading…' });
      if (!d.needsRestart) setTimeout(() => location.reload(), 1500);
    } catch (e: any) {
      this.setState({ undoing: false, note: e?.message || 'Could not undo it.' });
    }
  };
  render() {
    const { error, last, undoing, note } = this.state;
    if (!error) return this.props.children;
    const btn: React.CSSProperties = { border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer', color: 'white' };
    return (
      <div role="alert" style={{ font: '15px system-ui, sans-serif', padding: 32, maxWidth: 640, margin: '10vh auto', color: '#e2e8f0', background: '#0f172a', borderRadius: 16 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Something on this screen broke</h1>
        <p style={{ margin: '0 0 12px', color: '#94a3b8' }}>
          EDEN is still running. Reloading usually fixes it. If it keeps happening, restart EDEN so its server part matches the screens.
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#fca5a5', margin: '0 0 16px' }}>{String(error?.message || error)}</pre>
        {last && (
          <p style={{ margin: '0 0 16px', color: '#cbd5e1' }}>
            The last code update applied to EDEN was: “{last.request.length > 140 ? `${last.request.slice(0, 140)}…` : last.request}”. If this started right after it, undo it. Its files go back to how they were, and you can apply it again later.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => location.reload()} style={{ ...btn, background: '#4f46e5' }}>Reload</button>
          {last && (
            <button onClick={this.undo} disabled={undoing} style={{ ...btn, background: '#b45309', opacity: undoing ? 0.6 : 1 }}>
              {undoing ? 'Undoing…' : 'Undo the last update'}
            </button>
          )}
        </div>
        {note && <p style={{ margin: '12px 0 0', color: '#fde68a' }}>{note}</p>}
      </div>
    );
  }
}
