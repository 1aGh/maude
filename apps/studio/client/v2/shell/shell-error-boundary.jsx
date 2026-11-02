// client/v2/shell/shell-error-boundary.jsx — sec-a C3 (wave-A attacker): one render throw anywhere in the
// shell (a malformed canvas message reaching a toast, a bad row in a panel) used to unmount EVERYTHING —
// a blank window, no way back but quitting. The boundary keeps the window: it shows a small error card
// with Reload instead, and logs the error. Words per CONTRACT §4: what happened · what is safe · one verb.

import { Component } from 'react';

export const SHELL_ERROR_WORDS = {
  title: 'This window stopped drawing.',
  body: 'Your canvases are saved on disk. Reload to carry on.',
  reload: 'Reload',
};

// Inline, token-only styles: the card must draw even when the failure came from the shell's own CSS
// lanes, and it needs no stylesheet rebuild.
const S = {
  wrap: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    background: 'var(--bg-0)',
    color: 'var(--fg-0)',
  },
  card: {
    display: 'grid',
    gap: 'var(--space-3)',
    justifyItems: 'start',
    maxWidth: 'min(360px, calc(100vw - 32px))',
    padding: 'var(--space-4)',
    background: 'var(--bg-1)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
  },
  title: { fontWeight: 600 },
  body: { color: 'var(--fg-2)' },
};

export default class ShellErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    try {
      console.error('[shell] render error', error, info?.componentStack ?? '');
    } catch {
      /* console gone */
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const reload = this.props.onReload ?? (() => window.location.reload());
    return (
      <div className="shell-error" style={S.wrap} role="alert" data-testid="shell-error-card">
        <div className="shell-error-card" style={S.card}>
          <div className="shell-error-title" style={S.title}>
            {SHELL_ERROR_WORDS.title}
          </div>
          <div className="shell-error-body" style={S.body}>
            {SHELL_ERROR_WORDS.body}
          </div>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => reload()}
            data-testid="shell-error-reload"
          >
            {SHELL_ERROR_WORDS.reload}
          </button>
        </div>
      </div>
    );
  }
}
