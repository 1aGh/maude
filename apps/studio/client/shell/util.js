// shell/util.js — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { CANVAS_EXT_RE, MODE_HINT_SEEN, THEME_STORE } from './constants.js';
import { invoke, isNativeApp } from '../github.js';
import { dismissNotice, notify } from '../../notifications.tsx';

// feature-unified-settings-modal — the Settings modal's view prefs are ALSO
// persisted to disk (~/.config/maude/prefs.json via /_api/ui-prefs), so they
// survive a restart even if localStorage is cleared (the native WKWebView
// case). localStorage stays the synchronous init source (no boot flash); disk
// is the durable, cross-restart source of truth reconciled on mount.
export function persistUiPrefs(patch) {
  try {
    fetch('/_api/ui-prefs', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(patch),
    }).catch(() => {});
  } catch {}
}

// feature-studio-file-preview — classifies a non-canvas tree row so FileRow
// can open an inline preview instead of the old inert no-op. Kept in sync
// with apps/studio/api.ts's PREVIEW_ASSET_EXTS (server won't list anything
// outside this set anyway, but the client stays explicit rather than
// assuming server-side filtering).
export const PREVIEW_KIND_RULES = [
  [/\.md$/i, 'markdown'],
  [/\.(css|json|txt|ya?ml)$/i, 'text'],
  [/\.(svg|png|jpe?g|gif|webp|avif)$/i, 'image'],
  [/\.(mp4|webm|mov)$/i, 'video'],
  [/\.(mp3|wav|ogg|m4a)$/i, 'audio'],
  [/\.(woff2?|ttf|otf)$/i, 'font'],
];

export function previewKind(name) {
  for (const [re, kind] of PREVIEW_KIND_RULES) if (re.test(name)) return kind;
  return null;
}

// Shared testid-slug derivation (desktop-e2e skill convention: kebab-case,
// designRoot-stripped, extension-stripped) — mirrors FileRow's inline
// `canvas-row-<slug>` computation so DirRow / the row-menu trigger use the
// SAME shape for `tree-folder-<slug>` / `tree-row-menu-<slug>`.
export function pathTestIdSlug(p) {
  return p
    .replace(/^\.[^/]+\//, '')
    .replace(CANVAS_EXT_RE, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

// A layers tree's identity: its element ids in document order. Two trees with
// the same signature are the same DOM as far as positional ids go.
export function layersTreeSig(nodes) {
  const ids = [];
  (function walk(list) {
    for (const n of list || []) {
      ids.push(n?.id ?? '');
      walk(n?.children);
    }
  })(nodes);
  return ids.join(',');
}

// Best-effort OS notification — shared by handleAssistantFinished and
// handleAssistantAttention below (identical support/permission check +
// try/catch, only the title/body differ). The in-app badge stays the
// reliable signal if this silently fails for any reason.
//
// feature-acp-turn-notifications Task 6 — under Tauri, route through the
// native `send_notification` command (notify.rs) instead of the Web `Notification` API.
// This is the SAME native notifier the shell's cross-project poller uses for
// every OTHER project, so the visible project now goes through the identical
// OS-level path rather than a webview API whose behavior inside WKWebView was
// never empirically confirmed (see Task 1's finding in the plan). Falls back
// to the Web API on any failure — an older desktop build without the command,
// or a plain browser tab — so the signal degrades rather than disappearing.
export function notifyDesktop(title, body) {
  const webFallback = () => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    } catch {
      /* best-effort — the in-app badge is the reliable signal */
    }
  };
  if (isNativeApp()) {
    invoke('send_notification', { title, body }).catch(webFallback);
    return;
  }
  webFallback();
}

export function readInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem(THEME_STORE);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  // Match the data-theme attribute index.html ships with (dark).
  return 'dark';
}

export function readBoolStore(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return fallback;
}

export function readJsonStore(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

// Section default-open: EVERY section starts collapsed (issue #124 — "default
// should be collapsed"). The user's per-section choice is remembered per
// project by useTreeExpansion (tree-expansion.js), next to the folder state.
export function sectionDefaultOpen() {
  return false;
}

// ---------- Utility ----------

// Iframe src for a canvas path. TSX canvases go through _canvas-shell.html so
// the bundled React 19 runtime + importmap can mount the default export. HTML
// canvases keep the legacy "serve the file with inspector + Babel injected"
// path. Phase 3.6 contract; the path argument is repo-root-relative
// (e.g. ".design/ui/Foo.tsx"). Pure resolver extracted to ./canvas-url.js so
// the token-resolution branches are unit-testable without a DOM (DDR-093).

export function basename(p) {
  return p.split('/').pop();
}

// Keep call sites (including Undo actions) on the shared notification stack.
export function shellToast(message, ok = false, action) {
  notify({ title: message, kind: ok ? 'success' : 'error', action });
}

export function browseFirstRunHint(readOnly = false) {
  if (typeof document === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem(MODE_HINT_SEEN) === '1') return;
  } catch {
    return;
  }
  if (browseFirstRunHint.active) return;
  browseFirstRunHint.active = true;
  const dismiss = () => {
    browseFirstRunHint.active = false;
    try { localStorage.setItem(MODE_HINT_SEEN, '1'); } catch {}
    document.removeEventListener('keydown', onV, true);
  };
  const onV = (e) => {
    if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      dismissNotice('mode-hint');
      dismiss();
    }
  };
  if (readOnly) document.addEventListener('keydown', onV, true);
  notify({ id: 'mode-hint', title: readOnly ? 'Your mock is live' : 'You’re in Edit',
    description: readOnly ? 'Click things to try it. Press V to select & inspect.'
      : 'Click selects, like Figma. Switch to Preview in the toolbar to use the live mock.',
    onDismiss: dismiss });
}

// Strip canvas extensions for display. `Canvas Viewport.tsx` → `Canvas Viewport`.
// Sidecars (`.meta.json`, `.css`, `.registry.json`) keep their extensions so
// the file type stays unambiguous.
export function displayName(name) {
  return name.replace(CANVAS_EXT_RE, '');
}

// Primary base = name with the canvas extension stripped. `Canvas Viewport.tsx`
// → `Canvas Viewport`. A sidecar belongs to that primary when its name starts
// with `<base>.` — so `Canvas Viewport.meta.json` and `Canvas Viewport.css`
// both nest under `Canvas Viewport.tsx`. Naïve single-extension stripping
// breaks for multi-dot sidecars like `*.meta.json`.
export function canvasBase(name) {
  return name.replace(CANVAS_EXT_RE, '');
}

// Group flat file list into { primary: canvas, sidecars: [...] }. Sidecars
// share the primary base + `.` prefix and don't themselves match the canvas
// extension regex. Orphans (no canvas peer at this dir level) come back as
// `{ primary: orphan, sidecars: [], orphan: true }` so the caller can gate
// them on `showHidden`.
export function groupBySidecar(files) {
  // Pass 1 — claim primaries; prefer .tsx over .html on tie.
  const primaryByBase = new Map();
  for (const f of files) {
    if (!CANVAS_EXT_RE.test(f.name)) continue;
    const base = canvasBase(f.name);
    if (!primaryByBase.has(base) || /\.tsx$/i.test(f.name)) primaryByBase.set(base, f);
  }
  // Pass 2 — match non-canvas files to the longest primary base they prefix.
  const sidecarsByBase = new Map();
  const orphans = [];
  for (const f of files) {
    if (CANVAS_EXT_RE.test(f.name)) continue;
    let matched = null;
    for (const base of primaryByBase.keys()) {
      if (f.name === base) continue;
      if (f.name.startsWith(`${base}.`)) {
        if (!matched || base.length > matched.length) matched = base;
      }
    }
    if (matched) {
      const list = sidecarsByBase.get(matched) || [];
      list.push(f);
      sidecarsByBase.set(matched, list);
    } else {
      orphans.push(f);
    }
  }
  const canvases = [];
  for (const [base, primary] of primaryByBase) {
    const sidecars = (sidecarsByBase.get(base) || []).sort((a, b) => a.name.localeCompare(b.name));
    canvases.push({ primary, sidecars, orphan: false });
  }
  canvases.sort((a, b) => a.primary.name.localeCompare(b.primary.name));
  orphans.sort((a, b) => a.name.localeCompare(b.name));
  return {
    canvases,
    orphans: orphans.map((f) => ({ primary: f, sidecars: [], orphan: true })),
  };
}

// `dirs` (feature-file-tree-drag-drop-folders, Task 7) — group-relative dir
// paths from the server's /_index-data payload, same shape as `paths`. Seeded
// FIRST so an empty folder (no files inside yet) still gets a node — without
// this a freshly `mkdir`'d folder would be invisible until something landed
// inside it, since the tree is otherwise built entirely from file paths.
export function buildTree(paths, stripPrefix, dirs) {
  const root = {};
  for (const d of dirs || []) {
    const stripped = d.startsWith(stripPrefix) ? d.slice(stripPrefix.length).replace(/^\/+/, '') : d;
    const parts = stripped.split('/').filter(Boolean);
    let node = root;
    for (const key of parts) node = node[key] = node[key] || {};
    node._files = node._files || [];
  }
  for (const p of paths) {
    const stripped = p.startsWith(stripPrefix)
      ? p.slice(stripPrefix.length).replace(/^\/+/, '')
      : p;
    const parts = stripped.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      const isFile = i === parts.length - 1;
      if (isFile) {
        node._files = node._files || [];
        node._files.push({ name: key, path: p });
      } else {
        node[key] = node[key] || {};
        node = node[key];
      }
    }
  }
  return root;
}

export function filterTree(node, query) {
  if (!query) return node;
  const q = query.toLowerCase();
  const out = {};
  let any = false;
  const dirs = Object.keys(node).filter((k) => k !== '_files');
  for (const d of dirs) {
    const filtered = filterTree(node[d], query);
    if (filtered) {
      out[d] = filtered;
      any = true;
    }
  }
  if (node._files) {
    const files = node._files.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
    if (files.length) {
      out._files = files;
      any = true;
    }
  }
  return any ? out : null;
}

export function openCount(comments) {
  return (comments || []).filter((c) => c.status !== 'resolved').length;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd';
  return new Date(iso).toLocaleDateString();
}

export function totalCounts(commentsByFile) {
  let all = 0,
    open = 0,
    resolved = 0;
  for (const list of Object.values(commentsByFile || {})) {
    for (const c of list || []) {
      all++;
      if (c.status === 'resolved') resolved++;
      else open++;
    }
  }
  return { all, open, resolved };
}
