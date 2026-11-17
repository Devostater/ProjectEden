import React from 'react';

// If a screen crashes while drawing, show what happened and a Reload button instead of a blank page.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('EDEN screen crashed:', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ font: '15px system-ui, sans-serif', padding: 32, maxWidth: 640, margin: '10vh auto', color: '#e2e8f0', background: '#0f172a', borderRadius: 16 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Something on this screen broke</h1>
        <p style={{ margin: '0 0 12px', color: '#94a3b8' }}>
          EDEN is still running. Reloading usually fixes it. If it keeps happening (for example right after applying a code update), restart EDEN so its server part matches the screens.
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#fca5a5', margin: '0 0 16px' }}>{String(this.state.error?.message || this.state.error)}</pre>
        <button onClick={() => location.reload()} style={{ background: '#4f46e5', color: 'white', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>
          Reload
        </button>
      </div>
    );
  }
}
