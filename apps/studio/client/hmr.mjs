// Custom HMR client — runs in the dev-server shell only.
//
// Subscribes to the inspector WebSocket and reacts to `hmr` / `css-update` /
// `module-update` events emitted by `build.ts --watch` (or by the server's
// own fs-watch when authoring CSS direct under client/styles/).
//
// CSS path is zero-risk: refresh the <link> with a cache-busting query string,
// browser swaps stylesheet in-place, no React state lost.
//
// JSX path is intentionally LEFT as full-page reload for now (plan Task 9
// Gotcha 2 — land CSS-only HMR first; JSX patching arrives in Phase 3.5 once
// react-refresh-runtime is wired through Bun.build).
//
// Iframes opt out — never trigger a parent reload; they get a postMessage
// to the iframe itself.

const STYLE_SELECTOR = 'link[rel="stylesheet"][href*="/_client/styles.css"]';

function bumpStylesheet() {
  const link = document.querySelector(STYLE_SELECTOR);
  if (!link) return false;
  const next = link.cloneNode();
  const url = new URL(link.href, location.href);
  url.searchParams.set('v', String(Date.now()));
  next.href = url.toString();
  // Swap once the new sheet has loaded; never leave the document briefly
  // unstyled.
  next.addEventListener('load', () => link.remove(), { once: true });
  link.after(next);
  return true;
}

let reloadDebounce = 0;
function scheduleReload() {
  if (reloadDebounce) return;
  reloadDebounce = window.setTimeout(() => location.reload(), 80);
}

function handle(evt) {
  if (!evt || typeof evt !== 'object') return;
  if (evt.type === 'css-update' || evt.type === 'fs:css') {
    if (!bumpStylesheet()) scheduleReload();
    return;
  }
  if (evt.type === 'module-update') {
    // No JSX-patching runtime yet; reload the page. State loss is acceptable
    // for the shell — the iframes (selected element, scroll) survive because
    // each iframe owns its own document and is not re-mounted on reload until
    // the parent re-renders it.
    scheduleReload();
    return;
  }
  if (evt.type === 'fs:html') {
    // The orchestrator (or the user via /design:edit) writes HTML files inside
    // designRoot. We don't reload the shell, but we DO post a hint to the
    // active iframe so it can refresh itself if it owns the changed canvas.
    const iframes = document.querySelectorAll('iframe[data-canvas-path]');
    for (const f of iframes) {
      if (f.dataset.canvasPath && evt.file && evt.file.endsWith(f.dataset.canvasPath)) {
        try {
          // Trip a re-load on the iframe without disturbing the parent.
          f.contentWindow?.location.reload();
        } catch {
          /* cross-origin / detached — ignore */
        }
      }
    }
    return;
  }
  if (evt.type === 'fs:json' && evt.file) {
    // Phase 20 (DDR-049) — external edits to canvas `.meta.json` or
    // `.annotations.json` invalidate the iframe's in-memory undo stack
    // (stale before/after snapshots would otherwise restore wrong state).
    // The iframe's UndoStackProvider self-echo-dampens our own PATCH-es
    // via window.__maude_last_meta_self_write_at, so we forward
    // indiscriminately here.
    const file = evt.file;
    const isMeta = file.endsWith('.meta.json');
    if (!isMeta) return;
    const iframes = document.querySelectorAll('iframe[data-canvas-path]');
    for (const f of iframes) {
      if (!f.dataset.canvasPath) continue;
      // Match by the canvas filename root (foo.tsx ↔ foo.meta.json).
      const root = f.dataset.canvasPath.replace(/\.(tsx|jsx|ts|js|html)$/i, '');
      if (!file.includes(`${root}.meta.json`)) continue;
      try {
        f.contentWindow?.dispatchEvent(
          new CustomEvent('maude:invalidate-undo', {
            detail: { reason: 'Edit history reset (external change)' },
          })
        );
      } catch {
        /* cross-origin / detached — ignore */
      }
    }
  }
}

export function attachHmr(ws) {
  if (!ws) return;
  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    handle(msg);
  });
}

// Auto-attach when imported as a side-effect (build.ts wires it into the
// shell bundle, so `attachHmr` is called from app.jsx after the WS is open).
