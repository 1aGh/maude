// client/home/shell-mode.js — which root the one client bundle renders: the project shell or Home.
//
// The Home server (`maude-server --home`) answers `/_config` with `mode: 'home'`, but only to a
// request carrying `x-maude-home: 1` (V2-1.1 §5.3), and it serves the same index.html as a project.
// So the page decides like this, never delaying the project shell where it can know without asking:
//   - in the desktop app the webview's label is known synchronously: `home` asks `/_config` (with
//     the header) and renders Home; any other label (`p-<pid>`, the legacy `main`) is a project;
//   - in a browser on a non-loopback host (a cloud cell) it is a project — Home is loopback only;
//   - in a browser on loopback (development) it asks `/_config` with the header: `mode: 'home'` →
//     Home, anything else (a project server ignores the header) or a failure → the project shell.

import { getConfig } from './home-api.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The calling webview's Tauri label, or null outside the app. */
export function webviewLabel(win = typeof window !== 'undefined' ? window : undefined) {
  const meta = win?.__TAURI_INTERNALS__?.metadata;
  const label = meta?.currentWebview?.label ?? meta?.currentWindow?.label;
  return typeof label === 'string' && label ? label : null;
}

/** 'home' | 'project' when known without a request, else null (ask `/_config`). */
export function shellModeHint(win = typeof window !== 'undefined' ? window : undefined) {
  const label = webviewLabel(win);
  if (label) return label === 'home' ? 'home' : 'project';
  const host = win?.location?.hostname ?? '';
  if (!LOOPBACK.has(host) && !host.endsWith('.localhost')) return 'project';
  return null;
}

/**
 * Calls `render(mode, config)` once. Synchronously for a project the hint already names, so the
 * project shell's first paint is unchanged; after one `/_config` request otherwise.
 */
export function bootShellMode(render, win) {
  const hint = shellModeHint(win);
  if (hint === 'project') {
    render('project', null);
    return;
  }
  getConfig().then((r) => {
    if (r.ok && r.json?.mode === 'home') render('home', r.json);
    // the Home window keeps Home even when its server is not answering yet: the page says so
    else if (hint === 'home') render('home', null);
    else render('project', null);
  });
}
