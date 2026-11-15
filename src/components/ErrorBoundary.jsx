import React from 'react';

// Last line of defence: a render crash (or a lazy chunk that disappeared after an update) shows a recovery screen
// instead of a blank page. Nothing is sent anywhere; details stay on screen for copy/paste into a bug report.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { try { console.error('Slidewise crashed:', error); } catch { /* ignore */ } }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = /dynamically imported module|Loading chunk|Failed to fetch/i.test(String(error && error.message));
    return (
      <main className="center-msg" role="alert">
        <h1>{stale ? 'Slidewise was updated' : 'Something went wrong'}</h1>
        <p>{stale ? 'A newer version was installed while this page was open. Reload to continue. Your presentations are saved on this device.' : 'The screen crashed. Your presentations are autosaved on this device, so reloading is safe.'}</p>
        <p><button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload</button>{' '}
          <a className="btn" href="#/" onClick={() => setTimeout(() => window.location.reload(), 0)}>Back to all presentations</a></p>
        <details><summary>Technical details</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{String(error && (error.stack || error.message || error)).slice(0, 2000)}</pre></details>
      </main>
    );
  }
}
