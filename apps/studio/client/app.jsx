// Design plugin local browser — React UI.
// Bundled via Bun.build (DDR-009/012) — IIFE, tree-shaken, React 19 from npm.
// Renders: file tree, tabs, viewport (iframes), status bar, design-system view, comments.
// Universal — no project tokens needed; styling lives in client/styles/.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

// Trusted tool→cursor resolver (shares the single TOOL_CURSORS source with the
// canvas runtime). canvas-cursors.ts is dependency-free (a type-only Tool
// import that Bun erases), so this pulls only string constants into the client
// bundle — no React, no input-router. See the tool-cursor handler below.
import { resolveToolCursor } from '../canvas-cursors.ts';
import {
  defaultScopeForFormat,
  isScopeValidForFormat,
  validScopesForFormat,
} from '../exporters/format-scopes.ts';
// feature-3-web-artboards T5 — the single source (grid-track-handles.ts) for
// the Inspector's Grid-section track parser/serializer, shared with the
// on-canvas gutter-drag overlay so both edit the SAME track-list shape.
import { GRID_KEYWORD_UNITS, parseTrackList, serializeTrackList } from '../grid-track-handles.ts';
// feature-2-print-artboards T2 — the single source (print/units.ts) for the
// Inspector's paper-preset picker, same "pull only pure math/data" shape as
// canvas-cursors.ts above.
import { PAPER_PRESETS, resolvePrintArtboard } from '../print/units.ts';
import { resolveHeightCommit } from '../artboard-hug-commit.ts';
import { sizingModeOf, sizingModePatch } from '../sizing-mode.ts';
// The single "what is the hub link doing" rule, shared with the cloud rail's
// connect note so the two surfaces can never disagree. Pure data + strings —
// same "pull only pure logic into the client bundle" shape as the imports
// above (a type-only SyncStatusSnapshot import that Bun erases).
import { syncPresentation } from '../sync/presentation.ts';
import { canvasUrl } from './canvas-url.js';
import {
  BROWSER_CAPTURE_FORMATS,
  BROWSER_SERVABLE_FORMATS,
  browserCaptureEligible,
  captureDeckViaBrowser,
  captureScale,
  sanitizeCapturedItems,
  recordBrowserExport,
} from './export-lane.js';
import { TreeRowMenu, useRowMenu } from './tree-row-menu.jsx';
import { useTreeDrag } from './use-tree-drag.js';
import ChatPanel from './panels/ChatPanel.jsx';
import DiffView from './panels/DiffView.jsx';
import GitPanel from './panels/GitPanel.jsx';
import SyncConsentDialog from './panels/SyncConsentDialog.jsx';
import SyncPanel from './panels/SyncPanel.jsx';
import CloudBar from './panels/CloudBar.jsx';
import IdentityBar from './panels/IdentityBar.jsx';
import OnboardingWizard from './panels/OnboardingWizard.jsx';
import { ReadinessDialog } from './panels/ReadinessList.jsx';
import IntroVideoDialog from './panels/IntroVideoDialog.jsx';
import BrandUploadPanel from './panels/BrandUploadPanel.jsx';
import FigmaImportPanel from './panels/FigmaImportPanel.jsx';
import { FilePreview, sanitizeDisplayText } from './panels/file-preview.jsx';
import SetupChecklistDialog, { useSetupReadiness } from './panels/SetupChecklist.jsx';
import TimelinePanel from './panels/TimelinePanel.jsx';
import { parseCompTimeline } from './panels/timeline-parse.js';
import {
  activeComp,
  resolveCompTarget,
  sanitizeArtboardText,
} from './panels/timeline-comp-target.js';
import { durationFramesForDrop, probeMediaDuration } from './panels/timeline-media-cache.js';
import GenerateDialog from './generate-dialog.jsx';
import RepoBranchSwitcher from './panels/RepoBranchSwitcher.jsx';
import SettingsPanel from './panels/SettingsPanel.jsx';
import StickerPicker from './panels/StickerPicker.jsx';
import { AlignPad, AngleDial, ColorField, IconButtonGroup, IconToggleGroup, makeScrubHandler, NumberField, RadiusControl, Segmented, Select, SliderField, Toggle, UnitSelect, ValueTokenField } from './inspector-controls.jsx';
import {
  ALargeSmall as LuALargeSmall,
  AlignCenter as LuAlignCenter,
  AlignHorizontalJustifyCenter as LuJustifyCenter,
  AlignHorizontalJustifyEnd as LuJustifyEnd,
  AlignHorizontalJustifyStart as LuJustifyStart,
  AlignHorizontalSpaceBetween as LuSpaceBetween,
  AlignJustify as LuAlignJustify,
  AlignLeft as LuAlignLeft,
  AlignRight as LuAlignRight,
  AlignVerticalJustifyCenter as LuVJustifyCenter,
  AlignVerticalJustifyEnd as LuVJustifyEnd,
  AlignVerticalJustifyStart as LuVJustifyStart,
  Baseline as LuBaseline,
  Bold as LuBold,
  Columns3 as LuColumns3,
  Eye as LuEye,
  Italic as LuItalic,
  Minus as LuMinus,
  MoveHorizontal as LuMoveH,
  RotateCw as LuRotateCw,
  Rows3 as LuRows3,
  Scissors as LuScissors,
  ScrollText as LuScrollText,
  Spline as LuSpline,
  StretchHorizontal as LuStretch,
  Underline as LuUnderline,
  Braces as LuBraces,
  Wand2 as LuWand2,
} from 'lucide-react';

// lucide wrapper — hairline stroke to match the shell's icon weight (handoff).
const Lu = ({ as: C, size = 14 }) => <C size={size} strokeWidth={1.75} style={{ display: 'block' }} />;
import { PhotoKnobs } from './photo-knobs.jsx';
import {
  appIsFirstRun,
  invoke,
  isNativeApp,
  onMenuReportBug,
  onUpdateReady,
  pickMediaFile,
  pickMediaFiles,
  restartToUpdate,
} from './github.js';
import { COLLAB_TOUR } from './tour/collab-tour.js';
import { TourOverlay } from './tour/overlay.jsx';
import { QUICK_SETUP_TOUR } from './tour/quick-setup-tour.js';
import { USAGE_TOUR } from './tour/usage-tour.js';
import { dismissNotice, NotificationHost, notify, notifyCanvasText } from '../notifications.tsx';
import { acceptCanvasNotice } from '../canvas-notice-message.ts';
import { ExportBadge, ExportPanel, ExportToast, useExportCenter } from './export-center.jsx';
import { ReportBugDialog } from './report-bug.jsx';
import { useWhatsNew, WhatsNewPanel, WhatsNewToast } from './whats-new.jsx';

const USAGE_TOUR_STORE = 'mdcc-usage-tour-seen';
// Phase 29 (E4) — the collab "rychlý kurz" is offered once after onboarding.
const COLLAB_TOUR_STORE = 'mdcc-collab-tour-seen';

const SYSTEM_TAB = '__system__';
const THEME_STORE = 'mdcc-theme';
const SHOW_HIDDEN_STORE = 'mdcc-show-hidden';
const SECTIONS_STORE = 'mdcc-sections-expanded';
// DDR-171 — CSS panel vocabulary mode ('advanced' | 'designer'), read inside
// CssKnobs.
const CP_MODE_STORE = 'maude-cp-mode';
const SIDEBAR_STORE = 'mdcc-sidebar-open';
const MINIMAP_STORE = 'mdcc-minimap-visible';
const ZOOMCTL_STORE = 'mdcc-zoomctl-visible';
const ANNOT_STORE = 'mdcc-annotations-visible';
const AUTOOPEN_STORE = 'maude-auto-open-inspector';
// DDR-185 security addendum — floor between OS notifications for a NEW
// permission/elicitation request, so a burst of distinct pending approvals
// (capped at 15 total server-side, DDR-179/180) reads as one attention-
// getting ping instead of a rapid-fire flood. The in-app badge is unaffected.
const ATTENTION_NOTIFY_COOLDOWN_MS = 30_000;

// feature-unified-settings-modal — the Settings modal's view prefs are ALSO
// persisted to disk (~/.config/maude/prefs.json via /_api/ui-prefs), so they
// survive a restart even if localStorage is cleared (the native WKWebView
// case). localStorage stays the synchronous init source (no boot flash); disk
// is the durable, cross-restart source of truth reconciled on mount.
function persistUiPrefs(patch) {
  try {
    fetch('/_api/ui-prefs', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(patch),
    }).catch(() => {});
  } catch {}
}

// feature-configurable-panel-docking — the dockable shell panels. Each can live
// in the LEFT or RIGHT slot (persisted in UiPrefs.panelSides); each slot is a
// single-panel-at-a-time surface with a tab strip over the panels assigned to
// it. Order here = tab order within a slot. `assistant` is native-only.
const DOCK_PANELS = [
  { id: 'tree', label: 'Files' },
  { id: 'layers', label: 'Layers' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'comments', label: 'Comments' },
  { id: 'changes', label: 'Changes' },
  { id: 'sync', label: 'Sync' }, // feature-sync-progress-modal — linked projects only
  { id: 'assistant', label: 'Assistant' },
];
const PANEL_SIDES_DEFAULTS = {
  tree: 'left',
  layers: 'left',
  inspector: 'right',
  comments: 'right',
  changes: 'right',
  sync: 'right',
  assistant: 'right',
};
const PANEL_SIDES_STORE = 'mdcc-panel-sides';
const LAYERS_MODE_STORE = 'mdcc-layers-mode';

// feature-configurable-panel-docking — one dock slot (left or right). Owns the
// resizable width + a tab strip over the panels assigned to the slot; renders
// the active panel (passed as children). Collapses to 0 width when nothing is
// visibly open (it may still host an always-mounted hidden ChatPanel).
function DockSlot({ side, width, open, ids, activeId, onPick, children, labels = null }) {
  return (
    <div
      className={'st-dockslot st-dockslot--' + side + (open ? '' : ' is-collapsed')}
      style={{ width: open ? width : 0, flexBasis: open ? width : 0 }}
    >
      {open && ids.length > 1 && (
        <div className="st-docktabs" role="tablist" aria-label={side + ' panels'}>
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeId === id}
              className={'st-docktab' + (activeId === id ? ' is-active' : '')}
              onClick={() => onPick(id)}
            >
              {labels?.[id] || (DOCK_PANELS.find((p) => p.id === id) || {}).label || id}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
const CANVAS_EXT_RE = /\.(tsx|html?)$/i;
// feature-studio-file-preview — classifies a non-canvas tree row so FileRow
// can open an inline preview instead of the old inert no-op. Kept in sync
// with apps/studio/api.ts's PREVIEW_ASSET_EXTS (server won't list anything
// outside this set anyway, but the client stays explicit rather than
// assuming server-side filtering).
const PREVIEW_KIND_RULES = [
  [/\.md$/i, 'markdown'],
  [/\.(css|json|txt|ya?ml)$/i, 'text'],
  [/\.(svg|png|jpe?g|gif|webp|avif)$/i, 'image'],
  [/\.(mp4|webm|mov)$/i, 'video'],
  [/\.(mp3|wav|ogg|m4a)$/i, 'audio'],
  [/\.(woff2?|ttf|otf)$/i, 'font'],
];
function previewKind(name) {
  for (const [re, kind] of PREVIEW_KIND_RULES) if (re.test(name)) return kind;
  return null;
}
// Shared testid-slug derivation (desktop-e2e skill convention: kebab-case,
// designRoot-stripped, extension-stripped) — mirrors FileRow's inline
// `canvas-row-<slug>` computation so DirRow / the row-menu trigger use the
// SAME shape for `tree-folder-<slug>` / `tree-row-menu-<slug>`.
function pathTestIdSlug(p) {
  return p
    .replace(/^\.[^/]+\//, '')
    .replace(CANVAS_EXT_RE, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}
// Bun's `define` substitutes this at build time (see build.ts); falls back when
// the bundle is consumed in a context that hasn't run the build.
const MDCC_VERSION = typeof __MDCC_VERSION__ !== 'undefined' ? __MDCC_VERSION__ : 'dev';

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
function notifyDesktop(title, body) {
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

function readInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem(THEME_STORE);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  // Match the data-theme attribute index.html ships with (dark).
  return 'dark';
}

function readBoolStore(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return fallback;
}

function readJsonStore(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

// Section default-open: working sections (project + non-DS canvas groups)
// open; meta sections (DS + runtime) collapsed. Users can override per-section
// via the chevron; overrides persist in localStorage.
function sectionDefaultOpen(g) {
  if (g.kind === 'runtime') return false;
  if (g.label === 'Design system') return false;
  return true;
}

// ---------- Utility ----------

// Iframe src for a canvas path. TSX canvases go through _canvas-shell.html so
// the bundled React 19 runtime + importmap can mount the default export. HTML
// canvases keep the legacy "serve the file with inspector + Babel injected"
// path. Phase 3.6 contract; the path argument is repo-root-relative
// (e.g. ".design/ui/Foo.tsx"). Pure resolver extracted to ./canvas-url.js so
// the token-resolution branches are unit-testable without a DOM (DDR-093).

function basename(p) {
  return p.split('/').pop();
}

// Keep call sites (including Undo actions) on the shared notification stack.
function shellToast(message, ok = false, action) {
  notify({ title: message, kind: ok ? 'success' : 'error', action });
}

// DDR-223 (issue #93, supersedes DDR-187's boot half) — one-time first-run
// teaching hint. Authoring canvases now boot into EDIT (`move`/V armed): click
// selects like Figma, and the mock is inert until the Preview toggle flips the
// alive posture back on. Teach exactly that ONCE, gated by a NEW localStorage
// marker (`maude-mode-hint-seen` — deliberately not the old
// `maude-browse-hint-seen`, which taught the opposite posture; every existing
// user should see the new hint once). Read-only viewers still boot preview
// (alive) and keep the DDR-187 wording. Auto-dismisses; the taught gesture
// (V in read-only) clears it early.
const MODE_HINT_SEEN = 'maude-mode-hint-seen';
function browseFirstRunHint(readOnly = false) {
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
function displayName(name) {
  return name.replace(CANVAS_EXT_RE, '');
}

// Primary base = name with the canvas extension stripped. `Canvas Viewport.tsx`
// → `Canvas Viewport`. A sidecar belongs to that primary when its name starts
// with `<base>.` — so `Canvas Viewport.meta.json` and `Canvas Viewport.css`
// both nest under `Canvas Viewport.tsx`. Naïve single-extension stripping
// breaks for multi-dot sidecars like `*.meta.json`.
function canvasBase(name) {
  return name.replace(CANVAS_EXT_RE, '');
}

// Group flat file list into { primary: canvas, sidecars: [...] }. Sidecars
// share the primary base + `.` prefix and don't themselves match the canvas
// extension regex. Orphans (no canvas peer at this dir level) come back as
// `{ primary: orphan, sidecars: [], orphan: true }` so the caller can gate
// them on `showHidden`.
function groupBySidecar(files) {
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
function buildTree(paths, stripPrefix, dirs) {
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

function filterTree(node, query) {
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

function openCount(comments) {
  return (comments || []).filter((c) => c.status !== 'resolved').length;
}

function timeAgo(iso) {
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

function totalCounts(commentsByFile) {
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

// ---------- Components ----------

function Icon({ d, size = 14, color }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
    >
      <path d={d} />
    </svg>
  );
}

// ───── maude DS icon set (Plan B) ─────
// Thin-stroke (1.4) 16×16 geometric glyphs lifted from .design/ui/Studio.tsx —
// the icon vocabulary the ported `.st-*` chrome composes with. Distinct from the
// legacy 24×24 single-path `Icon` above (kept for not-yet-ported chrome). Grown
// per slice; this slice (menubar/statusbar) needs sparkle/check/sun/moon plus a
// few the sidebar + panels reuse later.
const STICONS = {
  'chevron-down': <polyline points="3.5 6 8 10.5 12.5 6" />,
  'chevron-right': <polyline points="6 3.5 10.5 8 6 12.5" />,
  file: (
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <polyline points="9 2 9 5 12 5" />
    </>
  ),
  folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
  // feature-file-tree-drag-drop-folders (Task 9/12) — folder outline + a "+"
  // mark, single-stroke family matching `folder`/`file`/`panel-left`.
  'folder-plus': (
    <>
      <path d="M2 4.5h4l1.3 1.5H14V13H2z" />
      <path d="M8 7.5v3.5M6.25 9.25h3.5" />
    </>
  ),
  // feature-4 T7b — Layers padlock (closed / open).
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015-.7" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <line x1="10" y1="10" x2="13.5" y2="13.5" />
    </>
  ),
  plus: (
    <>
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </>
  ),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  x: (
    <>
      <line x1="4.3" y1="4.3" x2="11.7" y2="11.7" />
      <line x1="11.7" y1="4.3" x2="4.3" y2="11.7" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <line x1="8" y1="1.5" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="14.5" y2="8" />
      <line x1="3.4" y1="3.4" x2="4.4" y2="4.4" />
      <line x1="11.6" y1="11.6" x2="12.6" y2="12.6" />
      <line x1="12.6" y1="3.4" x2="11.6" y2="4.4" />
      <line x1="4.4" y1="11.6" x2="3.4" y2="12.6" />
    </>
  ),
  moon: <path d="M12.5 9.6A5 5 0 1 1 7 3a4 4 0 0 0 5.5 6.6z" />,
  sparkle: (
    <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" fill="currentColor" stroke="none" />
  ),
  megaphone: (
    <>
      <path d="M2 6.7 11 4v8L2 9.3z" />
      <path d="M11 5.2a2.4 2.4 0 0 1 0 5.6" />
      <path d="M4.3 9.5v2.3a1.2 1.2 0 0 0 2.4 0v-1.7" />
    </>
  ),
  bug: (
    <>
      <circle cx="8" cy="9" r="3.6" />
      <circle cx="8" cy="4.4" r="1.3" />
      <path d="M6.2 3.4 5.2 2M9.8 3.4l1-1.4" />
      <path d="M4.6 7.6H2.2M4.6 9H2.2M4.6 10.6H2.5M11.4 7.6h2.4M11.4 9h2.4M11.4 10.6h2.3" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <line x1="6.4" y1="3" x2="6.4" y2="13" />
    </>
  ),
  resolve: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <polyline points="5.4 8 7.2 9.9 10.6 6" />
    </>
  ),
  reopen: (
    <>
      <path d="M3.2 8a5 5 0 1 1 1.4 3.5" />
      <polyline points="3.2 11.4 3.2 8 6.6 8" />
    </>
  ),
  layers: (
    <>
      <polygon points="8 2.2 13.8 5.5 8 8.8 2.2 5.5" />
      <polyline points="2.2 9 8 12.3 13.8 9" />
    </>
  ),
  // Layer-type glyphs (Phase 12.3 W3.1) — one mark per LayerNode `type`.
  box: <rect x="3" y="3" width="10" height="10" rx="1.2" />,
  type: (
    <>
      <polyline points="4 4 12 4" />
      <line x1="8" y1="4" x2="8" y2="12" />
    </>
  ),
  button: (
    <>
      <rect x="2.5" y="5" width="11" height="6" rx="3" />
      <line x1="6" y1="8" x2="10" y2="8" />
    </>
  ),
  input: (
    <>
      <rect x="2.5" y="5" width="11" height="6" rx="1.2" />
      <line x1="5" y1="8" x2="5" y2="8" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5l-1 1" />
      <path d="M9.5 6.5a2.5 2.5 0 0 1 0 3.5l-1.5 1.5a2.5 2.5 0 0 1-3.5-3.5l1-1" />
    </>
  ),
  list: (
    <>
      <line x1="6" y1="4.5" x2="13" y2="4.5" />
      <line x1="6" y1="8" x2="13" y2="8" />
      <line x1="6" y1="11.5" x2="13" y2="11.5" />
      <circle cx="3.2" cy="4.5" r="0.8" fill="currentColor" />
      <circle cx="3.2" cy="8" r="0.8" fill="currentColor" />
      <circle cx="3.2" cy="11.5" r="0.8" fill="currentColor" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  eyedropper: (
    <>
      <path d="M11 2.6a1.7 1.7 0 0 1 2.4 2.4l-1.2 1.2-2.4-2.4z" />
      <path d="M9.5 4.6 4 10.1V12h1.9l5.5-5.5" />
    </>
  ),
  // Figma-style property prefix glyphs (#2) — small marks INSIDE numeric fields.
  'p-corner': <path d="M3.5 12.5V7a3.5 3.5 0 0 1 3.5-3.5h5.5" />,
  'p-opacity': (
    <>
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
      <path d="M3 8h10M8 3v10" strokeWidth="0.9" opacity="0.55" />
    </>
  ),
  'p-lineheight': (
    <>
      <line x1="6.5" y1="4" x2="13" y2="4" />
      <line x1="6.5" y1="8" x2="13" y2="8" />
      <line x1="6.5" y1="12" x2="13" y2="12" />
      <path d="M3.2 4.6 3.2 11.4M2 6 3.2 4.5 4.4 6M2 10 3.2 11.5 4.4 10" />
    </>
  ),
  'p-letterspacing': (
    <>
      <path d="M3 4v8M13 4v8" />
      <path d="M6 11.5 8 5l2 6.5M6.7 9.3h2.6" strokeWidth="1.1" />
    </>
  ),
  'p-gap': (
    <>
      <rect x="2" y="4.5" width="3.6" height="7" rx="0.6" />
      <rect x="10.4" y="4.5" width="3.6" height="7" rx="0.6" />
      <path d="M6.8 8h2.4M7.4 6.9 6.4 8l1 1.1M8.6 6.9 9.6 8l-1 1.1" strokeWidth="1" />
    </>
  ),
  'p-border': <rect x="3" y="3" width="10" height="10" rx="1" />,
  'p-size': (
    <>
      <path d="M3 13 6.6 3l3.6 10" />
      <path d="M4.3 9.6h4.6" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M6.3 4A6.7 6.7 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a12 12 0 0 1-2 2.4M4.4 5.3A12 12 0 0 0 1.5 8S4 12.5 8 12.5a6.5 6.5 0 0 0 2.1-.35" />
      <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />
    </>
  ),
  sliders: (
    <>
      <line x1="3" y1="5" x2="13" y2="5" />
      <circle cx="6" cy="5" r="1.7" fill="currentColor" />
      <line x1="3" y1="11" x2="13" y2="11" />
      <circle cx="10" cy="11" r="1.7" fill="currentColor" />
    </>
  ),
  code: (
    <>
      <polyline points="6 5 3 8 6 11" />
      <polyline points="10 5 13 8 10 11" />
    </>
  ),
  download: (
    <>
      <line x1="8" y1="2.5" x2="8" y2="10" />
      <polyline points="4.5 7 8 10.5 11.5 7" />
      <polyline points="3 12.8 3 13.6 13 13.6 13 12.8" />
    </>
  ),
  // lucide `rotate-cw`, scaled from the 24px source into our 16px viewBox.
  reload: (
    <>
      <path d="M14 8a6 6 0 1 1-2-4.47L14 5.33" />
      <path d="M14 2v3.33h-3.33" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.3 6.2a1.8 1.8 0 1 1 2.3 1.9c-.5.2-.6.5-.6 1v.3" />
      <line x1="8" y1="11.4" x2="8" y2="11.5" />
    </>
  ),
  // Export-format glyphs (Plan C) — one distinct mark per format card.
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.3" r="1.1" />
      <path d="M3 12l3-2.8 2.2 1.8 2.4-3L13.5 12" />
    </>
  ),
  vector: (
    <>
      <path d="M3.6 11.2C6 5 10 5 12.4 11.2" />
      <rect x="1.7" y="9.8" width="2.6" height="2.6" rx="0.4" />
      <rect x="11.7" y="9.8" width="2.6" height="2.6" rx="0.4" />
      <rect x="6.7" y="2.6" width="2.6" height="2.6" rx="0.4" />
    </>
  ),
  presentation: (
    <>
      <rect x="2.5" y="3" width="11" height="7.4" rx="1" />
      <line x1="8" y1="10.4" x2="8" y2="13" />
      <line x1="5.6" y1="13.4" x2="10.4" y2="13.4" />
    </>
  ),
  archive: (
    <>
      <rect x="2.5" y="3" width="11" height="3" rx="0.8" />
      <path d="M3.6 6v6.2a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V6" />
      <line x1="6.6" y1="8.8" x2="9.4" y2="8.8" />
    </>
  ),
  external: (
    <>
      <path d="M11 8.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3.5" />
      <polyline points="9.5 3 13 3 13 6.5" />
      <line x1="13" y1="3" x2="7.6" y2="8.4" />
    </>
  ),
  share: (
    <>
      <circle cx="4" cy="8" r="1.9" />
      <circle cx="11.6" cy="3.6" r="1.9" />
      <circle cx="11.6" cy="12.4" r="1.9" />
      <line x1="5.7" y1="7" x2="9.9" y2="4.6" />
      <line x1="5.7" y1="9" x2="9.9" y2="11.4" />
    </>
  ),
  pen: (
    <>
      <path d="M3 13l.8-3L10.6 3.2a1.1 1.1 0 0 1 1.6 0l.6.6a1.1 1.1 0 0 1 0 1.6L6 12.2z" />
      <line x1="9.6" y1="4.2" x2="11.8" y2="6.4" />
    </>
  ),
  square: <rect x="3.5" y="3.5" width="9" height="9" rx="1" />,
};

// ⌘K command palette — the mockup's signature surface, wired to real shell
// actions (theme, system view, comments, reload, help, what's new, new board).
// Scoped to shell-doable actions only — in-canvas export lives in the iframe.
function CommandPalette({ open, onClose, actions }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);
  // Keep the keyboard-active row visible while arrowing through a scrolled list.
  useEffect(() => {
    listRef.current
      ?.querySelector('.st-pal-item.is-active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(needle) ||
        (a.group && a.group.toLowerCase().includes(needle))
    );
  }, [q, actions]);
  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);
  if (!open) return null;
  const run = (a) => {
    onClose();
    a.run();
  };
  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="st-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="st-pal-search">
          <StIcon name="search" size={18} />
          <input
            // biome-ignore lint/a11y/noAutofocus: command palette opens on an explicit ⌘K.
            autoFocus
            placeholder="Type a command or search…"
            value={q}
            aria-label="Command search"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered[active]) run(filtered[active]);
              }
            }}
          />
          <Kbd>⌘K</Kbd>
        </div>
        <div className="st-pal-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="st-pal-empty">No matching command.</div>
          ) : (
            filtered.map((a, i) => {
              // Emit a group header when the group changes (flat list → grouped
              // display; keyboard nav still indexes across the whole array).
              const header =
                a.group && (i === 0 || filtered[i - 1].group !== a.group) ? (
                  <div className="st-pal-group" key={'g-' + a.group}>
                    {a.group}
                  </div>
                ) : null;
              return (
                <Fragment key={a.id}>
                  {header}
                  <button
                    type="button"
                    className={'st-pal-item' + (i === active ? ' is-active' : '')}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(a)}
                  >
                    <span className="st-pal-icon">
                      <StIcon name={a.icon} size={15} />
                    </span>
                    <span className="st-pal-label">{a.label}</span>
                    {a.kbd ? (
                      <span className="st-pal-kbd">
                        <Kbd>{a.kbd}</Kbd>
                      </span>
                    ) : null}
                  </button>
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function StIcon({ name, size = 16, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {STICONS[name]}
    </svg>
  );
}

// P3 (Plan C) — menubar presence avatar (matches `.design/ui/Studio.tsx` Avatar).
// Up to two uppercase glyphs from a name; falls back to "?" for empties.
function initialsOf(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  // Single-token names (e.g. a git username "1aGh") → first two chars, so the
  // avatar reads as initials rather than a lone count badge.
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase() || '?';
}
function StAvatar({ initials, hue, title, pulse }) {
  // Hue rides a custom property so CSS can mix it into the surface (DS avatar
  // recipe: tinted bg + hue border + fg-0 text — solid fill + white text broke
  // the accent-fg contrast rule and washed out in light theme). `pulse` plays
  // the DS motion-presence role (scale+opacity ring) — the AI agent's "live"
  // tell while it's editing.
  return (
    <span
      className={'st-avatar' + (pulse ? ' is-pulsing' : '')}
      style={{ '--av-hue': hue }}
      data-tip={title}
      aria-label={title}
    >
      {initials}
    </span>
  );
}

function Kbd({ children }) {
  return <span className="kbd">{children}</span>;
}

// ───────── Resizable panel grip (DS components-resize-panels contract) ─────────
//
// 8px hit area on a 1px seam; grip dots + accent surface on hover/focus/drag;
// pointer drag (with capture, so moves keep arriving over the iframe), arrow-key
// nudge (8px, ⇧=24px), Home/End to min/max, double-click resets to default.
// Width persists per panel in localStorage.

function usePanelSize(storeKey, { min, max, def }) {
  const clamp = useCallback((v) => Math.min(max, Math.max(min, v)), [min, max]);
  const [w, setWRaw] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(storeKey) || '', 10);
      return Number.isFinite(v) ? clamp(v) : def;
    } catch {
      return def;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, String(w));
    } catch {}
  }, [storeKey, w]);
  const setW = useCallback(
    (next) => setWRaw((prev) => clamp(typeof next === 'function' ? next(prev) : next)),
    [clamp]
  );
  return { w, setW, min, max, def };
}

function PanelGrip({ label, size, onPointerDown, active, dir = 'ltr' }) {
  const { w, setW, min, max, def } = size;
  // `dir` is grip-relative: 'ltr' (left panel) → ArrowRight widens; 'rtl'
  // (right dock) → ArrowRight narrows, since the seam moves toward the panel.
  const grow = dir === 'rtl' ? -1 : 1;
  return (
    <div
      className={'st-grip' + (active ? ' is-active' : '')}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(w)}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setW(def)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 8;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setW((v) => v + step * grow);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setW((v) => v - step * grow);
        } else if (e.key === 'Home') {
          e.preventDefault();
          setW(min);
        } else if (e.key === 'End') {
          e.preventDefault();
          setW(max);
        }
      }}
    >
      <svg className="st-grip-dots" viewBox="0 0 6 18" aria-hidden="true">
        <circle cx="3" cy="3" r="1.1" fill="currentColor" />
        <circle cx="3" cy="9" r="1.1" fill="currentColor" />
        <circle cx="3" cy="15" r="1.1" fill="currentColor" />
      </svg>
    </div>
  );
}

// T5 (Plan C) — shell-level Export & Handoff dialog (maude `.st-dialog`), per
// `.design/ui/Studio.tsx` HandoffBoard. Wired to the privileged main-origin
// `POST /_api/export` (7 real formats × scopes). The shadcn card is HANDOFF —
// a privileged disk-write kept off HTTP routes (DDR-054), so it surfaces the
// `/design:handoff` command instead. PPTX/Canva kept reachable (no silent cap).
const EXPORT_CARDS = [
  { id: 'png', label: 'PNG', sub: 'raster · 2×', icon: 'image', format: 'png', options: { scale: 2 } },
  { id: 'pdf', label: 'PDF', sub: 'vector · print', icon: 'file', format: 'pdf' },
  { id: 'svg', label: 'SVG', sub: 'per artboard', icon: 'vector', format: 'svg' },
  { id: 'html', label: 'HTML', sub: 'self-contained', icon: 'code', format: 'html' },
  { id: 'pptx', label: 'PPTX', sub: 'slides', icon: 'presentation', format: 'pptx' },
  // DDR-148 — temporal formats. Shown only when the active canvas has a
  // video-comp (`temporal: true` + the hasComps gate in ExportDialog); the
  // capture engine renders the artboard frame-by-frame.
  { id: 'mp4', label: 'MP4', sub: 'video · H.264', icon: 'presentation', format: 'mp4', temporal: true },
  { id: 'gif', label: 'GIF', sub: 'animated', icon: 'image', format: 'gif', temporal: true },
  { id: 'canva', label: 'Canva', sub: 'handoff bundle', icon: 'external', format: 'canva' },
  { id: 'zip', label: 'ZIP', sub: 'project bundle', icon: 'archive', format: 'zip' },
  { id: 'shadcn', label: 'AI handoff', sub: 'production drop', icon: 'sparkle', handoff: true },
];

// Mirrors export-dialog.tsx (the in-canvas dialog) so both entry points offer
// the same settings. Scope validity + PNG scale presets are ported verbatim.
const EXPORT_SCOPE_LABELS = {
  selection: 'Current selection',
  artboard: 'Active artboard',
  'canvas-as-separate': 'Canvas · artboards separate',
  'project-raw': 'Whole project (raw)',
};
const PNG_SCALES = [
  { value: 1, label: '1× (native)' },
  { value: 2, label: '2× (retina)' },
  { value: 3, label: '3× (max)' },
];

// feature-2-print-artboards T6 — the PNG card's resolution picker folds the
// legacy 1×/2×/3× multiplier and the new physical-DPI ladder (T4) into ONE
// select: `kind:'scale'` entries send `options.scale`, `kind:'dpi'` entries
// send `options.dpi` (exporters/png.ts resolveDeviceScale — dpi wins over
// scale when both could apply). Default stays 2× (unchanged UX for anyone
// not exporting for print).
const PNG_RESOLUTIONS = [
  { id: '1x', label: '1× (native)', kind: 'scale', value: 1 },
  { id: '2x', label: '2× (retina)', kind: 'scale', value: 2 },
  { id: '3x', label: '3× (max)', kind: 'scale', value: 3 },
  { id: 'dpi150', label: '150 dpi', kind: 'dpi', value: 150 },
  { id: 'dpi300', label: '300 dpi (print)', kind: 'dpi', value: 300 },
  { id: 'dpi600', label: '600 dpi (high-res print)', kind: 'dpi', value: 600 },
];
const PNG_RESOLUTION_DEFAULT = '2x';

// feature-2-print-artboards T5/T6 (dogfood follow-up) — the PDF page itself
// is always vector (text/shapes never rasterize), but any RASTER content ON
// the artboard — a dropped photo, a large-format piece authored at a
// fraction of its real physical size (e.g. a billboard at 1:10 scale) —
// still embeds as a bitmap whose density this controls. Default "Auto (1×)"
// is today's unchanged behavior; PDF has no legacy scale concept, so unlike
// PNG_RESOLUTIONS this is DPI-only.
const PDF_DPI_OPTIONS = [
  { id: 'auto', label: 'Auto (1×)', value: undefined },
  { id: 'dpi150', label: '150 dpi', value: 150 },
  { id: 'dpi300', label: '300 dpi (print)', value: 300 },
  { id: 'dpi600', label: '600 dpi (high-res print)', value: 600 },
];
const PDF_DPI_DEFAULT = 'auto';

// issue #116 — how the export treats text. Mirrors export-dialog.tsx's
// PDF_TEXT_OPTIONS (same mirror obligation as PDF_DPI_OPTIONS above).
//
// The list is FIXED regardless of whether Ghostscript is present on this
// machine. Hiding "Convert to outlines" when gs is missing would need a new
// capability route, and would answer the user's question ("can I send this to
// a printer?") by making the answer invisible; a refusal that names the
// one-line install is more honest and reaches them at the moment they care.
const PDF_TEXT_OPTIONS = [
  {
    id: 'keep',
    label: 'Keep selectable (default)',
    description:
      'Text stays selectable and searchable. You are warned if a font came out unprintable.',
  },
  {
    id: 'embed',
    label: 'Verify fonts embedded',
    description:
      'Same file, but the export fails instead of shipping a font a print shop would reject.',
  },
  {
    id: 'outline',
    label: 'Convert to outlines (print-safe)',
    description:
      'Every glyph becomes a vector path — no fonts left to break. Text is no longer selectable ' +
      'and the file can grow a lot. Needs Ghostscript installed locally; cloud workspaces have it.',
  },
];
const PDF_TEXT_DEFAULT = 'keep';

// feature-bulk-media-insert — best-effort MIME guess from a filename extension.
// Only used to classify a natively-picked file (Rust returns `{name, bytes}`,
// no type) for the destination-toggle's image/video/audio split; the actual
// upload is always magic-byte-sniffed server-side, so a wrong guess here
// can't misrepresent what gets stored, only which picker UI state it shows.
const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4', ogg: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', oga: 'audio/ogg', opus: 'audio/opus',
};
function mimeFromExt(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

// feature-element-editing-robustness Stage F1 — AssetPicker. A shell modal that
// lists the versioned content-addressed media under <designRoot>/assets/ (via the
// main-origin-only GET /_api/assets) and lets the user pick one — or upload a new
// file (POST /_api/asset, content-addressed) — for a media Replace / image
// Insert. Thumbnails load from the main origin's designRoot static serve
// (/${designRel}/${asset.path}); never a remote hotlink (the CSP split origin
// blocks those — memory reference_canvas_images_download_first).
function AssetPicker({
  designRel,
  onPick,
  onClose,
  multiple = false,
  hasArtboardAnchor = false,
  onPickMany,
}) {
  const [assets, setAssets] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // feature-bulk-media-insert — multi-select state. `kindByPath` merges the
  // fetched listing with freshly uploaded assets (the upload response carries
  // no `kind`, so a just-uploaded file's kind comes from its own File.type).
  const [selected, setSelected] = useState(() => new Set());
  const [kindByPath, setKindByPath] = useState({});
  const [destination, setDestination] = useState(hasArtboardAnchor ? 'artboard' : 'annotation');

  useEffect(() => {
    let alive = true;
    fetch('/_api/assets')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const list = j.ok ? j.assets : [];
        setAssets(list);
        setKindByPath((prev) => {
          const next = { ...prev };
          for (const a of list) next[a.path] = a.kind;
          return next;
        });
      })
      .catch(() => alive && setAssets([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const hasNonImageSelected = Array.from(selected).some((p) => (kindByPath[p] || 'image') !== 'image');
  const artboardDisabled = !hasArtboardAnchor || hasNonImageSelected;
  const artboardDisabledReason = !hasArtboardAnchor
    ? 'No artboard on this canvas'
    : hasNonImageSelected
      ? 'Video/audio can only be added as annotations'
      : '';
  // Force off "Add to artboard" the moment it becomes unavailable (e.g. a
  // video gets added to an until-now all-image selection).
  useEffect(() => {
    if (artboardDisabled && destination === 'artboard') setDestination('annotation');
  }, [artboardDisabled, destination]);

  const toggleSelected = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Shared upload core — both the single-pick `doUpload` and the multi-file
  // `doUploadMany` post through here, so neither duplicates the request shape.
  const uploadOne = async (f) => {
    const res = await fetch('/_api/asset', {
      method: 'POST',
      headers: { 'content-type': f.type || 'application/octet-stream' },
      body: f,
    });
    const j = await res.json().catch(() => ({}));
    // /_api/asset returns 201 { path } on success — NO `ok` field (the bug: a
    // `j.ok` check always failed → "upload failed" even on a good upload).
    if (res.ok && j.path) return { ok: true, path: j.path };
    return { ok: false, error: j.error || `upload failed (HTTP ${res.status})` };
  };

  const doUpload = async (f) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    const res = await uploadOne(f);
    setBusy(false);
    if (res.ok) onPick(res.path);
    else setErr(res.error);
  };

  const kindOfMime = (mime) => {
    if (typeof mime === 'string' && mime.startsWith('video/')) return 'video';
    if (typeof mime === 'string' && mime.startsWith('audio/')) return 'audio';
    return 'image';
  };

  // Multi-file upload — each file uploads independently/concurrently (the
  // route is idempotent + content-addressed, so no ordering concern); every
  // one that succeeds joins the selection as it resolves.
  const doUploadMany = async (files) => {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    const results = await Promise.all(
      files.map((f) => uploadOne(f).then((r) => ({ ...r, file: f })))
    );
    setBusy(false);
    const ok = results.filter((r) => r.ok);
    const failed = results.length - ok.length;
    if (failed > 0) setErr(`${failed} of ${results.length} uploads failed`);
    if (ok.length) {
      setKindByPath((prev) => {
        const next = { ...prev };
        for (const r of ok) next[r.path] = kindOfMime(r.file.type);
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of ok) next.add(r.path);
        return next;
      });
    }
  };

  // Native desktop (Tauri WKWebView) — an HTML <input type=file> won't present
  // the file panel AT ALL here, so route through the same native-dialog spine
  // export uses (dogfood: "pri exportu to uz umime"). The Rust pick_media_file
  // command opens an OS open-dialog + reads the bytes; we POST them to
  // /_api/asset (magic-byte sniffed, so name/ext aren't trusted).
  const openFilePickerNative = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (multiple) {
        const picked = await pickMediaFiles();
        const files = (picked || []).map(
          (p) => new File([new Uint8Array(p.bytes)], p.name, { type: mimeFromExt(p.name) })
        );
        setBusy(false);
        if (files.length) await doUploadMany(files);
        return;
      }
      const picked = await pickMediaFile();
      if (picked?.bytes) {
        // Blob from the byte array; the server sniffs the type, so no content-type
        // needed. (doUpload sets its own busy=false in finally.)
        await doUpload(new Blob([new Uint8Array(picked.bytes)]));
        return;
      }
    } catch (e) {
      setErr(e?.message || 'open failed');
    }
    setBusy(false); // only reached on cancel / error (doUpload/doUploadMany own the success path)
  };

  // Browser — imperative <input>, mirrors the proven replaceMediaViaPicker
  // pattern (freshly created, appended to document.body, clicked synchronously in
  // the gesture). Off-screen (not display:none) so it lays out.
  const openFilePicker = () => {
    if (isNativeApp()) {
      openFilePickerNative();
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    if (multiple) input.multiple = true;
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    const cleanup = () => {
      if (input.isConnected) input.remove();
    };
    window.addEventListener('focus', () => setTimeout(cleanup, 300), { once: true });
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      if (!files.length) return;
      if (multiple) doUploadMany(files);
      else doUpload(files[0]);
    });
    input.click();
  };

  const assetUrl = (p) => `/${designRel}/${p}`;

  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="st-dialog st-asset-picker" role="dialog" aria-modal="true" aria-label="Choose media">
        <div className="st-dialog-hd">
          <span className="st-dialog-title">Choose media</span>
          <button type="button" className="st-iconbtn" aria-label="Close" onClick={onClose}>
            <StIcon name="x" size={15} />
          </button>
        </div>
        <div className="st-dialog-bd">
          <div className="st-ap-toolbar">
            <button type="button" className="st-btn" onClick={openFilePicker} disabled={busy}>
              {busy ? 'Uploading…' : 'Upload…'}
            </button>
            {err && <span className="st-ap-err">{err}</span>}
          </div>
          <div className="st-ap-grid">
            {assets == null ? (
              <div className="st-ap-empty">Loading…</div>
            ) : assets.length === 0 ? (
              <div className="st-ap-empty">No assets yet — upload one.</div>
            ) : (
              assets.map((a) => {
                const isSelected = multiple && selected.has(a.path);
                return (
                  <button
                    type="button"
                    key={a.path}
                    className="st-ap-cell"
                    data-selected={isSelected ? 'true' : undefined}
                    aria-pressed={multiple ? isSelected : undefined}
                    title={`${a.name} · ${Math.max(1, Math.round(a.size / 1024))} KB`}
                    onClick={() => (multiple ? toggleSelected(a.path) : onPick(a.path))}
                  >
                    {multiple && (
                      <span className="st-ap-check" aria-hidden="true">
                        {isSelected ? <StIcon name="check" size={12} /> : null}
                      </span>
                    )}
                    {a.kind === 'video' ? (
                      <video className="st-ap-thumb" src={assetUrl(a.path)} muted playsInline />
                    ) : (
                      <img className="st-ap-thumb" src={assetUrl(a.path)} alt={a.name} loading="lazy" />
                    )}
                    <span className="st-ap-name">{a.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        {multiple && selected.size > 0 && (
          <div className="st-dialog-ft st-ap-confirm">
            <span className="st-ap-count">{selected.size} selected</span>
            <div className="st-ap-seg" role="radiogroup" aria-label="Insert as">
              <button
                type="button"
                className="st-ap-seg-btn"
                aria-pressed={destination === 'artboard'}
                disabled={artboardDisabled}
                onClick={() => setDestination('artboard')}
              >
                Add to artboard
              </button>
              <button
                type="button"
                className="st-ap-seg-btn"
                aria-pressed={destination === 'annotation'}
                onClick={() => setDestination('annotation')}
              >
                Add as annotation
              </button>
            </div>
            {artboardDisabled && <span className="st-ap-dest-note">{artboardDisabledReason}</span>}
            <span className="st-ap-confirm-spacer" />
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onPickMany?.(Array.from(selected), destination)}
            >
              Insert
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Direct download for a browser-lane capture. export-center's autoDownloadBlob
// fetches a JOB's bytes — a browser capture has no job, just the Blob.
function downloadCapturedBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'export';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a delay — an immediate revoke can race the download start in
  // some engines (the click only queues the fetch of the object URL).
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function ExportDialog({
  mode,
  initialScope,
  activePath,
  hasComps = false,
  comps = [],
  activeArtboardId = null,
  selection = null,
  exportLane = 'local',
  onBrowserCapture = null,
  onClose,
}) {
  // feature-cloud-export-render-workers — on a cell with no render service
  // (`lane === 'none'`), formats that render through a browser are offered
  // disabled-with-a-reason instead of firing a request the proxy 404s. ZIP
  // (JSZip over project files) and the AI-handoff card (clipboard copy) need
  // no browser — and DDR-231's browser lane keeps png/svg live in every
  // workspace lane too (captured by the member's own browser, no service).
  const laneBlocked = useCallback(
    (c) =>
      (exportLane === 'none' &&
        !c.handoff &&
        c.format !== 'zip' &&
        !BROWSER_SERVABLE_FORMATS.has(c.format)) ||
      // Canva bundles project files the render service can't reach — desktop only
      // in every workspace lane (exporters/remote.ts REMOTE_UNSUPPORTED_FORMATS).
      (exportLane !== 'local' && c.format === 'canva'),
    [exportLane]
  );
  const [sel, setSel] = useState(mode === 'handoff' ? 'shadcn' : 'png');
  // DDR-231 Phase 2 T4 — seed from the shared table, and only honour an
  // incoming hint the CHOSEN FORMAT can actually render. A hint the format
  // can't take (a context menu's `project-raw`, a re-run of a zip history
  // entry) used to survive into the request and reach the render service as
  // an unrenderable file-tree target: "invalid render job".
  // The dialog opens on the PNG card; the format-change effect below re-seeds
  // the scope whenever the member picks another one.
  const [scope, setScope] = useState(() =>
    initialScope && isScopeValidForFormat('png', initialScope)
      ? initialScope
      : defaultScopeForFormat('png')
  );
  const [scale, setScale] = useState(2);
  // feature-2-print-artboards T4/T6 — PNG resolution (folds scale + dpi, see
  // PNG_RESOLUTIONS above).
  const [pngResId, setPngResId] = useState(PNG_RESOLUTION_DEFAULT);
  // feature-2-print-artboards T5/T6 — PDF print options. Sent unconditionally
  // on every PDF export; the server no-ops them for a non-print artboard (no
  // `print` JSX prop → applyPrintBoxesAndMarks never runs), so there's no
  // need to detect the artboard's kind client-side before showing these.
  const [pdfIncludeBleed, setPdfIncludeBleed] = useState(true);
  const [pdfMarksOpen, setPdfMarksOpen] = useState(false);
  const [pdfMarksCrop, setPdfMarksCrop] = useState(false);
  const [pdfMarksRegistration, setPdfMarksRegistration] = useState(false);
  const [pdfDpiId, setPdfDpiId] = useState(PDF_DPI_DEFAULT);
  const [pdfTextId, setPdfTextId] = useState(PDF_TEXT_DEFAULT);
  // DDR-148 addendum — mp4/webm of a registered video-comp render through
  // renderMediaOnWeb, which produces real audio (Remotion owns the
  // TransitionSeries/volume-closure timeline). gif has no audio track at all
  // (format limitation, not a toggle), so this only applies to mp4/webm.
  const [audio, setAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg }
  const [recent, setRecent] = useState([]);
  const card = EXPORT_CARDS.find((c) => c.id === sel) || EXPORT_CARDS[0];
  const validScopes = card.handoff ? [] : validScopesForFormat(card.format);
  // Long-comp tiers (feature-enhanced-video-editing Task 1). 900 frames is the
  // safe tier (the frame-step fallback runs ~2.5 s/frame and 1080p captures
  // have died from memory pressure above it); 3600 is the server's default cap
  // (exporters/video.ts DEFAULT_MAX_FRAMES). Above the cap the dialog raises it
  // EXPLICITLY for this export, with the notice below as the informed consent —
  // never a silent truncation, never a surprise refusal.
  const EXPORT_SAFE_FRAMES = 900;
  const EXPORT_DEFAULT_CAP = 3600;
  // The comp being exported — resolved to the artboard this dialog targets, not
  // to whichever comp mounted first (#75). It drives the long-comp consent
  // notice AND `options.maxFrames`, so a wrong pick both misstates the frame
  // count to the user and raises the server-side cap on behalf of a comp that
  // isn't the one leaving the machine.
  const exportComp = activeComp(comps, resolveCompTarget(comps, { artboardId: activeArtboardId }));
  const exportCompFrames = exportComp?.durationInFrames || 0;
  const exportCompFps = exportComp?.fps || 30;
  const exportIsHeavy = card.temporal && exportCompFrames > EXPORT_SAFE_FRAMES;
  const exportOverCap = card.temporal && exportCompFrames > EXPORT_DEFAULT_CAP;

  // Keep the scope valid for the chosen format (pptx/zip etc. only allow a
  // subset). Both dialogs and the server now read one table
  // (exporters/format-scopes.ts) — see DDR-231 Phase 2 T4.
  useEffect(() => {
    if (validScopes.length && !validScopes.includes(scope)) {
      setScope(defaultScopeForFormat(card.format));
    }
  }, [validScopes, scope, card.format]);

  // DDR-231 T7 — wake the render service the moment the dialog opens on a
  // remote-lane workspace: the multi-GB Chromium container starts booting
  // while the member is still picking format/scope, so a video/PDF job lands
  // on a warm (or at least warming) service instead of a cold one.
  useEffect(() => {
    if (exportLane !== 'remote') return;
    fetch('/_api/export-warmup').catch(() => {});
  }, [exportLane]);

  const loadRecent = useCallback(() => {
    fetch('/_api/export-history')
      .then((r) => r.json())
      .then((d) => setRecent(Array.isArray(d?.history) ? d.history.slice(0, 6) : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function doExport() {
    if (card.handoff) {
      const p = activePath && activePath !== SYSTEM_TAB ? activePath : '<canvas>.tsx';
      const cmd = `/design:handoff ${p}`;
      try {
        await navigator.clipboard?.writeText(cmd);
      } catch {}
      setStatus({ ok: true, msg: `Copied: ${cmd} — run it in Claude Code.` });
      return;
    }
    if (laneBlocked(card)) {
      // Belt to the disabled-card braces — a stale selection can't submit a
      // format this workspace cannot render.
      setStatus({ ok: false, msg: 'This format needs the render service, which this workspace doesn’t have configured.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    // `scale` drives video resolution (deviceScaleFactor → encoder dims);
    // temporal formats were previously fixed at the tiny native size. PNG's
    // resolution now comes from pngResId (T4/T6 — scale OR dpi).
    const options = card.temporal ? { scale } : {};
    if (card.format === 'png') {
      const res = PNG_RESOLUTIONS.find((r) => r.id === pngResId) || PNG_RESOLUTIONS[1];
      if (res.kind === 'dpi') options.dpi = res.value;
      else options.scale = res.value;
    }
    // Export-with-audio (DDR-148 addendum) — mp4/webm only; gif is silent by
    // format, so the checkbox never renders for it (see hasAudioToggle below).
    if (card.format === 'mp4' || card.format === 'webm') options.audio = audio;
    // Long-comp cap raise — the visible notice above the button is the consent.
    if (exportOverCap) options.maxFrames = exportCompFrames;
    // feature-2-print-artboards T5/T6 — always sent on a PDF export; the
    // adapter no-ops includeBleed/marks for a non-print artboard (T5).
    if (card.format === 'pdf') {
      options.pdfPrint = {
        includeBleed: pdfIncludeBleed,
        marks: { crop: pdfMarksCrop, registration: pdfMarksRegistration },
      };
      // Dogfood follow-up — raster CONTENT on the artboard (a dropped photo,
      // large-format art) still needs a real capture density; the page
      // itself stays vector regardless of this.
      const pdfDpi = PDF_DPI_OPTIONS.find((d) => d.id === pdfDpiId)?.value;
      if (pdfDpi !== undefined) options.dpi = pdfDpi;
      // issue #116 — omitted for `keep` rather than sent explicitly: the
      // adapter's default IS keep, so an untouched dialog produces the exact
      // request body it did before this feature existed.
      if (pdfTextId !== 'keep') options.text = pdfTextId;
    }
    // Scope targeting hints (resolveScope reads these): `artboardId` makes
    // "Active artboard" export the right screen instead of `:first-of-type`;
    // `selection` makes "Current selection" export the selected element. Mirrors
    // the in-canvas dialog's captureScopeHints.
    if (activeArtboardId) options.artboardId = activeArtboardId;
    if (selection?.selector) options.selection = selection;
    // Which canvas FILE this dialog is exporting — the server's `_active.json`
    // lags a tab switch, and a job resolved against the stale file renders the
    // wrong canvas (with this dialog's artboardId, which then never matches).
    if (activePath && activePath !== SYSTEM_TAB) options.canvasFile = activePath;
    // DDR-231 — the browser lane: in a workspace, png/svg of the active
    // artboard is captured by the member's OWN browser (the canvas already
    // renders here) — instant, no fleet wake. Everything else continues to
    // the jobs lane below.
    // NOTE the format gate. `browserCaptureEligible` answers for the whole
    // browser lane, pptx included — but this branch is the SINGLE-ARTBOARD
    // capture that downloads what the bridge returns verbatim. Without the
    // gate, a pptx export fell in here, asked the bridge for a "pptx" (which it
    // renders as PNG), and died in `sanitizeCapturedItems` on "not a valid
    // pptx" — silently degrading to the worker lane, which is why the deck
    // arrived minutes later with none of the browser lane's fixes in it. The
    // dedicated deck branch below was unreachable. Found by the T7 export E2E.
    const browserEligible =
      BROWSER_CAPTURE_FORMATS.has(card.format) &&
      browserCaptureEligible({
        exportLane,
        format: card.format,
        scope,
        artboardId: options.artboardId,
      }) &&
      typeof onBrowserCapture === 'function';
    if (browserEligible) {
      try {
        const capScale = captureScale(options);
        setStatus({ ok: true, msg: 'Capturing…' });
        const items = await onBrowserCapture({
          format: card.format,
          artboardIds: [options.artboardId],
          scale: capScale,
          onProgress: (current, total) =>
            setStatus({ ok: true, msg: `Capturing ${current}/${total}…` }),
        });
        // Validate before writing to disk — the capture bridge shares a window
        // with tenant TSX, which can forge a reply (DDR-231 security pass, F1):
        // caps count/bytes, sniffs magic, forces name+MIME.
        const safeItems = await sanitizeCapturedItems(items, card.format);
        for (const it of safeItems) downloadCapturedBlob(it.name, it.blob);
        // DDR-231 Phase 2 T6 — the export is DONE and the member should see
        // that, in the dialog and in the ledger. Phase 1 closed the modal the
        // instant the download was handed off, so a browser-lane export left
        // no trace anywhere ("v exports dialog nic nevidim").
        for (const it of safeItems) {
          await recordBrowserExport({ format: card.format, scope, filename: it.name });
        }
        setBusy(false);
        setStatus({
          ok: true,
          msg: `Saved ${safeItems.map((it) => it.name).join(', ')} to your downloads.`,
        });
        return;
      } catch (err) {
        if (exportLane !== 'remote') {
          setStatus({ ok: false, msg: `Capture failed: ${(err && err.message) || err}` });
          setBusy(false);
          return;
        }
        // A render service exists — degrade to the slower jobs lane instead of
        // a dead end (and the fallback keeps the worker path exercised).
      }
    }
    // DDR-231 — the pptx deck: capture every artboard as PNG in THIS browser,
    // compose in-cell (/_api/export-assemble — the zip containment class).
    if (
      browserCaptureEligible({ exportLane, format: card.format, scope }) &&
      card.format === 'pptx' &&
      typeof onBrowserCapture === 'function'
    ) {
      try {
        setStatus({ ok: true, msg: 'Capturing artboards…' });
        const deckName =
          activePath && activePath !== SYSTEM_TAB
            ? basename(activePath).replace(/\.[^.]+$/, '')
            : 'export';
        const { filename, blob } = await captureDeckViaBrowser({
          capture: onBrowserCapture,
          name: deckName,
          onProgress: (current, total) =>
            setStatus({ ok: true, msg: `Capturing ${current}/${total}…` }),
          // Composition happens in-cell AFTER the last capture, and it is not
          // instant for a 10-slide deck. Without this the status sat on
          // "Capturing 10/10…" through the whole assemble step and the deck
          // then appeared out of nowhere — the reported "modal closes, nothing
          // happens, and after a while it downloads by itself".
          onAssemble: () => setStatus({ ok: true, msg: 'Assembling deck…' }),
        });
        downloadCapturedBlob(filename, blob);
        await recordBrowserExport({ format: card.format, scope, filename });
        setBusy(false);
        setStatus({ ok: true, msg: `Saved ${filename} to your downloads.` });
        return;
      } catch (err) {
        if (exportLane !== 'remote') {
          setStatus({ ok: false, msg: `Deck export failed: ${(err && err.message) || err}` });
          setBusy(false);
          return;
        }
        // Render service available — degrade to the jobs lane below.
      }
    }
    if (exportLane === 'none' && BROWSER_CAPTURE_FORMATS.has(card.format)) {
      // Without a render service the browser can only capture what it renders:
      // the active artboard. Other scopes have nowhere to run.
      setStatus({
        ok: false,
        msg: 'Without the render service this workspace exports PNG/SVG of the active artboard only — switch Scope to “Active artboard”, or ask your admin to add maude-render.',
      });
      setBusy(false);
      return;
    }
    try {
      // feature-background-export-notification-center — enqueue and close
      // immediately; the menubar notification center owns status, progress,
      // and completion (download / native Save…) from here on.
      const r = await fetch('/_api/export-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: card.format, scope, options }),
      });
      if (!r.ok) {
        setStatus({ ok: false, msg: (await r.text()) || `Export failed (${r.status})` });
        setBusy(false);
        return;
      }
      onClose();
    } catch (err) {
      setStatus({ ok: false, msg: err && err.message ? err.message : String(err) });
      setBusy(false);
    }
  }

  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="st-dialog" role="dialog" aria-modal="true" aria-label="Export and handoff">
        <div className="st-dialog-hd">
          <span className="st-dialog-title">Export &amp; handoff</span>
          <button type="button" className="st-iconbtn" aria-label="Close" onClick={onClose}>
            <StIcon name="x" size={15} />
          </button>
        </div>
        <div className="st-dialog-bd">
          <div className="st-rp-hd">
            {activePath && activePath !== SYSTEM_TAB
              ? `Format · ${displayName(basename(activePath))}`
              : 'Format'}
          </div>
          <div className="st-fmt-grid">
            {EXPORT_CARDS.filter((c) => !c.temporal || hasComps).map((c) => (
              <button
                type="button"
                key={c.id}
                // Stable hooks for the export E2E harnesses (agent-browser web
                // + desktop-e2e native) — data-testid convention, DDR-231
                // Phase 2 T7/T8.
                data-testid={`export-format-${c.id}`}
                className={'st-fmt' + (c.id === sel ? ' is-on' : '')}
                disabled={laneBlocked(c)}
                title={
                  laneBlocked(c)
                    ? 'Needs the render service — not configured on this workspace'
                    : undefined
                }
                onClick={() => {
                  setSel(c.id);
                  setStatus(null);
                }}
              >
                <StIcon name={c.icon} size={16} />
                <span className="st-fmt-name">{c.label}</span>
                <span className="st-fmt-sub">{c.sub}</span>
              </button>
            ))}
          </div>
          {exportLane === 'none' && (
            <div className="st-dialog-note" data-testid="export-lane-note">
              PNG and SVG of the active artboard — and the PPTX deck — export right
              here in your browser; ZIP and AI handoff work too. PDF, video and other
              multi-artboard exports need the render service, which this workspace
              doesn&apos;t have configured — use the desktop app, or ask your admin to
              add the <code> maude-render</code> service (see the self-hosting docs).
            </div>
          )}
          {!card.handoff && (
            <div className="st-dialog-row">
              <label className="st-dialog-lbl" htmlFor="st-export-scope">
                Scope
              </label>
              <select
                id="st-export-scope"
                data-testid="export-scope"
                className="st-select"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                {validScopes.map((s) => (
                  <option key={s} value={s}>
                    {EXPORT_SCOPE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!card.handoff && card.format === 'png' && (
            <div className="st-dialog-row">
              <label className="st-dialog-lbl" htmlFor="st-export-size">
                Resolution
              </label>
              <select
                id="st-export-size"
                className="st-select"
                value={pngResId}
                onChange={(e) => setPngResId(e.target.value)}
              >
                {PNG_RESOLUTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!card.handoff && card.format === 'png' && (
            <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
              {(() => {
                const res = PNG_RESOLUTIONS.find((r) => r.id === pngResId) || PNG_RESOLUTIONS[1];
                const factor = res.kind === 'dpi' ? res.value / 96 : res.value;
                return `${res.label} ≈ ${Math.round(1440 * factor)}×${Math.round(900 * factor)} for a 1440×900 artboard.`;
              })()}
            </div>
          )}
          {!card.handoff && card.temporal && (
            <div className="st-dialog-row">
              <label className="st-dialog-lbl" htmlFor="st-export-temporal-size">
                Resolution
              </label>
              <select
                id="st-export-temporal-size"
                className="st-select"
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              >
                {PNG_SCALES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!card.handoff && card.temporal && (
            <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
              {scale}× the artboard's native resolution (e.g. 960×540 → {960 * scale}×{540 * scale}).
            </div>
          )}
          {exportIsHeavy && (
            <div
              className="st-mono st-export-long-notice"
              data-testid="export-long-comp-notice"
              style={{ fontSize: 11, color: 'var(--accent)', lineHeight: 1.5 }}
            >
              ⚠ Long comp: {exportCompFrames} frames (≈
              {Math.round(exportCompFrames / exportCompFps)}s).
              {exportOverCap
                ? ` Exceeds the default ${EXPORT_DEFAULT_CAP}-frame export cap — exporting raises the cap to the full length for this run.`
                : ''}{' '}
              If the fast renderer falls back to frame-by-frame capture this can take several
              minutes; 2× resolution (≈720–1080p) is recommended for memory headroom.
            </div>
          )}
          {!card.handoff && card.format === 'pdf' && (
            <>
              <div className="st-dialog-row">
                <label className="st-dialog-lbl" htmlFor="st-export-pdf-dpi">
                  Image quality
                </label>
                <select
                  id="st-export-pdf-dpi"
                  className="st-select"
                  value={pdfDpiId}
                  onChange={(e) => setPdfDpiId(e.target.value)}
                >
                  {PDF_DPI_OPTIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                The page stays vector; this only sets the capture density for raster content on it
                (dropped photos, large-format art).
              </div>
              <div className="st-dialog-row">
                <label className="st-dialog-lbl" htmlFor="st-export-pdf-text">
                  Text
                </label>
                <select
                  id="st-export-pdf-text"
                  className="st-select"
                  data-testid="export-pdf-text"
                  value={pdfTextId}
                  onChange={(e) => setPdfTextId(e.target.value)}
                >
                  {PDF_TEXT_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                {PDF_TEXT_OPTIONS.find((t) => t.id === pdfTextId)?.description}
              </div>
              <div className="st-dialog-row">
                <label
                  className="st-dialog-lbl"
                  htmlFor="st-export-pdf-bleed"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                >
                  <input
                    id="st-export-pdf-bleed"
                    type="checkbox"
                    checked={pdfIncludeBleed}
                    onChange={(e) => setPdfIncludeBleed(e.target.checked)}
                  />
                  Include bleed
                </label>
              </div>
              <div className="st-dialog-row">
                <button
                  type="button"
                  className="st-dialog-lbl"
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                  onClick={() => setPdfMarksOpen((v) => !v)}
                  aria-expanded={pdfMarksOpen}
                >
                  {pdfMarksOpen ? '▾' : '▸'} Marks
                </button>
              </div>
              {pdfMarksOpen && (
                <div style={{ padding: '0 12px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={pdfMarksCrop}
                      onChange={(e) => setPdfMarksCrop(e.target.checked)}
                    />
                    Crop marks
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={pdfMarksRegistration}
                      onChange={(e) => setPdfMarksRegistration(e.target.checked)}
                    />
                    Registration marks
                  </label>
                </div>
              )}
              <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                Bleed and marks apply to print (<code>kind="print"</code>) artboards only.
                {scope === 'canvas-as-separate' ? ' One PDF page per artboard.' : ''}
              </div>
            </>
          )}
          {!card.handoff && (card.format === 'mp4' || card.format === 'webm') && (
            <div className="st-dialog-row">
              <label
                className="st-dialog-lbl"
                htmlFor="st-export-audio"
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <input
                  id="st-export-audio"
                  type="checkbox"
                  checked={audio}
                  onChange={(e) => setAudio(e.target.checked)}
                />
                Export with audio
              </label>
            </div>
          )}
          {card.handoff && (
            <div className="callout callout--info" style={{ fontSize: 12 }}>
              Hands the active canvas off to production. Copies{' '}
              <span className="st-mono">/design:handoff &lt;path&gt;</span> — run it in Claude Code to
              emit a ready-to-drop production component next to the canvas.
            </div>
          )}
          {status && (
            <div
              className={'callout ' + (status.ok ? 'callout--success' : 'callout--error')}
              style={{ fontSize: 12 }}
              data-testid="export-status"
              data-ok={status.ok ? '1' : '0'}
            >
              {status.msg}
            </div>
          )}
          {recent.length > 0 && (
            <div className="st-export-recent" data-testid="export-recent">
              <div className="st-rp-hd">Recent</div>
              {recent.map((h, i) => (
                <div className="st-export-recent-row" key={i}>
                  <span>
                    {String(h.format || '').toUpperCase()} ·{' '}
                    {EXPORT_SCOPE_LABELS[h.scope] || h.scope}
                  </span>
                  <span className="st-mono">{h.filename}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="st-dialog-ft">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="export-submit"
            disabled={busy}
            onClick={doExport}
          >
            <StIcon name="download" size={14} />
            {card.handoff
              ? 'Copy handoff command'
              : busy
                ? 'Exporting…'
                : `Export ${card.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───── Tree (CV-08 spec) ─────
// File rows use `.tp-row` with optional .dir / .sel / .star / .modified
// modifiers + a leading `.glyph` (▾ open dir, ▸ closed dir / selected file,
// · file). Section headers use `.tp-section-hd` with a `.pill` counter.
// The flat-row model (vs the old nested <details>) mirrors the mock and
// keeps padding-left under explicit control per depth level.

const TREE_INDENT_BASE = 12;
const TREE_INDENT_STEP = 16;

function DirRow({ name, depth, defaultOpen, children, dirPath, drag, menu }) {
  const [open, setOpen] = useState(defaultOpen);
  // feature-file-tree-drag-drop-folders (Task 8) — a folder row IS the drop
  // target. `drag` is undefined for groups that can't accept a move (the
  // design-system group) — no handlers attach there, so the browser's default
  // "no drop" cursor applies with zero extra code. Spring-load reopens a
  // closed folder after a sustained hover; `setOpen` is this row's OWN local
  // state, which is why the callback lives here rather than in the hook.
  const dropHandlers = drag ? drag.dropProps(dirPath, true, () => setOpen(true)) : {};
  const isOver = drag?.overDir === dirPath;
  // feature-file-tree-drag-drop-folders (Task 11) — a folder is ALSO a drag
  // SOURCE (drag folder onto folder). No client-side branching needed beyond
  // this: the payload is just `dirPath` (no `.tsx` suffix), and the server's
  // moveCanvas auto-detects a non-.tsx source as a folder move.
  const dragHandlers = drag ? drag.dragProps(dirPath, true) : {};
  const isDragging = drag?.draggedPath === dirPath;
  const isBusy = drag?.busyPath === dirPath;
  const row = (
    <button
      type="button"
      role="treeitem"
      data-testid={`tree-folder-${pathTestIdSlug(dirPath)}`}
      aria-expanded={open}
      aria-dropeffect={drag ? 'move' : undefined}
      aria-busy={isBusy || undefined}
      tabIndex={-1}
      className={
        'st-row' +
        (isOver ? ' is-drop-target' : '') +
        (isDragging ? ' is-dragging' : '') +
        (isBusy ? ' is-busy' : '')
      }
      style={{ paddingLeft: TREE_INDENT_BASE + depth * TREE_INDENT_STEP + 'px' }}
      onClick={() => setOpen((v) => !v)}
      onContextMenu={menu ? (e) => menu.openAt(e, { kind: 'dir', dirPath }) : undefined}
      {...dragHandlers}
      {...dropHandlers}
    >
      <span className="st-row-glyph">
        <StIcon name="chevron-right" className={'st-chev' + (open ? ' is-open' : '')} size={13} />
      </span>
      <span className="st-row-name">{name}</span>
    </button>
  );
  return (
    <Fragment>
      {menu ? (
        <div className="st-row-wrap" role="none">
          {row}
          <button
            type="button"
            className="st-row-menu-btn"
            data-testid={`tree-row-menu-${pathTestIdSlug(dirPath)}`}
            title={`Folder actions — ${name}`}
            aria-label={`Folder actions for ${name}`}
            aria-haspopup="menu"
            onClick={(e) => menu.openAt(e, { kind: 'dir', dirPath })}
          >
            <Icon d="M12 6a1 1 0 100-2 1 1 0 000 2zM12 13a1 1 0 100-2 1 1 0 000 2zM12 20a1 1 0 100-2 1 1 0 000 2z" size={12} />
          </button>
        </div>
      ) : (
        row
      )}
      {open && children}
    </Fragment>
  );
}

// DsFolderRow — a per-DS folder inside the DESIGN SYSTEM section.
// Split target: chevron toggles disclosure of the folder's contents; clicking
// the folder name opens the SystemView focused on that DS (single SystemView
// for now; the dsName is plumbed through so a future per-DS view can use it).
function DsFolderRow({ name, dsName, depth, defaultOpen, active, onOpenSystem, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Fragment>
      <div
        className={'st-row st-ds-folder' + (active ? ' is-sel' : '')}
        style={{ paddingLeft: TREE_INDENT_BASE + depth * TREE_INDENT_STEP + 'px' }}
        role="treeitem"
        aria-expanded={open}
      >
        <button
          type="button"
          className="st-ds-chev"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Collapse design system' : 'Expand design system'}
          title={open ? 'Collapse' : 'Expand'}
        >
          <StIcon name="chevron-right" className={'st-chev' + (open ? ' is-open' : '')} size={13} />
        </button>
        <button
          type="button"
          className="st-ds-open"
          onClick={() => onOpenSystem(dsName)}
          aria-label={`Open ${dsName} design system view`}
          title="Open the design system view"
        >
          <span className="st-row-glyph">
            <StIcon name="folder" size={13} />
          </span>
          <span className="st-row-name">{name}</span>
        </button>
      </div>
      {open && children}
    </Fragment>
  );
}

function FileRow({
  file,
  activePath,
  previewPath,
  onOpen,
  onPreview,
  onDelete,
  openCount: oc,
  depth,
  kind,
  sidecar,
  dirty,
  experimentalKind,
  drag,
  menu,
}) {
  // feature-studio-file-preview (a11y fix) — a previewed row must expose
  // aria-selected too, or a screen-reader user gets no confirmation their
  // click did anything (a11y-auditor finding: state never changed).
  const isSel = file.path === activePath || file.path === previewPath;
  const isCanvas = CANVAS_EXT_RE.test(file.name);
  // feature-studio-file-preview — RUNTIME rows (_active.json, _server.json, …)
  // stay inert no matter their extension: they're gitignored process state,
  // never user-facing content, and must not become previewable just because
  // `.json` also matches the `text` preview kind (DDR-115 exclusion).
  const pKind = !isCanvas && kind !== 'runtime' ? previewKind(file.name) : null;
  // Non-canvas, non-previewable rows (RUNTIME files, unrecognized extensions)
  // are display-only — clicking them doesn't open anything; we leave the
  // click as no-op + cursor hint via `aria-disabled`.
  const inert = !isCanvas && !pKind;
  const label = isCanvas ? displayName(file.name) : file.name;
  // Delete only real canvases in a deletable group (onDelete is undefined for the
  // DS group + runtime files); the server enforces the rest.
  const canDelete = isCanvas && typeof onDelete === 'function' && kind !== 'runtime';
  // feature-file-tree-drag-drop-folders (Task 8) — only real canvas primaries
  // (never sidecars, never runtime rows) are draggable; `drag` is undefined
  // for groups that can't be a move source (the design-system group).
  const draggableRow = isCanvas && !sidecar && kind !== 'runtime' && typeof drag !== 'undefined';
  const dragHandlers = draggableRow ? drag.dragProps(file.path, true) : {};
  const isDragging = drag?.draggedPath === file.path;
  const isBusy = drag?.busyPath === file.path;
  // feature-file-tree-drag-drop-folders (Task 9) — the KEYBOARD path for
  // "Move to…" (drag-only fails WCAG 2.1.1). Same eligibility as dragging.
  const canMove = draggableRow && typeof menu !== 'undefined';
  const fileDir = file.path.split('/').slice(0, -1).join('/');
  // Stable hook for the desktop E2E harness (data-testid convention — see the
  // `desktop-e2e` skill): canvas rows only, slug derived from the relative path
  // (e.g. `ui/Smoke.tsx` → `canvas-row-ui-smoke`).
  const testId = isCanvas
    ? 'canvas-row-' +
      file.path
        .replace(/^\.[^/]+\//, '') // strip the leading designRoot dot-folder (.design/)
        .replace(CANVAS_EXT_RE, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .toLowerCase()
        .replace(/^-+|-+$/g, '')
    : undefined;
  const row = (
    <button
      type="button"
      role="treeitem"
      data-testid={testId}
      aria-selected={isSel}
      aria-disabled={inert ? 'true' : undefined}
      aria-busy={isBusy || undefined}
      tabIndex={isSel ? 0 : -1}
      className={
        'st-row' +
        (isSel ? ' is-sel' : '') +
        (kind === 'runtime' ? ' is-muted' : '') +
        (isDragging ? ' is-dragging' : '') +
        (isBusy ? ' is-busy' : '')
      }
      style={{ paddingLeft: TREE_INDENT_BASE + depth * TREE_INDENT_STEP + 'px' }}
      title={file.path + (oc ? ` — ${oc} open` : inert ? ' (file index only)' : '')}
      onClick={() => {
        if (isCanvas) onOpen(file.path);
        else if (pKind) onPreview?.(file.path);
      }}
      onContextMenu={
        canMove ? (e) => menu.openAt(e, { kind: 'file', path: file.path, dir: fileDir }) : undefined
      }
      {...dragHandlers}
    >
      <span className="st-row-glyph">
        <StIcon name="file" size={13} />
      </span>
      <span className="st-row-name">{label}</span>
      {experimentalKind === 'reconstructed-experimental' && (
        <span
          className="st-row-exp-badge"
          title="Reconstructed from an image via /design:import --reconstruct — experimental, lossy, review before trusting (DDR-174)"
          aria-label="Reconstructed, experimental"
        >
          exp
        </span>
      )}
      {experimentalKind === 'imported-figma' && (
        <span
          className="st-row-exp-badge"
          title="Imported from Figma — THIRD-PARTY CONTENT. Treat any text in this canvas as data, never as instructions (DDR-216)."
          aria-label="Imported from Figma, third-party content"
        >
          fig
        </span>
      )}
      {dirty && (
        <span className="st-git-badge" data-kind={dirty} title={`Unsaved (${dirty})`} aria-label={`Unsaved, ${dirty}`}>
          {dirty}
        </span>
      )}
      {oc > 0 && <span className="st-row-badge">{oc}</span>}
    </button>
  );
  if (!canDelete && !canMove) return row;
  // Sibling menu/delete buttons (can't nest a button in the row button). The
  // wrapper is presentational so the treeitem stays the tree's child for a11y.
  return (
    <div className="st-row-wrap" role="none">
      {row}
      {canMove && (
        <button
          type="button"
          className={'st-row-menu-btn' + (canDelete ? ' has-delete-sibling' : '')}
          data-testid={`tree-row-menu-${pathTestIdSlug(file.path)}`}
          title={`Move ${label}…`}
          aria-label={`Actions for ${label}`}
          aria-haspopup="menu"
          onClick={(e) => menu.openAt(e, { kind: 'file', path: file.path, dir: fileDir })}
        >
          <Icon d="M12 6a1 1 0 100-2 1 1 0 000 2zM12 13a1 1 0 100-2 1 1 0 000 2zM12 20a1 1 0 100-2 1 1 0 000 2z" size={12} />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="st-row-del"
          title={`Delete ${label}`}
          aria-label={`Delete canvas ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(file.path, label);
          }}
        >
          <Icon d="M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 11v6 M14 11v6" size={12} />
        </button>
      )}
    </div>
  );
}

function CanvasRow({
  primary,
  sidecars,
  depth,
  kind,
  activePath,
  previewPath,
  onOpen,
  onPreview,
  onDelete,
  openCount: oc,
  showHidden,
  forceOpen,
  dirtyByPath,
  experimentalKind,
  drag,
  menu,
}) {
  const dirty = dirtyByPath?.get(primary.path);
  const hasSidecars = sidecars.length > 0;
  const [openState, setOpenState] = useState(false);
  // Sidecars are only revealed when the user opts in via `showHidden` — the
  // chevron itself only appears in that mode. When `forceOpen` is true (search
  // match in a sidecar), override local state so the user sees the hit.
  const open = forceOpen || openState;
  const isSel = primary.path === activePath;
  const showChevron = hasSidecars && showHidden;
  if (!showChevron) {
    return (
      <FileRow
        file={primary}
        activePath={activePath}
        previewPath={previewPath}
        onOpen={onOpen}
        onPreview={onPreview}
        onDelete={onDelete}
        openCount={oc}
        depth={depth}
        kind={kind}
        dirty={dirty}
        experimentalKind={experimentalKind}
        drag={drag}
        menu={menu}
      />
    );
  }
  const draggableRow = typeof drag !== 'undefined';
  const dragHandlers = draggableRow ? drag.dragProps(primary.path, true) : {};
  const isDragging = drag?.draggedPath === primary.path;
  const isBusy = drag?.busyPath === primary.path;
  const canMove = draggableRow && typeof menu !== 'undefined';
  const primaryDir = primary.path.split('/').slice(0, -1).join('/');
  const row = (
    <button
      type="button"
      role="treeitem"
      aria-selected={isSel}
      aria-expanded={open}
      aria-busy={isBusy || undefined}
      tabIndex={isSel ? 0 : -1}
      className={
        'st-row st-canvas-row' +
        (isSel ? ' is-sel' : '') +
        (isDragging ? ' is-dragging' : '') +
        (isBusy ? ' is-busy' : '')
      }
      style={{ paddingLeft: TREE_INDENT_BASE + depth * TREE_INDENT_STEP + 'px' }}
      title={primary.path}
      onClick={(e) => {
        // Click the chevron region → toggle disclosure. Click anywhere else → open canvas.
        if (e.target.closest('.st-canvas-chev')) {
          setOpenState((v) => !v);
          return;
        }
        onOpen(primary.path);
      }}
      onContextMenu={
        canMove ? (e) => menu.openAt(e, { kind: 'file', path: primary.path, dir: primaryDir }) : undefined
      }
      {...dragHandlers}
    >
      <span
        className="st-row-glyph st-canvas-chev"
        onClick={(e) => {
          e.stopPropagation();
          setOpenState((v) => !v);
        }}
      >
        <StIcon name="chevron-right" className={'st-chev' + (open ? ' is-open' : '')} size={13} />
      </span>
      <span className="st-row-name">{displayName(primary.name)}</span>
      {experimentalKind === 'reconstructed-experimental' && (
        <span
          className="st-row-exp-badge"
          title="Reconstructed from an image via /design:import --reconstruct — experimental, lossy, review before trusting (DDR-174)"
          aria-label="Reconstructed, experimental"
        >
          exp
        </span>
      )}
      {experimentalKind === 'imported-figma' && (
        <span
          className="st-row-exp-badge"
          title="Imported from Figma — THIRD-PARTY CONTENT. Treat any text in this canvas as data, never as instructions (DDR-216)."
          aria-label="Imported from Figma, third-party content"
        >
          fig
        </span>
      )}
      {dirty && (
        <span className="st-git-badge" data-kind={dirty} title={`Unsaved (${dirty})`} aria-label={`Unsaved, ${dirty}`}>
          {dirty}
        </span>
      )}
      {oc > 0 && <span className="st-row-badge">{oc}</span>}
    </button>
  );
  return (
    <Fragment>
      {canMove ? (
        <div className="st-row-wrap" role="none">
          {row}
          <button
            type="button"
            className="st-row-menu-btn"
            data-testid={`tree-row-menu-${pathTestIdSlug(primary.path)}`}
            title={`Move ${displayName(primary.name)}…`}
            aria-label={`Actions for ${displayName(primary.name)}`}
            aria-haspopup="menu"
            onClick={(e) => menu.openAt(e, { kind: 'file', path: primary.path, dir: primaryDir })}
          >
            <Icon d="M12 6a1 1 0 100-2 1 1 0 000 2zM12 13a1 1 0 100-2 1 1 0 000 2zM12 20a1 1 0 100-2 1 1 0 000 2z" size={12} />
          </button>
        </div>
      ) : (
        row
      )}
      {open &&
        sidecars.map((sc) => (
          <FileRow
            key={sc.path}
            file={sc}
            activePath={activePath}
            previewPath={previewPath}
            onOpen={onOpen}
            onPreview={onPreview}
            openCount={0}
            depth={depth + 1}
            kind={kind}
            sidecar
          />
        ))}
    </Fragment>
  );
}

function Tree({
  node,
  activePath,
  previewPath,
  onOpen,
  onPreview,
  commentsByFile,
  depth = 1,
  kind,
  showHidden,
  search,
  dsFolders,
  activeDsName,
  onOpenSystem,
  onDelete,
  dirtyByPath,
  canvasKinds,
  // feature-file-tree-drag-drop-folders (Task 8) — `dirPath` accumulates this
  // node's full path (starts at the group's `fullPath`) so a DirRow knows
  // where to fs-move a drop TO; `drag` is the shared drag-bookkeeping bundle
  // from useTreeDrag, undefined for groups that can't participate (DS).
  dirPath = '',
  drag,
  // feature-file-tree-drag-drop-folders (Task 9) — the shared row-menu
  // instance (useRowMenu()), undefined for groups that can't participate.
  menu,
}) {
  const dirs = Object.keys(node)
    .filter((k) => k !== '_files')
    .sort();
  const files = node._files || [];
  // VS Code-style sidecar grouping. Canvas (`.tsx`/`.html`) becomes the primary
  // row; same-basename non-canvas files (`.meta.json`, `.css`, …) collapse
  // under it. Meta/doc orphans (README.md, tokens.css, …) surface only when
  // `showHidden` is on; media/asset orphans (images, fonts, video, audio —
  // feature-studio-file-preview) are content the user asked to see by
  // default, not sidecar noise, so they always render.
  const { canvases, orphans } = useMemo(() => groupBySidecar(files), [files]);
  const { mediaOrphans, metaOrphans } = useMemo(() => {
    const media = [];
    const meta = [];
    for (const entry of orphans) {
      const k = previewKind(entry.primary.name);
      (k === 'image' || k === 'video' || k === 'audio' || k === 'font' ? media : meta).push(entry);
    }
    return { mediaOrphans: media, metaOrphans: meta };
  }, [orphans]);
  const hasSearch = !!(search && search.trim());
  // DS-folder lookup: only meaningful at the top level of a DS group. The
  // server emits `dsFolders: [{name, folder}, ...]` so the client knows which
  // dir at depth=1 corresponds to a DS root (click → open SystemView).
  const dsFolderByName = useMemo(() => {
    if (!dsFolders || depth !== 1) return null;
    const m = new Map();
    for (const f of dsFolders) m.set(f.folder, f);
    return m;
  }, [dsFolders, depth]);
  return (
    <Fragment>
      {canvases.map((entry) => {
        const forceOpen =
          hasSearch &&
          entry.sidecars.some((sc) => {
            const q = search.toLowerCase();
            return sc.name.toLowerCase().includes(q) || sc.path.toLowerCase().includes(q);
          });
        return (
          <CanvasRow
            key={entry.primary.path}
            primary={entry.primary}
            sidecars={entry.sidecars}
            activePath={activePath}
            previewPath={previewPath}
            onOpen={onOpen}
            onPreview={onPreview}
            onDelete={onDelete}
            openCount={openCount(commentsByFile[entry.primary.path])}
            depth={depth}
            kind={kind}
            showHidden={showHidden}
            forceOpen={forceOpen}
            dirtyByPath={dirtyByPath}
            experimentalKind={canvasKinds?.[entry.primary.path]}
            drag={drag}
            menu={menu}
          />
        );
      })}
      {mediaOrphans.map((entry) => (
        <FileRow
          key={entry.primary.path}
          file={entry.primary}
          activePath={activePath}
          previewPath={previewPath}
          onOpen={onOpen}
          onPreview={onPreview}
          openCount={openCount(commentsByFile[entry.primary.path])}
          depth={depth}
          kind={kind}
        />
      ))}
      {showHidden &&
        metaOrphans.map((entry) => (
          <FileRow
            key={entry.primary.path}
            file={entry.primary}
            activePath={activePath}
            previewPath={previewPath}
            onOpen={onOpen}
            onPreview={onPreview}
            openCount={openCount(commentsByFile[entry.primary.path])}
            depth={depth}
            kind={kind}
          />
        ))}
      {/* orphans are sidecars/loose files — no canvas to delete, so no onDelete/drag */}
      {dirs.map((d) => {
        const dsMatch = dsFolderByName?.get(d);
        const childPath = dirPath ? `${dirPath}/${d}` : d;
        const childTree = (
          <Tree
            node={node[d]}
            activePath={activePath}
            previewPath={previewPath}
            onOpen={onOpen}
            onPreview={onPreview}
            commentsByFile={commentsByFile}
            depth={depth + 1}
            kind={kind}
            showHidden={showHidden}
            search={search}
            activeDsName={activeDsName}
            onOpenSystem={onOpenSystem}
            onDelete={onDelete}
            dirtyByPath={dirtyByPath}
            canvasKinds={canvasKinds}
            dirPath={childPath}
            drag={drag}
            menu={menu}
          />
        );
        if (dsMatch && onOpenSystem) {
          return (
            <DsFolderRow
              key={d}
              name={d}
              dsName={dsMatch.name}
              depth={depth}
              defaultOpen={true}
              active={activePath === SYSTEM_TAB && dsMatch.name === activeDsName}
              onOpenSystem={onOpenSystem}
            >
              {childTree}
            </DsFolderRow>
          );
        }
        return (
          <DirRow
            key={d}
            name={d}
            depth={depth}
            defaultOpen={true}
            dirPath={childPath}
            drag={drag}
            menu={menu}
          >
            {childTree}
          </DirRow>
        );
      })}
    </Fragment>
  );
}

// CV-08 section labels — title + optional SKU pill. The pill carries
// project / DS identity; the mock keeps these tight (1 line). Labels are
// keyed by the server-provided `kind` (PROJECT / DS / UI / RUNTIME).
const SECTION_META = {
  project: { title: 'PROJECT', pillFromCount: false },
  // Design-system group: pill shows the number of DSes (one row per DS folder
  // inside). Computed in Sidebar from `g.dsFolders.length`.
  ds: { title: 'DESIGN SYSTEM', pillFromDsCount: true },
  canvas: { title: 'UI CANVASES', pillFromCount: true },
  runtime: { title: 'RUNTIME · GITIGNORED', pillFromCount: true },
};

function sectionMetaFor(g) {
  if (g.kind === 'project') return SECTION_META.project;
  if (g.kind === 'runtime') return SECTION_META.runtime;
  // canvas-kind groups: "Design system" → ds, anything else → canvas label
  if (g.label === 'Design system') return SECTION_META.ds;
  if (g.label === 'UI kit') return SECTION_META.canvas;
  return { title: g.label.toUpperCase(), pillFromCount: true };
}

function Sidebar({
  // Cloud Phase 25 C2 — viewer role: create / delete / move / rename
  // affordances are absent (buttons, composer, row menus, drag & drop).
  readOnly = false,
  /** `{ dashboardUrl?, projectName }` when this is a cloud tab, else null. */
  // Tri-state (see the note where this value is created): `undefined` until
  // the server config answers, `null` for the desktop, an object for a cloud
  // tab. Defaulting it to `null` here is what re-broke the boot 404 after the
  // call sites were fixed — a default fires on `undefined`, so "not known yet"
  // became "not cloud" one layer further in, invisibly.
  cloud,
  groups,
  activePath,
  previewPath,
  activeDsName,
  onOpen,
  onPreview,
  onOpenSystem,
  wsConnected,
  search,
  setSearch,
  commentsByFile,
  showHidden,
  sectionsExpanded,
  onToggleSection,
  onNewBoard,
  onDeleteBoard,
  onRefresh,
  refreshing,
  collapsed,
  onCollapse,
  width,
  resizing,
  dirtyByPath,
  project,
  gitBranch,
  remoteSync,
  onGetLatest,
  canvasKinds,
  onMoveCanvas,
  onNewFolder,
  onDeleteFolder,
  // Passed through to CloudBar only — the live `sync:status` payload that makes
  // the connect note follow the link instead of freezing at attach time.
  syncStatus,
  // Passed through to CloudBar only — lifts linkedHub changes to the app shell
  // so the GitPanel's cloud-managed posture (DDR-218) reacts live.
  onLinkedHub,
  // feature-cloud-managed-git-posture — the widened DDR-218 gate, resolved once
  // in App and handed down. Withdraws the drafts switcher: a local branch
  // switch moves a HEAD the cell knows nothing about.
  savingIsManaged = false,
}) {
  const filteredGroups = useMemo(() => {
    if (!search) return groups;
    return groups.map((g) => ({ ...g, tree: filterTree(g.tree, search), filtered: !!search }));
  }, [groups, search]);

  // feature-file-tree-drag-drop-folders (Task 8) — one drag-bookkeeping
  // instance shared by every group's Tree; `onMoveCanvas` does the actual
  // fetch + tree refresh (App-level, alongside createBoard/deleteBoard).
  const treeDrag = useTreeDrag(onMoveCanvas);

  // feature-file-tree-drag-drop-folders (Task 9) — the keyboard path. One
  // shared row-menu instance (only one row's menu is ever open); every
  // non-DS canvas group folder (incl. each group's own root) is a valid
  // "Move to…" destination.
  const rowMenu = useRowMenu();
  const destinations = useMemo(() => {
    const out = [];
    for (const g of groups) {
      if (g.label === 'Design system' || g.kind !== 'canvas') continue;
      const rootLabel = g.fullPath.replace(/^\.[^/]+\//, '') || g.fullPath;
      out.push({ path: g.fullPath, label: rootLabel });
      for (const d of g.dirs || []) {
        out.push({ path: d, label: d.replace(/^\.[^/]+\//, '') });
      }
    }
    return out;
  }, [groups]);
  const menuExtra = rowMenu.state?.extra;
  const rowMenuRootItems =
    menuExtra?.kind === 'file'
      ? [{ id: 'move-to', label: 'Move to…', onSelect: () => rowMenu.showMoveTo() }]
      : menuExtra?.kind === 'dir'
        ? [
            {
              id: 'new-folder-here',
              label: 'New folder here',
              onSelect: () => {
                rowMenu.close();
                const name = window.prompt('New folder name:');
                if (name?.trim()) onNewFolder(menuExtra.dirPath, name.trim());
              },
            },
            {
              id: 'delete-folder',
              label: 'Delete folder',
              destructive: true,
              onSelect: () => {
                rowMenu.close();
                onDeleteFolder(menuExtra.dirPath, menuExtra.dirPath.split('/').pop());
              },
            },
          ]
        : [];
  const rowMenuDestinations =
    menuExtra?.kind === 'file'
      ? destinations.filter((d) => d.path !== menuExtra.dir)
      : [];

  // Phase 22 — inline "new brief board" composer in the tree header. Click +,
  // type a name, Enter to create (Esc cancels). The board opens active so it's
  // ready to annotate; generation (ingest) still goes through /design:new.
  // feature-file-tree-drag-drop-folders (Task 12) — the SAME composer, in
  // 'folder' mode, backs the header "New folder" button — the plan's
  // InlineComposer intent (one composer, two submit paths) without a full
  // component extraction: `composerMode` picks the placeholder + handler.
  const [creating, setCreating] = useState(false);
  const [composerMode, setComposerMode] = useState('board');
  const [newName, setNewName] = useState('');
  const [newErr, setNewErr] = useState('');
  const [newBusy, setNewBusy] = useState(false);

  // Default folder-creation target: the first non-DS canvas group's root
  // (mirrors the server's own `newCanvasDir` default for board creation).
  const defaultFolderParent = useMemo(
    () => groups.find((g) => g.kind === 'canvas' && g.label !== 'Design system')?.fullPath,
    [groups]
  );

  const submitComposer = useCallback(async () => {
    const name = newName.trim();
    if (!name || newBusy) return;
    setNewBusy(true);
    setNewErr('');
    if (composerMode === 'folder') {
      if (!defaultFolderParent) {
        setNewBusy(false);
        setNewErr('no canvas group to create a folder in');
        return;
      }
      const res = await onNewFolder(defaultFolderParent, name);
      setNewBusy(false);
      if (res?.ok) {
        setCreating(false);
        setNewName('');
      } else {
        setNewErr(res?.error || 'could not create folder');
      }
      return;
    }
    const res = await onNewBoard(name);
    setNewBusy(false);
    if (res?.ok) {
      setCreating(false);
      setNewName('');
    } else {
      setNewErr(res?.error || 'could not create board');
    }
  }, [newName, newBusy, onNewBoard, onNewFolder, composerMode, defaultFolderParent]);

  // Mock uses `42 / 42` — total openable canvases, not every listed file.
  // We count canvas files (TSX Phase 3.6+ default, HTML legacy) so the counter
  // matches "canvases you can mount".
  const htmlCount = useMemo(() => {
    let total = 0;
    for (const g of groups) for (const p of g.paths || []) if (CANVAS_EXT_RE.test(p)) total++;
    return total;
  }, [groups]);
  const htmlShown = useMemo(() => {
    let total = 0;
    for (const g of filteredGroups)
      for (const p of g.paths || []) if (CANVAS_EXT_RE.test(p)) total++;
    return total;
  }, [filteredGroups]);

  return (
    <nav
      className={'st-sidebar' + (collapsed ? ' is-collapsed' : '') + (resizing ? ' is-resizing' : '')}
      style={collapsed || !width ? undefined : { width, flexBasis: width }}
      aria-label="Files"
      data-tour="sidebar"
    >
      <div className="st-sb-hd">
        <span className="st-sb-title">Files</span>
        <div className="st-sb-hd-actions">
          {!readOnly && (
            <button
              type="button"
              className="st-iconbtn"
              data-tip="New blank brief board"
              aria-label="New blank brief board"
              aria-expanded={creating && composerMode === 'board'}
              onClick={() => {
                setNewErr('');
                setComposerMode('board');
                setCreating((v) => (composerMode === 'board' ? !v : true));
              }}
            >
              <StIcon name="plus" size={15} />
            </button>
          )}
          {!readOnly && defaultFolderParent && (
            <button
              type="button"
              className="st-iconbtn"
              data-tip="New folder"
              aria-label="New folder"
              data-testid="tree-new-folder"
              aria-expanded={creating && composerMode === 'folder'}
              onClick={() => {
                setNewErr('');
                setComposerMode('folder');
                setCreating((v) => (composerMode === 'folder' ? !v : true));
              }}
            >
              <StIcon name="folder-plus" size={15} />
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              className={'st-iconbtn st-refresh' + (refreshing ? ' is-spinning' : '')}
              data-tip="Refresh files · ⇧⌘R"
              aria-label="Refresh files"
              aria-busy={refreshing || undefined}
              disabled={refreshing}
              onClick={() => onRefresh()}
            >
              <StIcon name="reload" size={15} />
            </button>
          )}
          <span
            className="st-live"
            data-tip={wsConnected ? 'live · file index synced' : 'reconnecting…'}
          >
            <span className={'st-live-dot' + (wsConnected ? ' is-connected' : '')} aria-hidden="true" />
            {htmlShown} / {htmlCount}
          </span>
          {onCollapse && (
            <button
              type="button"
              className="st-iconbtn"
              aria-label="Collapse sidebar"
              data-tip="Collapse sidebar · T"
              onClick={onCollapse}
            >
              <StIcon name="panel-left" size={15} />
            </button>
          )}
        </div>
      </div>

      {creating ? (
        <div className="st-newboard">
          <input
            type="text"
            // biome-ignore lint/a11y/noAutofocus: deliberate — the composer opens on an explicit click.
            autoFocus
            placeholder={composerMode === 'folder' ? 'folder name…' : 'brief board name…'}
            value={newName}
            maxLength={60}
            disabled={newBusy}
            aria-label={composerMode === 'folder' ? 'New folder name' : 'New brief board name'}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitComposer();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setCreating(false);
                setNewName('');
                setNewErr('');
              }
            }}
          />
          <button
            type="button"
            className="st-newboard-go"
            disabled={newBusy || !newName.trim()}
            data-tip="Create · Enter"
            aria-label={composerMode === 'folder' ? 'Create folder' : 'Create brief board'}
            onClick={submitComposer}
          >
            {newBusy ? '…' : '↵'}
          </button>
        </div>
      ) : null}
      {newErr ? (
        <div className="st-newboard-err" role="alert">
          {newErr}
        </div>
      ) : null}

      <div className="st-search">
        <div className="st-search-box">
          <StIcon name="search" size={13} />
          <input
            type="search"
            data-testid="canvas-search"
            placeholder="Search canvases…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Esc — clear the filter first; a second Esc leaves the field.
              if (e.key === 'Escape') {
                e.preventDefault();
                if (search) setSearch('');
                else e.currentTarget.blur();
              }
            }}
            aria-label="Filter files"
          />
          {search ? (
            <button
              className="st-search-clear"
              onClick={() => setSearch('')}
              data-tip="Clear · Esc"
              aria-label="Clear search"
            >
              ×
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </div>
      </div>

      <div className="st-tree" role="tree" aria-label="Project file tree" data-testid="canvas-list">
        {filteredGroups.map((g) => {
          // Hide gitignored runtime / orphan-only project sections by default.
          // Active search overrides — if the user typed a query, they want hits
          // wherever they live.
          if (!showHidden && !search && g.kind === 'runtime') return null;
          const meta = sectionMetaFor(g);
          // Counter pill counts canvases only — sidecars + orphans inflate the
          // raw `paths.length` and the FILES header already filters this way.
          const canvasCount = (g.paths || []).filter((p) => CANVAS_EXT_RE.test(p)).length;
          const pill =
            meta.pill ||
            (meta.pillFromDsCount ? String(g.dsFolders?.length || 0) : null) ||
            (meta.pillFromCount ? String(canvasCount || g.paths?.length || 0) : null);
          const hasItems = g.tree && Object.keys(g.tree).length > 0;
          const isDs = g.label === 'Design system';
          const isProject = g.kind === 'project';
          // Project section: when showHidden is off, every row inside is an
          // orphan (.md / .json / .css) → empty body. Skip the header in that
          // case so the sidebar doesn't show "PROJECT" with nothing under it.
          if (!showHidden && !search && isProject && canvasCount === 0) return null;
          const defaultOpen = sectionDefaultOpen(g);
          const explicit = sectionsExpanded[g.label];
          // Active search forces every section open so hits aren't hidden.
          const sectionOpen = !!search || (explicit === undefined ? defaultOpen : explicit);
          // feature-file-tree-drag-drop-folders (dogfood follow-up) — the
          // section header IS the drop target for "move back to this group's
          // root". Without this a canvas inside a folder could never return
          // to the top level via drag & drop — DirRow only covers actual
          // subfolders, never the group root itself.
          const canDropOnRoot = !isDs && g.kind === 'canvas' && !readOnly;
          const rootDropHandlers = canDropOnRoot ? treeDrag.dropProps(g.fullPath, true) : {};
          const isRootOver = treeDrag.overDir === g.fullPath;
          return (
            <div className="st-tree-section" key={g.label}>
              <button
                type="button"
                className={'st-tree-sec-hd' + (isRootOver ? ' is-drop-target' : '')}
                onClick={() => onToggleSection(g.label, defaultOpen)}
                aria-expanded={sectionOpen}
                aria-dropeffect={canDropOnRoot ? 'move' : undefined}
                title={sectionOpen ? 'Collapse section' : 'Expand section'}
                {...rootDropHandlers}
              >
                <StIcon name="chevron-right" className={'st-chev' + (sectionOpen ? ' is-open' : '')} size={13} />
                <span className="st-sec-name">{meta.title}</span>
                {pill && <span className="st-pill">{pill}</span>}
              </button>
              {sectionOpen &&
                (hasItems ? (
                  <Tree
                    node={g.tree}
                    activePath={activePath}
                    previewPath={previewPath}
                    onOpen={onOpen}
                    onPreview={onPreview}
                    commentsByFile={commentsByFile}
                    depth={1}
                    kind={g.kind}
                    showHidden={showHidden}
                    search={search}
                    dsFolders={g.dsFolders}
                    activeDsName={activeDsName}
                    onOpenSystem={isDs ? onOpenSystem : undefined}
                    onDelete={isDs || readOnly ? undefined : onDeleteBoard}
                    dirtyByPath={dirtyByPath}
                    canvasKinds={canvasKinds}
                    dirPath={g.fullPath}
                    drag={!isDs && g.kind === 'canvas' && !readOnly ? treeDrag : undefined}
                    menu={!isDs && g.kind === 'canvas' && !readOnly ? rowMenu : undefined}
                  />
                ) : (
                  <div className="st-tree-empty">{search ? 'No matches.' : 'Empty.'}</div>
                ))}
            </div>
          );
        })}
      </div>
      <TreeRowMenu
        state={rowMenu.state}
        onClose={rowMenu.close}
        rootItems={rowMenuRootItems}
        destinations={rowMenuDestinations}
        onPickDestination={(dest) => onMoveCanvas(menuExtra.path, dest)}
      />
      {/* Phase 29 (E4) — the project + draft switcher: a compact one-line dock that
          opens UPWARD, sitting directly above the GitHub identity avatar so the two
          form one bottom dock. Renders nothing until the project is a git repo.

          WITHDRAWN while somebody else is committing (feature-cloud-managed-git-
          posture). A draft is a local branch, and switching one moves a HEAD the
          cell knows nothing about — it would rewrite the working tree under a
          project whose history is being written elsewhere. Same
          presentation-not-a-control rule as the rest of DDR-218: `/_api/git/branch`
          and `/_api/git/checkout` keep exactly their old gates, and a terminal
          `git checkout` still works (and still flushes into Yjs via DDR-051's
          watcher). Absent, not disabled — there is nothing to explain here. */}
      {!savingIsManaged && (
        <RepoBranchSwitcher project={project} liveBranch={gitBranch} remoteSync={remoteSync} onGetLatest={onGetLatest} />
      )}
      {/* Cloud Phase 23 C3 — Maude Cloud sign-in + remote-project attach, docked
          above the GitHub identity. Dev-server-backed, so it works in the desktop
          shell AND a plain browser. */}
      {/* Cloud Phase 27 — "Sign in to Maude Cloud" is an offer to do the thing
          you have already done: you reached this tab THROUGH a Maude account.
          Absent rather than disabled, because unlike the agent chat there is
          nothing here to explain — the capability is not missing, it is
          already satisfied. */}
      {cloud === null ? <CloudBar syncStatus={syncStatus} onLinkedHub={onLinkedHub} /> : null}
      {/* Phase 28 (E3) — GitHub identity as a compact avatar docked at the BOTTOM:
          sign in, connected account + New/Pull/Share, sign out. Self-contained
          (owns its device-code + CreateProject dialogs). Renders nothing in browser. */}
      <IdentityBar />
    </nav>
  );
}

// Collapsed rail — a thin strip shown when the sidebar is collapsed, with a
// re-open affordance + quick search/files shortcuts (mockup CollapsedRail).
function CollapsedRail({ shown, onExpand, onSearch }) {
  return (
    <div className={'st-rail' + (shown ? ' is-shown' : '')}>
      <div className="st-rail-inner">
        <button type="button" className="st-iconbtn" aria-label="Expand sidebar" title="Expand sidebar (T)" onClick={onExpand}>
          <StIcon name="panel-left" size={15} />
        </button>
        <button type="button" className="st-iconbtn" aria-label="Search" title="Search (/)" onClick={onSearch}>
          <StIcon name="search" size={15} />
        </button>
        <button type="button" className="st-iconbtn" aria-label="Files" title="Files" onClick={onExpand}>
          <StIcon name="folder" size={15} />
        </button>
      </div>
    </div>
  );
}

// Help modal — hosts the cheatsheet that used to live in the left sidebar.
// Triggered from the menubar's Help item. Esc + backdrop click close it.
function HelpModal({ open, onClose, onStartTour }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="help-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        <header className="help-modal-hd">
          <span className="title" id="help-modal-title">
            Help · shortcuts &amp; commands
          </span>
          <span className="sku">MAUDE-DEV-SRV / v{MDCC_VERSION}</span>
          {onStartTour && (
            <button
              type="button"
              className="mdcc-tour__back"
              style={{ marginLeft: 'auto' }}
              onClick={onStartTour}
            >
              ▶ Take the tour
            </button>
          )}
          <button
            type="button"
            className="help-modal-close"
            aria-label="Close (Esc)"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="help-modal-body">
          <details open>
            <summary>Canvas selection &amp; tools</summary>
            <ul>
              <li>
                <kbd>V</kbd> <span>move tool — Cmd+click to select, Cmd+Shift to multi</span>
              </li>
              <li>
                <kbd>H</kbd> <span>hand tool — bare drag pans (no Space needed)</span>
              </li>
              <li>
                <kbd>C</kbd> <span>comment tool — hover paints, click drops a pin</span>
              </li>
              <li>
                <kbd>⌘</kbd> + hover <span>preview deepest element under cursor</span>
              </li>
              <li>
                <kbd>⌘</kbd> + click <span>select that element (replace)</span>
              </li>
              <li>
                <kbd>⌘⇧</kbd> + click <span>add deepest to selection (multi)</span>
              </li>
              <li>
                right-click <span>context menu (Copy CSS / Fit / Reset...)</span>
              </li>
              <li>
                <kbd>Esc</kbd> in canvas <span>clear selection + close menu</span>
              </li>
            </ul>
          </details>
          <details>
            <summary>Annotation tools</summary>
            <ul>
              <li>
                <kbd>B</kbd> <span>pen — freehand stroke</span>
              </li>
              <li>
                <kbd>R</kbd> <span>rectangle — drag to define corners</span>
              </li>
              <li>
                <kbd>O</kbd> <span>ellipse — drag from center outward</span>
              </li>
              <li>
                <kbd>A</kbd> <span>arrow — drag tail → tip</span>
              </li>
              <li>
                <kbd>E</kbd> <span>eraser — click or drag over strokes to remove</span>
              </li>
              <li>
                <kbd>V</kbd> + click stroke <span>select annotation (Shift+click to multi)</span>
              </li>
              <li>
                <kbd>V</kbd> + drag empty <span>marquee-select strokes that overlap</span>
              </li>
              <li>
                double-click rect/ellipse <span>add text inside the shape</span>
              </li>
              <li>
                arrow keys <span>nudge selected annotation 1 unit (Shift = 10)</span>
              </li>
              <li>
                <kbd>Backspace</kbd> <span>delete selected annotations</span>
              </li>
              <li>
                <kbd>⇧P</kbd> <span>presentation — hide annotations for clean screenshot</span>
              </li>
            </ul>
          </details>
          <details>
            <summary>Canvas &amp; panels</summary>
            <ul>
              <li>
                click in tree <span>open canvas (replaces the active one)</span>
              </li>
              <li>
                File ▸ Close canvas <span>clear the stage</span>
              </li>
              <li>
                <kbd>⌘R</kbd> <span>reload canvas</span>
              </li>
              <li>
                <kbd>/</kbd> <span>focus search</span>
              </li>
              <li>
                <kbd>⌘⇧M</kbd> <span>comments panel</span>
              </li>
              <li>
                <kbd>⌘⇧I</kbd> <span>inspector</span>
              </li>
              <li>
                <kbd>?</kbd> <span>keyboard-shortcuts cheat sheet</span>
              </li>
            </ul>
          </details>
          <details>
            <summary>Slash commands</summary>
            <ul className="cmds">
              <li>
                <code>
                  /design:edit "<i>feedback</i>"
                </code>
                <span>edit + 4-iter multi-axis loop</span>
              </li>
              <li>
                <code>
                  /design:edit "<i>…</i>" --perfect
                </code>
                <span>8-iter polish (4.5/5 aspiration)</span>
              </li>
              <li>
                <code>
                  /design:edit "<i>…</i>" --no-critic
                </code>
                <span>raw edit, skip loop</span>
              </li>
              <li>
                <code>
                  /design:edit "<i>…</i>" --opt-out=<i>scope</i>
                </code>
                <span>override DS scope (palette/aesthetic/full)</span>
              </li>
              <li>
                <code>
                  /design:new "<i>Name</i>" "<i>brief</i>"
                </code>
                <span>scaffold canvas</span>
              </li>
              <li>
                <code>
                  /design:new "<i>…</i>" --opt-out=aesthetic
                </code>
                <span>scaffold off-system canvas (gradients/radii/type free)</span>
              </li>
              <li>
                <code>/design:critic</code>
                <span>review panel (routed)</span>
              </li>
              <li>
                <code>/design:critic --all</code>
                <span>10-critic sweep</span>
              </li>
              <li>
                <code>/design:critic --agent signature-moment-critic</code>
                <span>aspiration axis only</span>
              </li>
              <li>
                <code>/design:rollback</code>
                <span>undo last edit</span>
              </li>
              <li>
                <code>/design:screenshot</code>
                <span>capture canvas</span>
              </li>
              <li>
                <code>/design:setup-docs</code>
                <span>refresh README + INDEX</span>
              </li>
              <li>
                <code>/design:handoff</code>
                <span>migrate to apps/</span>
              </li>
            </ul>
          </details>
          <details>
            <summary>Opt-out scope</summary>
            <ul>
              <li>
                <strong>palette</strong>{' '}
                <span>
                  default — tokens + rootClass kept; local namespace overrides colors only. DS
                  aesthetic still enforced.
                </span>
              </li>
              <li>
                <strong>aesthetic</strong>{' '}
                <span>
                  palette + gradients/off-ladder radii/alt type/decorative SVG flags allowed.
                </span>
              </li>
              <li>
                <strong>full</strong>{' '}
                <span>DS treated as advisory. Type/radii/aesthetic up to canvas.</span>
              </li>
              <li>
                <em>A11y enforced at every scope</em>{' '}
                <span>contrast, focus, semantics, motion, touch targets — never relaxed.</span>
              </li>
              <li>
                Persisted on canvas's <code>.meta.json</code> <code>opt_out_scope</code> field —
                subsequent <code>/design:edit</code> iterations inherit.
              </li>
              <li>
                Inferred from brief ("modern", "vibrant", "off-system") with one-shot
                AskUserQuestion before iter-1 critics fire.
              </li>
            </ul>
          </details>
          <details>
            <summary>Auto-critic loop</summary>
            <ul>
              <li>
                <strong>Default</strong>{' '}
                <span>4 iter · aspiration ≥ 4.0 · stable-but-bland exit</span>
              </li>
              <li>
                <strong>--perfect</strong>{' '}
                <span>8 iter · aspiration ≥ 4.5 · broader divergence tolerance</span>
              </li>
              <li>
                <strong>--perfect --all</strong>{' '}
                <span>every critic incl. aspiration · portfolio-grade</span>
              </li>
              <li>
                Exit: <code>solid</code> · <code>stable-but-bland</code> · <code>max-reached</code>{' '}
                · <code>divergent</code>
              </li>
              <li>
                <em>stable-but-bland</em> = correctness clean, aspiration plateau — surface for
                review with lowest 2 axes named
              </li>
              <li>
                When <code>opt_out_scope ∈ &#123;aesthetic, full&#125;</code>: iter-1 checkpoint
                fires — pick (a) run loop, (b) skip auto-loop and review iter 1, (c) a11y-only
                check.
              </li>
            </ul>
          </details>
          <details>
            <summary>Pin-to-element flow</summary>
            <ol>
              <li>Open a canvas</li>
              <li>
                <kbd>⌘</kbd>+click element
              </li>
              <li>Status bar shows ● selector</li>
              <li>
                Run{' '}
                <code>
                  /design:edit "<i>change just this</i>"
                </code>
              </li>
              <li>
                Reload iframe (<kbd>⌘R</kbd>)
              </li>
            </ol>
          </details>
          <details>
            <summary>Comments</summary>
            <ol>
              <li>
                <kbd>⌘</kbd>+click element, then <kbd>⌘C</kbd> <span>or ⌘⇧+click</span>
              </li>
              <li>Numbered pin appears on canvas</li>
              <li>
                <kbd>⌘⇧M</kbd> <span>opens panel — All / Open / Resolved</span>
              </li>
              <li>
                Click row in panel <span>jumps to that file + pin</span>
              </li>
              <li>
                Claude reads <code>_comments/&lt;slug&gt;.json</code> on next <code>/design</code>
              </li>
            </ol>
          </details>
        </div>
      </div>
    </div>
  );
}

// ───────── Keyboard-shortcuts overlay (DS components-shortcuts-overlay) ─────
//
// The ? cheat-sheet: dim scrim, shared panel material, four dense mono-headed
// columns, Esc chip in the footer. REAL bindings only — every row here is
// wired in the shell handler, the canvas input-router, or canvas-lib's
// viewport controller. Scope chips mark the rows that need canvas focus.

const SHORTCUT_GROUPS = [
  {
    id: 'canvas',
    label: 'Canvas',
    items: [
      { label: 'Command palette', kbd: '⌘ K' },
      { label: 'New brief board', kbd: 'N' },
      { label: 'Export…', kbd: '⇧ ⌘ E' },
      { label: 'Handoff to production', kbd: '⇧ ⌘ H' },
      { label: 'Reload canvas', kbd: '⌘ R' },
      { label: 'Search files', kbd: '/', alt: '⌘ F' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools · canvas focus',
    items: [
      { label: 'Move · Hand · Comment', kbd: 'V', alt: 'H / C' },
      { label: 'Pen · Highlighter · Eraser', kbd: 'B', alt: 'I / E' },
      { label: 'Shape · Arrow', kbd: 'R', alt: 'A' },
      { label: 'Sticky · Text · Section', kbd: 'N', alt: 'T / ⇧S' },
      { label: 'Undo / redo', kbd: '⌘ Z', alt: '⇧ ⌘ Z' },
    ],
  },
  {
    id: 'selection',
    label: 'Selection & zoom',
    items: [
      { label: 'Select element', kbd: '⌘ click' },
      { label: 'Add to selection', kbd: '⌘ ⇧ click' },
      { label: 'Preview deepest', kbd: '⌘ hover' },
      { label: 'Deselect · close menu', kbd: 'Esc' },
      { label: 'Zoom in / out', kbd: '⌘ +', alt: '⌘ −' },
      { label: 'Fit · actual size', kbd: '⌘ 0', alt: '⌘ 1' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { label: 'Project tree', kbd: 'T' },
      { label: 'Design system view', kbd: 'S' },
      { label: 'Inspector', kbd: '⌘ ⇧ I' },
      { label: 'Comments sidebar', kbd: '⌘ ⇧ M' },
      { label: 'Annotations', kbd: '⇧ P' },
      { label: 'Hidden files', kbd: 'H' },
      { label: 'This cheat sheet · help', kbd: '?', alt: 'F1' },
    ],
  },
];

function ShortcutCombo({ kbd, alt }) {
  const combo = (s, key) => (
    <span className="so-combo" key={key}>
      {s.split(' ').map((k, i) => (
        <Kbd key={`${k}-${i}`}>{k}</Kbd>
      ))}
    </span>
  );
  return (
    <span className="so-combos">
      {combo(kbd, 'main')}
      {alt
        ? alt.split(' / ').map((a) => (
            <Fragment key={a}>
              <span className="so-or">/</span>
              {combo(a, a)}
            </Fragment>
          ))
        : null}
    </span>
  );
}

function ShortcutsOverlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const bindings = SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0);
  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="so-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="so-overlay-hd">
          <span className="so-title">Keyboard shortcuts</span>
          <span className="so-trigger">
            press <Kbd>?</Kbd> to open
          </span>
        </div>
        <div className="so-columns">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.id} className={'so-section so-section--' + g.id}>
              <h3 className="so-section-hd">{g.label}</h3>
              <dl className="so-list">
                {g.items.map((it) => (
                  <div key={it.label} className="so-pair">
                    <dt>{it.label}</dt>
                    <dd>
                      <ShortcutCombo kbd={it.kbd} alt={it.alt} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="so-overlay-ft">
          <span>
            close with <Kbd>Esc</Kbd>
          </span>
          <span className="so-count">
            {bindings} bindings · {SHORTCUT_GROUPS.length} groups
          </span>
        </div>
      </div>
    </div>
  );
}

// ───────── Menubar (CV-01/CV-08 top chrome) ─────────
//
// Replaces the legacy `.header` action-button toolbar. Mirrors the shared
// Menubar component from .design/ui/Canvas Viewport.html — brand · menus ·
// status. View dropdown is wired to the panels + zoom that exist today;
// Presentation Mode stays phase-tagged until it ships.

const MENU_NAMES = ['File', 'Edit', 'View', 'Selection', 'Tools', 'Help'];

// Shared close-on-Esc / outside-click effect for the menubar dropdowns.
function useDropdownClose(onClose) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    function onDocClick(e) {
      if (!e.target.closest('.st-dropdown, .st-menu')) onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDocClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDocClick);
    };
  }, [onClose]);
}

function ViewDropdown({ panels, onToggle, onClose, onZoom, hasCanvas }) {
  useDropdownClose(onClose);
  return (
    <div className="st-dropdown" role="menu" aria-label="View" style={{ left: 152 }}>
      <div className="st-dd-hd">Panels</div>
      {panels.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitem"
          className={'st-dd-item' + (p.checked ? ' is-on' : '')}
          aria-disabled={p.disabled ? 'true' : undefined}
          title={p.hint || undefined}
          onClick={() => {
            // Cloud Phase 27 C2 — a row that states an absence still has
            // somewhere to send you. A disabled item with a `href` opens it
            // instead of doing nothing, which is the difference between "this
            // is not available here" and a dead button.
            if (p.disabled) {
              if (p.href) {
                window.open(p.href, '_blank', 'noopener,noreferrer');
                onClose();
              }
              return;
            }
            onToggle(p.id);
            onClose();
          }}
        >
          <span className="st-dd-lead">
            <span className="st-dd-check">{p.checked ? <StIcon name="check" size={13} /> : null}</span>
            <span>{p.label}</span>
            {p.phase ? <span className="st-dd-phase">{p.phase}</span> : null}
          </span>
          {p.shortcut ? <Kbd>{p.shortcut}</Kbd> : null}
        </button>
      ))}
      <div className="st-dd-sep" />
      <div className="st-dd-hd">Zoom</div>
      {[
        { op: 'in', label: 'Zoom In', shortcut: '⌘ +' },
        { op: 'out', label: 'Zoom Out', shortcut: '⌘ −' },
        { op: 'fit', label: 'Fit to Screen', shortcut: '⌘ 0' },
        { op: 'actual', label: 'Actual Size · 100 %', shortcut: '⌘ 1' },
      ].map((z) => (
        <button
          key={z.label}
          type="button"
          role="menuitem"
          className="st-dd-item"
          aria-disabled={hasCanvas ? undefined : 'true'}
          onClick={() => {
            if (!hasCanvas) return;
            onZoom?.(z.op);
            onClose();
          }}
        >
          <span className="st-dd-lead">
            <span className="st-dd-check" />
            <span>{z.label}</span>
          </span>
          <Kbd>{z.shortcut}</Kbd>
        </button>
      ))}
    </div>
  );
}

// Help dropdown — cheat sheet · deep help · tour · what's new.
// Shared menubar dropdown — File / Edit / Selection / Tools / Help all render
// the identical {id,label,shortcut,sep?,disabled?} list over the same button
// skeleton, differing only in aria-label, left offset, and an optional header.
// (ViewDropdown stays separate — its checkbox/phase/zoom-op rows genuinely
// diverge.) Per the /flow:done simplifier pass — collapsed 5 near-dupes.
function DropdownMenu({ label, left, header, items, onAction, onClose }) {
  useDropdownClose(onClose);
  return (
    <div className="st-dropdown" role="menu" aria-label={label} style={{ left }}>
      {header ? <div className="st-dd-hd">{header}</div> : null}
      {items.map((it, i) =>
        it.sep ? (
          <div key={'s' + i} className="st-dd-sep" />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className="st-dd-item"
            aria-disabled={it.disabled ? 'true' : undefined}
            onClick={() => {
              if (it.disabled) return;
              onAction(it.id);
              onClose();
            }}
          >
            <span className="st-dd-lead">
              <span className="st-dd-check" />
              <span>{it.label}</span>
            </span>
            {it.shortcut ? <Kbd>{it.shortcut}</Kbd> : null}
          </button>
        )
      )}
    </div>
  );
}

function HelpDropdown({ onAction, onClose }) {
  return (
    <DropdownMenu
      label="Help"
      left={320}
      onAction={onAction}
      onClose={onClose}
      items={[
        { id: 'shortcuts', label: 'Keyboard shortcuts', shortcut: '?' },
        { id: 'help', label: 'Help · commands & flows', shortcut: 'F1' },
        { id: 'report-bug', label: 'Report a bug…' },
        { sep: true },
        { id: 'tour', label: 'Take the tour' },
        { id: 'watch-intro', label: 'Watch the intro' },
        // The collab "how sharing works" course teaches the plain-words Save →
        // Publish → Pull cycle — a non-technical, native-app concern. A web-studio
        // dev already knows git, so it's hidden there (DDR-119).
        ...(isNativeApp() ? [{ id: 'collab-tour', label: 'How sharing works' }] : []),
        // DDR-166 plan, Phase 2 (T7) — the quick-setup journey (design system →
        // first canvas → first AI edit) is a native, no-terminal concern same as
        // the two tours above.
        ...(isNativeApp() ? [{ id: 'quick-setup', label: 'Quick setup' }] : []),
        ...(isNativeApp() ? [{ id: 'readiness', label: 'Check AI editing readiness…' }] : []),
        { id: 'whatsnew', label: "What's new" },
      ]}
    />
  );
}

function SelectionDropdown({ onAction, onClose, readOnly = false }) {
  return (
    <DropdownMenu
      label="Selection"
      left={214}
      onAction={onAction}
      onClose={onClose}
      items={[
        { id: 'deselect-all', label: 'Deselect all', shortcut: 'Esc' },
        // Cloud Phase 25 C2 — annotation selection exists to edit/delete
        // annotations; absent for a viewer.
        ...(readOnly
          ? []
          : [{ id: 'select-all-annotations', label: 'Select all annotations', shortcut: '⌘ ⇧ A' }]),
      ]}
    />
  );
}

function ToolsDropdown({ onAction, onClose, readOnly = false }) {
  // Mirrors DEFAULT_TOOLS in apps/studio/use-tool-mode.tsx — kept in sync by
  // hand because the menubar lives in the dev-server shell (no shared bundle
  // with the canvas iframes). Cloud Phase 25 C2 — a viewer keeps only the
  // navigate/inspect tools (same READ_ONLY_TOOL_IDS the canvas enforces).
  const items = [
    // feature-4 (browse/move split) — Browse is the boot default (mock is
    // alive); Move (V) is the select tool.
    { id: 'browse', label: 'Browse (interact)', shortcut: '' },
    { id: 'move', label: 'Select', shortcut: 'V' },
    { id: 'hand', label: 'Hand', shortcut: 'H' },
    ...(readOnly
      ? []
      : [
          { id: 'comment', label: 'Comment', shortcut: 'C' },
          { id: 'pen', label: 'Pen', shortcut: 'B' },
          { id: 'rect', label: 'Rect', shortcut: 'R' },
          { id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
          { id: 'sticky', label: 'Sticky', shortcut: 'N' },
          { id: 'arrow', label: 'Arrow', shortcut: 'A' },
          { id: 'text', label: 'Text', shortcut: 'T' },
          { id: 'eraser', label: 'Eraser', shortcut: 'E' },
        ]),
  ];
  return (
    <DropdownMenu
      label="Tools"
      left={290}
      header="Tool palette"
      onAction={onAction}
      onClose={onClose}
      items={items}
    />
  );
}

// Plan C follow-up — File + Edit menus, previously inert. Both dispatch to real
// shell flows (File) or the in-canvas undo stack / selection bridges (Edit).
function FileDropdown({ onAction, onClose, hasCanvas, readOnly = false }) {
  // Cloud Phase 25 C2 — a viewer keeps the reads (export, handoff, reload,
  // close); create / assemble / generate / settings are absent.
  const items = readOnly
    ? [
        { id: 'export', label: 'Export…', shortcut: '⇧⌘E' },
        { id: 'handoff', label: 'Handoff to production', shortcut: '⇧⌘H' },
        { sep: true },
        { id: 'reload', label: 'Reload canvas', shortcut: '⌘R', disabled: !hasCanvas },
        { id: 'close', label: 'Close canvas', disabled: !hasCanvas },
      ]
    : [
        // Bare N — the browser reserves ⌘N (New Window) and never delivers it.
        { id: 'new', label: 'New canvas…', shortcut: 'N' },
        // DDR-150 P4 Task 12 — one-click "udělej z toho video" from the clips
        // dropped as reference chips on the active canvas.
        { id: 'assemble', label: 'Assemble dropped clips → video', disabled: !hasCanvas },
        { id: 'export', label: 'Export…', shortcut: '⇧⌘E' },
        { id: 'handoff', label: 'Handoff to production', shortcut: '⇧⌘H' },
        { sep: true },
        // feature-ai-media-generation (DDR-16x) — BYOK generate action + settings.
        { id: 'generate', label: 'Generate with AI…' },
        { id: 'settings', label: 'Settings…', shortcut: '⌘,' },
        { sep: true },
        { id: 'reload', label: 'Reload canvas', shortcut: '⌘R', disabled: !hasCanvas },
        { id: 'close', label: 'Close canvas', disabled: !hasCanvas },
      ];
  return <DropdownMenu label="File" left={40} onAction={onAction} onClose={onClose} items={items} />;
}

function EditDropdown({ onAction, onClose, hasCanvas, readOnly = false }) {
  // Cloud Phase 25 C2 — a viewer's Edit menu is selection only; undo/redo,
  // artboard insert and annotation ops are writes.
  if (readOnly) {
    return (
      <DropdownMenu
        label="Edit"
        left={90}
        onAction={onAction}
        onClose={onClose}
        items={[{ id: 'deselect-all', label: 'Deselect all', shortcut: 'Esc' }]}
      />
    );
  }
  return (
    <DropdownMenu
      label="Edit"
      left={90}
      onAction={onAction}
      onClose={onClose}
      items={[
        { id: 'undo', label: 'Undo', shortcut: '⌘Z' },
        { id: 'redo', label: 'Redo', shortcut: '⇧⌘Z' },
        { sep: true },
        { id: 'deselect-all', label: 'Deselect all', shortcut: 'Esc' },
        { id: 'select-all-annotations', label: 'Select all annotations', shortcut: '⇧⌘A' },
        // Stage I4 — insert an empty artboard from a device-size preset into the
        // active canvas. Only meaningful with a canvas open.
        ...(hasCanvas
          ? [
              { sep: true },
              { id: 'new-artboard:desktop', label: 'New artboard: Desktop' },
              { id: 'new-artboard:laptop', label: 'New artboard: Laptop' },
              { id: 'new-artboard:tablet', label: 'New artboard: Tablet' },
              { id: 'new-artboard:mobile', label: 'New artboard: Mobile' },
              // feature-2-print-artboards T2 — "+ Artboard" quick-insert must
              // set kind="print" + the print prop together (the plan's own
              // gotcha for this task), not just a plain digital-sized board.
              { id: 'new-artboard:print-a4', label: 'New artboard: A4 (print)' },
              { id: 'new-artboard:print-letter', label: 'New artboard: Letter (print)' },
            ]
          : []),
      ]}
    />
  );
}

function Menubar({
  activePath,
  project,
  /** `{ dashboardUrl?, projectName }` when this is a cloud tab, else null. */
  // Tri-state (see the note where this value is created): `undefined` until
  // the server config answers, `null` for the desktop, an object for a cloud
  // tab. Defaulting it to `null` here is what re-broke the boot 404 after the
  // call sites were fixed — a default fires on `undefined`, so "not known yet"
  // became "not cloud" one layer further in, invisibly.
  cloud,
  tabsCount,
  openMenu,
  setOpenMenu,
  commentsPanelOpen,
  onToggleComments,
  changesOpen,
  changesCount,
  onToggleChanges,
  onOpenSystem,
  sidebarOpen,
  onToggleSidebar,
  showHidden,
  onToggleShowHidden,
  onOpenHelp,
  onOpenShortcuts,
  onReportBug,
  onStartTour,
  onStartCollabTour,
  annotationsVisible,
  onToggleAnnotations,
  minimapVisible,
  onToggleMinimap,
  zoomCtlVisible,
  onToggleZoomCtl,
  presentMode,
  onTogglePresent,
  printGuidesVisible,
  onTogglePrintGuides,
  postToActiveCanvas,
  onOpenWhatsNew,
  onOpenReadiness,
  onOpenQuickSetup,
  onWatchIntro,
  whatsNewCount,
  exportCenter,
  artboardCount = 0,
  presence = null,
  inspectorOpen,
  inspectorTab,
  onToggleInspector,
  autoOpenInspector,
  onToggleAutoOpenInspector,
  onOpenLayers,
  timelineOpen,
  onToggleTimeline,
  hasComps = false,
  assistantOpen,
  onToggleAssistant,
  assistantBusy,
  assistantUnseen,
  onNewCanvas,
  onAssembleVideo,
  onOpenExport,
  onOpenSettings,
  onOpenGenerate,
  onReload,
  onCloseCanvas,
  onInsertArtboard,
  // Cloud Phase 25 C2 — viewer role: editing entries are absent from every
  // menu, and the stamp says VIEW ONLY so the absence is legible.
  readOnly = false,
}) {
  const isSystem = activePath === SYSTEM_TAB;
  const stamp = isSystem ? 'SYSTEM' : activePath ? 'CANVAS' : 'IDLE';
  const fileLabel = isSystem ? (
    <b>design system</b>
  ) : activePath ? (
    <>
      {activePath.split('/').slice(0, -1).join('/')}/<b>{displayName(basename(activePath))}</b>
    </>
  ) : (
    <span style={{ color: 'var(--u-fg-3)' }}>no canvas open</span>
  );

  // Cloud Phase 27 C1 — ROLE SHAPES WHAT IS OFFERED, NEVER WHAT IS VISIBLE.
  //
  // `inspector` and `layers` used to be on this list and should never have been.
  // Read-only means cannot CHANGE, not cannot SEE: a reviewer needs the
  // structure and the measured values to say anything useful, and hiding them
  // is how a viewer's Maude became a worse Maude rather than a narrower one.
  // What stays hidden is only what genuinely does not exist for this session —
  // the agent chat (`assistant`, which needs a `claude` on the machine the app
  // is running on) and auto-open (a preference for a surface you cannot edit).
  // In the cloud the `assistant` row is the stated-absence row above, so it must
  // NOT be filtered away here — a viewer would then get silence, which is the
  // exact thing C2 forbids.
  const viewerHiddenPanels = new Set(cloud ? ['autoopen'] : ['assistant', 'autoopen']);
  const panels = [
    { id: 'tree', label: 'Project Tree', shortcut: 'T', checked: sidebarOpen, disabled: false },
    {
      id: 'changes',
      // In a cell this panel is History (the hub already committed the work),
      // so the menu names what it opens rather than an unsaved count there is
      // no way — and no reason — to act on.
      label: cloud
        ? 'History'
        : changesCount > 0
          ? `Changes · ${changesCount} unsaved`
          : 'Changes',
      shortcut: '⌘ ⇧ G',
      checked: changesOpen,
      disabled: false,
    },
    {
      id: 'comments',
      label: 'Comments Sidebar',
      shortcut: '⌘ ⇧ M',
      checked: commentsPanelOpen,
      disabled: false,
    },
    {
      id: 'hidden',
      label: 'Show hidden files',
      shortcut: 'H',
      checked: showHidden,
      disabled: false,
    },
    {
      id: 'layers',
      label: 'Layers',
      shortcut: '',
      checked: inspectorOpen && inspectorTab === 'layers',
      disabled: false,
    },
    {
      id: 'inspector',
      label: 'Inspector',
      shortcut: '⌘ ⇧ I',
      checked: inspectorOpen,
      disabled: false,
    },
    {
      id: 'autoopen',
      label: 'Auto-open Inspector on select',
      shortcut: '',
      checked: !!autoOpenInspector,
      disabled: false,
    },
    // DDR-148 — Timeline (video-comp scrub). Phase-tag hints when the active
    // canvas actually has a comp; the panel itself shows an empty state otherwise.
    {
      id: 'timeline',
      label: 'Timeline',
      shortcut: '⌘ ⇧ T',
      phase: hasComps ? 'video' : undefined,
      checked: timelineOpen,
      disabled: false,
    },
    // Phase 31 (DDR-123) — native-only ACP chat sidepanel.
    ...(isNativeApp()
      ? [
          {
            id: 'assistant',
            label: 'Assistant',
            shortcut: '⌘ ⇧ A',
            checked: assistantOpen,
            disabled: false,
          },
        ]
      : // Cloud Phase 27 C2 — THE AGENT'S ABSENCE IS STATED WHERE THE AGENT
        // WOULD BE. It runs on YOUR `claude` subscription, on YOUR machine
        // (DDR-123), so a browser tab genuinely cannot have it. That is a
        // legitimate difference — but a menu that silently lacks an item its
        // user has seen on the desktop reads as "the cloud one is broken", so
        // the row stays, disabled, saying where to find it. Never a hidden
        // item, never a dead button, never silence.
        cloud
        ? [
            {
              id: 'assistant',
              label: 'Assistant — in the desktop app',
              shortcut: '',
              checked: false,
              disabled: true,
              href: 'https://maude.sh/download',
              hint: 'The agent runs on your own Claude subscription, on your own machine.',
            },
          ]
        : []),
    {
      id: 'annotate',
      label: 'Annotations',
      shortcut: '⇧ P',
      checked: annotationsVisible,
      disabled: false,
    },
    {
      id: 'minimap',
      label: 'Minimap',
      shortcut: '',
      checked: minimapVisible,
      disabled: !activePath || isSystem,
    },
    {
      id: 'zoomctl',
      label: 'Zoom controls',
      shortcut: '',
      checked: zoomCtlVisible,
      disabled: !activePath || isSystem,
    },
    {
      id: 'present',
      label: 'Presentation Mode',
      shortcut: '',
      checked: presentMode,
      disabled: !activePath || isSystem,
    },
    // feature-2-print-artboards T3 — per-canvas persisted (overlays.print in
    // view.json), same lane as the foundation's `guides` key; NOT gated on the
    // active artboard actually being kind="print" (mirrors minimap/zoomctl,
    // which aren't content-gated either — the overlay itself renders nothing
    // for a non-print artboard regardless of this flag).
    {
      id: 'print-guides',
      label: 'Show print guides',
      shortcut: '',
      checked: printGuidesVisible,
      disabled: !activePath || isSystem,
    },
  ].filter((p) => !readOnly || !viewerHiddenPanels.has(p.id));

  const DROPDOWN_MENUS = ['file', 'edit', 'view', 'selection', 'tools', 'help'];
  function onMenuClick(key) {
    if (DROPDOWN_MENUS.includes(key)) {
      setOpenMenu(openMenu === key ? null : key);
    }
  }

  // Keyboard menubar (native-menu parity): while a dropdown is open, ↑/↓ rove
  // its items, ←/→ switch to the adjacent menu, Home/End jump, Esc returns
  // focus to the trigger (useDropdownClose handles the close itself).
  useEffect(() => {
    if (!openMenu || !DROPDOWN_MENUS.includes(openMenu)) return;
    // Move focus into the menu so ↑/↓ work immediately after a click.
    const t = setTimeout(() => {
      document
        .querySelector('.st-dropdown [role="menuitem"]:not([aria-disabled="true"])')
        ?.focus();
    }, 0);
    function onKey(e) {
      const items = [
        ...document.querySelectorAll('.st-dropdown [role="menuitem"]:not([aria-disabled="true"])'),
      ];
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const cur = DROPDOWN_MENUS.indexOf(openMenu);
        setOpenMenu(DROPDOWN_MENUS[(cur + dir + DROPDOWN_MENUS.length) % DROPDOWN_MENUS.length]);
      } else if (e.key === 'Escape') {
        document.querySelector('.st-menu[aria-expanded="true"]')?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu, setOpenMenu]);

  return (
    <header
      className="st-menubar"
      role="menubar"
      aria-label="Application menubar"
      data-testid="menubar"
    >
      <span className="st-brand" data-tour="brand">
        <span className="st-brand-mark">
          <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true"><path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" /></svg>
        </span>
        <span className="st-brand-name">maude</span>
      </span>
      {/* Cloud Phase 27 C4 — THE WAY BACK OUT.
          A browser tab has no window title and no app switcher, so a teammate
          who followed a link has nothing telling them which project they are in
          or how to leave it. The desktop gets both for free from the OS; the
          cloud has to say them. This is an ADDITION to the shared client behind
          the same `cloud` flag as C2's agent notice — never a fork of the
          component, which is how the two shells started diverging last time. */}
      {cloud ? (
        <span className="st-cloudback" data-testid="cloud-back">
          {/* Only when there IS somewhere to go back TO. `dashboardUrl` is
              absent on a self-hosted hub (one hub serves one project, so there
              is no dashboard), and a hardcoded fallback here quietly re-created
              the exact bug the server side just stopped: the link is the ONE
              way out this tab offers, and it pointed at cloud.maude.sh. The
              project name below stays either way — a tab must still say which
              project it is showing. */}
          {cloud.dashboardUrl ? (
            <a
              className="st-cloudback-link"
              href={cloud.dashboardUrl}
              title="Back to your projects"
            >
              ← Dashboard
            </a>
          ) : null}
          {cloud.projectName ? (
            <span className="st-cloudback-project" data-testid="cloud-project-name">
              {cloud.projectName}
            </span>
          ) : null}
        </span>
      ) : null}
      <nav className="st-menus" aria-label="Application menus" data-tour="menus">
        {MENU_NAMES.map((name) => {
          const key = name.toLowerCase();
          const hasDropdown = DROPDOWN_MENUS.includes(key);
          const interactive = hasDropdown || key === 'help';
          const open = openMenu === key;
          return (
            <button
              key={key}
              type="button"
              className="st-menu"
              role="menuitem"
              data-tour={key === 'help' ? 'help' : undefined}
              aria-haspopup={hasDropdown ? 'menu' : undefined}
              aria-expanded={hasDropdown ? open : undefined}
              onClick={() => onMenuClick(key)}
              // F4 — once any menu is open, hovering another trigger switches to
              // it (base-ui menubar behavior). Only among dropdown menus.
              onMouseEnter={() => {
                if (openMenu !== null && hasDropdown) setOpenMenu(key);
              }}
            >
              {name}
            </button>
          );
        })}
      </nav>
      {openMenu === 'file' && (
        <FileDropdown
          readOnly={readOnly}
          hasCanvas={!!activePath}
          onAction={(id) => {
            if (id === 'new') onNewCanvas?.();
            else if (id === 'assemble') onAssembleVideo?.();
            else if (id === 'export') onOpenExport?.('export');
            else if (id === 'handoff') onOpenExport?.('handoff');
            else if (id === 'generate') onOpenGenerate?.();
            else if (id === 'settings') onOpenSettings?.();
            else if (id === 'reload') onReload?.();
            else if (id === 'close') onCloseCanvas?.();
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'edit' && (
        <EditDropdown
          readOnly={readOnly}
          hasCanvas={!!activePath && !isSystem}
          onAction={(id) => {
            if (id === 'undo') postToActiveCanvas({ dgn: 'undo' });
            else if (id === 'redo') postToActiveCanvas({ dgn: 'redo' });
            else if (id === 'deselect-all') postToActiveCanvas({ dgn: 'selection-clear' });
            else if (id === 'select-all-annotations')
              postToActiveCanvas({ dgn: 'annotation-select-all' });
            else if (id.startsWith('new-artboard:'))
              onInsertArtboard?.(id.slice('new-artboard:'.length));
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'view' && (
        <ViewDropdown
          panels={panels}
          onToggle={(id) => {
            if (id === 'tree') onToggleSidebar();
            else if (id === 'changes') onToggleChanges();
            else if (id === 'comments') onToggleComments();
            else if (id === 'hidden') onToggleShowHidden();
            else if (id === 'annotate') onToggleAnnotations();
            else if (id === 'inspector') onToggleInspector();
            else if (id === 'autoopen') onToggleAutoOpenInspector?.();
            else if (id === 'timeline') onToggleTimeline?.();
            else if (id === 'assistant') onToggleAssistant?.();
            else if (id === 'layers') onOpenLayers?.();
            else if (id === 'minimap') onToggleMinimap?.();
            else if (id === 'zoomctl') onToggleZoomCtl?.();
            else if (id === 'present') onTogglePresent?.();
            else if (id === 'print-guides') onTogglePrintGuides?.();
          }}
          onZoom={(op) => postToActiveCanvas({ dgn: 'zoom', op })}
          hasCanvas={!!activePath && !isSystem}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'selection' && (
        <SelectionDropdown
          readOnly={readOnly}
          onAction={(id) => {
            if (id === 'deselect-all') postToActiveCanvas({ dgn: 'selection-clear' });
            else if (id === 'select-all-annotations')
              postToActiveCanvas({ dgn: 'annotation-select-all' });
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'tools' && (
        <ToolsDropdown
          readOnly={readOnly}
          onAction={(tool) => postToActiveCanvas({ dgn: 'tool-set', tool })}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'help' && (
        <HelpDropdown
          onAction={(id) => {
            if (id === 'shortcuts') onOpenShortcuts?.();
            else if (id === 'help') onOpenHelp?.();
            else if (id === 'report-bug') onReportBug?.();
            else if (id === 'tour') onStartTour?.();
            else if (id === 'collab-tour') onStartCollabTour?.();
            else if (id === 'quick-setup') onOpenQuickSetup?.();
            else if (id === 'readiness') onOpenReadiness?.();
            else if (id === 'whatsnew') onOpenWhatsNew?.();
            else if (id === 'watch-intro') onWatchIntro?.();
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      <div className="st-mb-right" data-tour="status">
        {presence ? <div className="st-presence">{presence}</div> : null}
        {readOnly && (
          <span
            className="st-stamp st-stamp--viewonly"
            data-testid="view-only-stamp"
            data-tip={
              cloud?.user
                ? `${cloud.user} is a viewer on this project — you can browse, comment and export where available. Ask a project owner for edit access, or sign out if that is not the account you meant to use.`
                : 'Your role in this project is viewer — you can browse, comment when available, and export where available. Ask a project owner for edit access.'
            }
          >
            VIEW ONLY
          </span>
        )}
        {/* Cloud Phase 27 C4 — WHO YOU ARE, AND HOW TO STOP BEING THEM.
            A browser tab carries no account identity of its own: the cookie is
            invisible, and the only thing on screen that reflected it was a
            three-word stamp. An owner who read VIEW ONLY had no way to tell
            whether the role was wrong or the ACCOUNT was, and no way to change
            either — the session outlived any fix by up to twelve hours because
            nothing in the studio could end it. This ends it. */}
        {cloud?.user ? (
          <span className="st-cloudwho" data-testid="cloud-account">
            <span
              className="st-cloudwho-email"
              title={cloud.role ? `Signed in as ${cloud.user} — ${cloud.role}` : cloud.user}
            >
              {cloud.user}
            </span>
            {/* A FORM, not a link. Signing out revokes the token server-side,
                so it is a write — and a write behind a GET is one any page can
                force on you from across the internet. */}
            <form method="post" action="/auth/browser/signout" className="st-cloudwho-form">
              <button
                type="submit"
                className="st-cloudwho-out"
                data-testid="cloud-signout"
                title="Sign out of this project"
              >
                Sign out
              </button>
            </form>
          </span>
        ) : null}
        {isNativeApp() && !readOnly && (
          <button
            type="button"
            className="st-assistant"
            data-testid="assistant-toggle"
            data-active={assistantOpen ? 'true' : 'false'}
            data-busy={assistantBusy ? 'true' : 'false'}
            data-unseen={assistantUnseen ? 'true' : 'false'}
            aria-label={`Assistant${assistantBusy ? ' — working' : assistantUnseen ? ' — new reply' : ''}`}
            data-tip="Assistant  ⌘⇧A"
            onClick={onToggleAssistant}
          >
            <StIcon name="sparkle" size={15} />
          </button>
        )}
        {exportCenter && <ExportBadge center={exportCenter} />}
        <button
          type="button"
          className="st-reportbug"
          data-testid="report-bug-toggle"
          aria-label="Report a bug"
          data-tip="Report a bug"
          onClick={onReportBug}
        >
          <StIcon name="bug" size={15} />
        </button>
        <button
          type="button"
          className="st-whatsnew"
          data-tour="whatsnew"
          data-unseen={whatsNewCount > 0 ? 'true' : 'false'}
          aria-label={`What's new${whatsNewCount > 0 ? ` — ${whatsNewCount} unseen` : ''}`}
          data-tip="What's new"
          onClick={onOpenWhatsNew}
        >
          <StIcon name="megaphone" size={15} />
        </button>
        <span className="st-stamp">{stamp}</span>
        <span className="st-mb-file" title={activePath || ''}>
          {fileLabel}
        </span>
        <span className="st-mb-sep" />
        <span className="st-mb-count" data-tip="Artboards in the open canvas">
          <span className="st-dot" style={{ background: 'var(--accent)' }} />
          {artboardCount} ARTBOARDS
        </span>
        <span className="st-mb-sep" />
        <span className="st-mb-proj">{project || 'maude'}</span>
      </div>
    </header>
  );
}

function Viewport({
  tabs,
  activePath,
  registerIframe,
  systemData,
  onOpenFromSystem,
  onSelectDs,
  project,
  cfg,
  loadingPath,
  onIframeLoad,
  canvasError,
  canvasReloadNonce,
  onRetryCanvasLoad,
  loadedPath,
  showQuickSetup,
  onStartQuickSetup,
  previewPath,
}) {
  // feature-studio-file-preview (a11y fix) — a11y-auditor found the preview
  // overlay gave keyboard/AT users no signal anything happened: the click
  // stayed on the (unrelated) tree row, nothing was announced, and the
  // scrollable region itself wasn't in the tab order. Moving focus onto the
  // region on open covers all three: it's a real focus change (AT announces
  // the new `role="region"` + its label), and a focused element with
  // `overflow: auto` is keyboard-scrollable (arrow/Page keys) without a
  // separate tabIndex fix.
  const previewRef = useRef(null);
  useEffect(() => {
    if (previewPath) previewRef.current?.focus();
  }, [previewPath]);
  // One observable word for "what is the canvas pane actually doing" — the
  // top-frame signal the #115 E2E scenario waits on, and the only place these
  // three states are named together. `ready` is `dgn:'loaded'`-backed, so it
  // cannot be faked by a timer expiring (which is exactly how the bug used to
  // look successful: skeleton gone, pane white).
  const canvasState =
    canvasError && canvasError.path === activePath
      ? 'error'
      : activePath && activePath !== SYSTEM_TAB && loadedPath === activePath
        ? 'ready'
        : loadingPath && loadingPath === activePath
          ? 'loading'
          : 'idle';
  return (
    <div className="viewport st-stage" data-tour="viewport" data-canvas-state={canvasState}>
      {previewPath && (
        // feature-studio-file-preview — an overlay, not a tab: the canvas
        // iframe (if any) stays mounted underneath so switching back to it
        // is instant and never remounts. previewPath is intentionally never
        // written into `tabs`/`activePath` (see App()'s onPreview).
        <div
          ref={previewRef}
          className="st-file-preview-overlay"
          role="region"
          aria-label={`Preview: ${sanitizeDisplayText(basename(previewPath))}`}
          tabIndex={0}
        >
          <FilePreview path={previewPath} kind={previewKind(basename(previewPath))} />
        </div>
      )}
      {tabs.length === 0 && !previewPath && (
        <div className="st-empty">
          <div className="st-empty-brand">
            <span className="st-brand-mark">
              <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true"><path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" /></svg>
            </span>
            <span className="st-empty-wm">maude</span>
            <span className="st-empty-sub st-mono">
              CANVAS · {(project || 'MAUDE').toUpperCase()} / v{MDCC_VERSION} /
              localhost:{typeof window !== 'undefined' ? window.location.port : '4399'}
            </span>
          </div>
          <div className="st-empty-title">Nothing open yet</div>
          <div className="st-empty-body">
            ← Pick a screen from the list on the left, or open <strong>Design system</strong> above
            it to see your colors, type, and components.
            <br />
            <br />
            <strong>To select something on the canvas:</strong> hold <Kbd>⌘</Kbd> and hover to
            preview an element, click to select it — <Kbd>⌘⇧</Kbd>+click selects more than one.
            Right-click for more options.
            {isNativeApp() ? (
              <>
                <br />
                <br />
                Claude can see whatever's selected when you ask for a change in the Assistant
                panel, so pointing is often faster than describing it.
              </>
            ) : null}
          </div>
          {showQuickSetup && (
            <button
              type="button"
              data-testid="st-empty-start-quick-setup"
              className="btn btn--primary st-empty-quick-setup"
              onClick={onStartQuickSetup}
            >
              Start quick setup
            </button>
          )}
        </div>
      )}
      {tabs.map((t) => {
        if (t.path === SYSTEM_TAB) {
          return (
            <div key={t.path} className={'system-view' + (t.path === activePath ? ' active' : '')}>
              <SystemView
                data={systemData}
                onOpen={onOpenFromSystem}
                cfg={cfg}
                onSelectDs={onSelectDs}
              />
            </div>
          );
        }
        return (
          <iframe
            // The nonce is part of the key ONLY so the #115 Retry can force a
            // remount; it is otherwise constant, so normal switching keys on the
            // path exactly as before.
            key={`${t.path}#${canvasReloadNonce}`}
            ref={(el) => registerIframe(t.path, el)}
            src={canvasUrl(t.path, cfg)}
            className={t.path === activePath ? 'active' : ''}
            data-path={t.path}
            data-testid={t.path === activePath ? 'canvas-frame' : undefined}
            onLoad={() => onIframeLoad?.(t.path)}
            // T2 (9.1-A) — only sandbox + delegate clipboard when the canvas is
            // served cross-origin (canvasOrigin present = the split is on). In
            // the default same-origin mode these attrs are omitted so behavior
            // is identical to pre-9.1. allow-same-origin gives the cross-origin
            // frame its OWN origin (own WS/fetch/storage), NOT the parent's.
            {...(cfg?.canvasOrigin
              ? { sandbox: 'allow-scripts allow-same-origin', allow: 'clipboard-write' }
              : {})}
          />
        );
      })}
      {loadingPath && loadingPath === activePath && (
        // DS skeletons recipe — calm .skel pulse while the canvas-shell compiles
        // the TSX. Cleared by the iframe's dgn:'loaded' message (or the onLoad
        // fallback timer for legacy .html canvases that never post it).
        <div className="st-canvas-loading" aria-hidden="true">
          <div className="st-skel-card">
            <div className="st-skel-cap st-mono">compiling canvas…</div>
            <span className="skel st-skel-thumb" />
            <span className="skel st-skel-line" style={{ width: '72%' }} />
            <span className="skel st-skel-line" style={{ width: '46%' }} />
          </div>
        </div>
      )}
      {canvasError && canvasError.path === activePath && (
        // issue #115 — what the blank pane used to be. Names which of the two
        // failures happened and offers the recovery that used to require
        // quitting the app (or knowing that switching projects and back
        // re-reads /_config).
        <div className="st-canvas-error" role="alert" data-testid="canvas-load-error">
          <div className="st-canvas-error-card">
            <div className="st-canvas-error-title">
              {canvasError.kind === 'server'
                ? "Maude's server isn't responding"
                : "This canvas didn't finish loading"}
            </div>
            <div className="st-canvas-error-body">
              {canvasError.kind === 'server' ? (
                <>
                  The canvas couldn't be reached. This usually means Maude's
                  server restarted underneath this window — your files on disk
                  are untouched.
                </>
              ) : (
                <>
                  The server is up, but{' '}
                  <code>{sanitizeDisplayText(basename(canvasError.path))}</code>{' '}
                  never finished compiling. Its own error, if it has one, is in
                  the canvas frame.
                </>
              )}
            </div>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="canvas-load-retry"
              onClick={() => onRetryCanvasLoad?.(canvasError.path)}
            >
              Reload canvas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- SystemView ----------
//
// DDR-048 — the System view renders the USER's design-system tokens. It does
// NOT read from `document.documentElement` (that would surface the dev-server
// shell's amber-rust chrome theme from styles/1-tokens.css, which is NOT a
// user template) and it does NOT assume any canonical token-name contract.
// Whatever the user's `colors_and_type.css` declared — names, values, theme
// blocks — is what shows up here.

// Order kinds match the typical reading flow of a tokens file. Unknown kinds
// fall through to `other` so a custom token group still renders, just last.
const TOKEN_GROUP_ORDER = [
  'color',
  'space',
  'radius',
  'shadow',
  'leading',
  'weight',
  'motion',
  'font',
  'other',
];
const TOKEN_GROUP_LABELS = {
  color: 'colors',
  space: 'spacing',
  radius: 'radii',
  shadow: 'shadows',
  leading: 'leading',
  weight: 'weights',
  motion: 'motion',
  font: 'font stacks',
  other: 'other',
};

function isSwatchKind(kind) {
  return kind === 'color';
}

function TokenLadder({ tokens, tokenGroups, tokensPath }) {
  if (!tokens || tokens.length === 0) {
    return (
      <section className="sv-section sv-section-tokens">
        <h2>
          tokens<span className="sv-h-num">0</span>
        </h2>
        <div className="sv-empty">
          <p>
            No tokens parsed from{' '}
            {tokensPath ? <code>{tokensPath}</code> : 'the configured tokens file'}. Does the file
            exist and contain CSS custom properties (<code>--name: value;</code>)?
          </p>
        </div>
      </section>
    );
  }

  const groups = tokenGroups || {};
  const kinds = Array.from(new Set([...TOKEN_GROUP_ORDER, ...Object.keys(groups)])).filter(
    (k) => groups[k]?.length
  );

  return (
    <>
      {kinds.map((kind) => {
        const list = groups[kind];
        const swatch = isSwatchKind(kind);
        return (
          <section className={'sv-section sv-section-tokens sv-section-' + kind} key={kind}>
            <h2>
              tokens · {TOKEN_GROUP_LABELS[kind] || kind}
              <span className="sv-h-num">{list.length}</span>
            </h2>
            <div className="sv-tokens-ladder">
              {list.map((t) => (
                <div className="sv-tok-cell" key={t.name + '|' + t.value}>
                  {swatch ? (
                    <div className="sv-tok-swatch" style={{ background: t.value }} />
                  ) : null}
                  <div className="sv-tok-meta">
                    <code className="sv-tok-name">{t.name}</code>
                    <span className="sv-tok-value">{t.value || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

// Find a leading partner by name suffix: --fs-base → --lh-base, --type-xl → --lh-xl.
// Returns null when no convention match exists; caller omits the lineHeight style.
function findLeadingFor(typeToken, leadingTokens) {
  const m = typeToken.name.match(/^--(?:type|fs|text)-(.+)$/);
  if (!m) return null;
  const suffix = m[1];
  return (
    (leadingTokens || []).find(
      (t) => /^--(?:lh|leading|line-height)-/.test(t.name) && t.name.endsWith('-' + suffix)
    )?.value ?? null
  );
}

// Best-effort sample font: prefer body / sans / display tokens, fall back to
// the first font-kind token, fall back to system-ui. Avoids the shell's
// Berkeley Mono leaking into user-facing previews.
function sampleFontFamily(fontTokens) {
  if (!fontTokens?.length) return undefined;
  const prefer = ['body', 'sans', 'display', 'text', 'family'];
  for (const tag of prefer) {
    const hit = fontTokens.find((t) => t.name.includes(tag));
    if (hit) return hit.value;
  }
  return fontTokens[0].value;
}

function TypeLadder({ tokenGroups }) {
  const typeTokens = tokenGroups?.fontsize || [];
  if (typeTokens.length === 0) return null;
  const leadingTokens = tokenGroups?.leading || [];
  const sampleFont = sampleFontFamily(tokenGroups?.font);

  return (
    <section className="sv-section sv-section-type">
      <h2>
        type · ladder<span className="sv-h-num">{typeTokens.length}</span>
      </h2>
      <div className="sv-type-list">
        {typeTokens.map((t) => {
          const lh = findLeadingFor(t, leadingTokens);
          const style = { fontSize: t.value };
          if (lh) style.lineHeight = lh;
          if (sampleFont) style.fontFamily = sampleFont;
          return (
            <div className="sv-type-row" key={t.name}>
              <code className="sv-type-tok">{t.name}</code>
              <span className="sv-type-sample" style={style}>
                The catalog is the system.
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SystemView({ data, onOpen, cfg, onSelectDs }) {
  if (!data) {
    return (
      <div className="sv-empty">
        <p>Loading design system…</p>
      </div>
    );
  }
  const {
    previewGallery,
    uiKitsGallery,
    systemDir,
    tokens,
    tokenGroups,
    tokensPath,
    ds,
    availableDesignSystems,
  } = data;
  const empty =
    (!previewGallery || !previewGallery.length) && (!uiKitsGallery || !uiKitsGallery.length);
  const hasPicker = Array.isArray(availableDesignSystems) && availableDesignSystems.length > 1;
  const selectedName = ds?.name ?? availableDesignSystems?.[0]?.name ?? '';

  return (
    <div className="sv">
      <header className="sv-header">
        <span className="sv-sku">MAUDE-DSN/01</span>
        <span className="sv-title">design system view</span>
        {hasPicker ? (
          <label className="sv-ds-picker">
            <span className="sv-ds-picker-label">DS</span>
            <select value={selectedName} onChange={(e) => onSelectDs && onSelectDs(e.target.value)}>
              {availableDesignSystems.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="sv-loc">
          <code>{systemDir}</code>
        </span>
      </header>

      {ds?.description ? <p className="sv-ds-description">{ds.description}</p> : null}

      <TokenLadder tokens={tokens} tokenGroups={tokenGroups} tokensPath={tokensPath} />
      <TypeLadder tokenGroups={tokenGroups} />

      {empty ? (
        <div className="sv-empty">
          <p>
            No <code>preview/</code> or <code>ui_kits/</code> folders found under{' '}
            <code>{systemDir}</code>.
          </p>
        </div>
      ) : (
        <>
          <Gallery
            title="preview"
            items={previewGallery}
            onOpen={onOpen}
            kind="preview"
            cfg={cfg}
          />
          <Gallery title="ui kits" items={uiKitsGallery} onOpen={onOpen} kind="ui_kits" cfg={cfg} />
        </>
      )}
    </div>
  );
}

function Gallery({ title, items, onOpen, kind, cfg }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="sv-section">
      <h2>
        {title} <span className="sv-count">{items.length}</span>
      </h2>
      <div className={'sv-previews sv-previews-' + kind}>
        {items.map((p) => (
          <article key={p.path} className="sv-preview-card" onClick={() => onOpen(p.path)}>
            <div className="sv-preview-frame">
              <iframe
                src={canvasUrl(p.path, cfg, { thumbnail: true })}
                title={p.label}
                scrolling="no"
                {...(cfg?.canvasOrigin ? { sandbox: 'allow-scripts allow-same-origin' } : {})}
              />
            </div>
            <div className="sv-preview-foot">
              <strong>{p.label}</strong>
              <code>{p.path}</code>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------- Comment composer / viewer ----------

function StatusBar({
  activePath,
  selected,
  wsConnected,
  openCount,
  theme,
  onToggleTheme,
  onClearSelected,
  syncStatus,
  syncProject,
  syncOpen = false,
  onOpenSync,
  changesCount = 0,
  unpushed = 0,
  // Somebody else commits this project (a cloud cell, or the cell behind a
  // linked+credentialed desktop repo — DDR-218). The chip then names the
  // mechanism that IS saving rather than reporting a working-tree count the
  // user has no reason to act on. Default false = today's local-first chip.
  savingIsManaged = false,
  changesOpen = false,
  onOpenChanges,
  version,
}) {
  const isSystem = activePath === SYSTEM_TAB;
  const text =
    selected && selected.selector
      ? selected.selector + (selected.text ? ` — "${selected.text.slice(0, 60)}"` : '')
      : '';
  const title =
    selected && selected.dom_path
      ? selected.dom_path.join(' > ')
      : selected
        ? selected.selector
        : '';
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  // P5 (Plan C) — always-on hub-sync slot. `/_sync-status` returns one of three
  // shapes: solo `{linked:false}` (hide), DDR-060 `{notSyncable,tsxCount,reason}`
  // (linked but 0 syncable), or the connection-state machine `{state,queuedOps,
  // flash,…}` (the common linked case the old notSyncable-only guard never
  // showed — the "hub sync se neukazuje" bug).
  //
  // The mapping used to live here, and it referenced `docs` ZERO times: it read
  // `state` alone, so a link whose every document the hub had refused still
  // showed a green dot and the word "synced". `syncPresentation` is now the one
  // rule, shared with the cloud rail's connect note, so the two surfaces cannot
  // give a person different answers about the same payload.
  const syncSlot = (() => {
    const p = syncPresentation(syncStatus, { project: syncProject });
    if (!p) return null;
    const detail = p.names.length ? ` (${p.names.join(', ')})` : '';
    return {
      online: p.online,
      label: p.label,
      title: `${p.title}${detail}${p.next ? ` — ${p.next}` : ''}`,
    };
  })();
  // One body for both chip forms (button vs plain span) below.
  const syncSlotBody = syncSlot && (
    <>
      <span
        className={'st-sb-sync-dot' + (syncSlot.online ? ' is-online' : '')}
        aria-hidden="true"
      />
      <span className="lbl">hub sync</span>
      <span className="val" title={syncSlot.title}>
        {syncSlot.label}
      </span>
    </>
  );

  return (
    <footer className="st-statusbar" role="contentinfo" data-testid="statusbar">
      <span className="st-sb-slot st-sb-active" role="group" aria-label="Active file">
        <span className="lead" aria-hidden="true" />
        <span className="lbl">active</span>
        <span className="val" title={activePath || ''}>
          {isSystem ? '▦ design system' : activePath || '—'}
        </span>
      </span>

      {/* Selection is meaningless without an open canvas — a stale _active.json
          selection used to leave a ghost SELECTED chip on the empty shell. */}
      {activePath && selected && selected.selector && !isSystem && (
        <span className="st-sb-slot st-sb-sel" role="group" aria-label="Selected element">
          <span className="lbl">selected</span>
          <span className="val" title={title}>
            {text}
          </span>
          <button
            type="button"
            className="st-sb-sel-clear"
            onClick={onClearSelected}
            data-tip="Clear · Esc inside iframe"
            data-tip-pos="top"
            aria-label="Clear selection"
          >
            ×
          </button>
        </span>
      )}

      <span className="st-sb-slot" role="group" aria-label="Open comments">
        <span className="lbl">comments</span>
        <span className="val">{openCount} open</span>
      </span>

      {/* Phase 28 — changes count, click to open the Changes panel (⌘⇧G). */}
      {onOpenChanges && (
        <button
          type="button"
          className={
            'st-sb-slot st-sb-changes' +
            (changesOpen ? ' is-open' : '') +
            (changesCount > 0 ? ' has-changes' : unpushed > 0 ? ' has-unpushed' : '')
          }
          onClick={onOpenChanges}
          data-testid="open-changes"
          data-tip="Open Changes · ⌘⇧G"
          data-tip-pos="top"
          aria-label="Open Changes panel"
          aria-pressed={changesOpen}
        >
          <span className="st-sb-changes-dot" aria-hidden="true" />
          <span className="lbl">changes</span>
          <span className="val">
            {savingIsManaged
              ? // Not "all saved": assets and project config are written into the
                // cell's checkout but never committed there, so asserting a clean
                // save would overstate what the cloud actually holds. Naming the
                // mechanism is both honest and the thing the user needs to know.
                'cloud saving'
              : changesCount > 0
                ? `${changesCount} unsaved`
                : unpushed > 0
                  ? `${unpushed} to publish`
                  : 'all saved'}
          </span>
        </button>
      )}

      <span className="st-sb-spacer" />

      <span className="st-sb-slot" role="group" aria-label="Connection">
        <span className={'st-live-dot' + (wsConnected ? ' is-connected' : '')} aria-hidden="true" />
        <span className="lbl">{wsConnected ? 'live' : 'reconnecting'}</span>
      </span>

      {/* P5 (Plan C) — always-on hub-sync slot (was notSyncable-only per DDR-060
          / 9.1-D). Now also surfaces the connection-state machine's queued/synced
          counter for the common linked case. Solo projects render nothing.
          feature-sync-progress-modal — a BUTTON that toggles the per-file Sync
          panel (like the Changes chip toggles GitPanel); the plain-span form
          stays for servers/sessions that pass no handler. */}
      {syncSlot &&
        (onOpenSync ? (
          <button
            type="button"
            className={'st-sb-slot st-sb-sync st-sb-sync--btn' + (syncOpen ? ' is-open' : '')}
            onClick={onOpenSync}
            data-testid="open-sync"
            data-tip="Open Sync panel"
            data-tip-pos="top"
            aria-label="Open Sync panel"
            aria-pressed={syncOpen}
          >
            {syncSlotBody}
          </button>
        ) : (
          <span className="st-sb-slot st-sb-sync" role="group" aria-label="Hub sync">
            {syncSlotBody}
          </span>
        ))}

      {/* Which release this is. Reading it used to mean probing production by
          hand — and the desktop, the browser and a cloud tab all serve the same
          client, so one slot covers all three. Absent on an older server that
          omits `version` from /_config, exactly as `cloud` and `canvasToken`
          already are. */}
      {version && (
        <span className="st-sb-slot st-sb-version" role="group" aria-label="Maude version">
          <span className="val" data-testid="statusbar-version">
            v{version}
          </span>
        </span>
      )}

      <button
        type="button"
        className="st-sb-theme"
        onClick={onToggleTheme}
        data-tip={`Switch to ${nextTheme} theme`}
        data-tip-pos="top"
        aria-label={`Switch to ${nextTheme} theme`}
      >
        <StIcon name={theme === 'dark' ? 'sun' : 'moon'} size={13} />
        {nextTheme}
      </button>
    </footer>
  );
}

// ---------- Right sidebar — Comments panel ----------

function CommentsPanel({
  commentsByFile,
  filter,
  setFilter,
  activePath,
  focusedId,
  onJump,
  onResolve,
  onReopen,
  onDelete,
  width,
  resizing,
}) {
  const counts = totalCounts(commentsByFile);
  // Build groups: [{ file, comments: filtered }]
  const files = Object.keys(commentsByFile || {}).sort();
  const groups = [];
  for (const f of files) {
    const all = commentsByFile[f] || [];
    const filtered = all.filter((c) => {
      if (filter === 'open') return c.status !== 'resolved';
      if (filter === 'resolved') return c.status === 'resolved';
      return true;
    });
    if (filtered.length === 0) continue;
    // Number is fixed by all-list order so it matches pin numbers (which are based on position in the array of selector-having comments)
    const numberedAll = all.filter((c) => c.selector);
    groups.push({
      file: f,
      comments: filtered.map((c) => ({
        ...c,
        n: numberedAll.findIndex((x) => x.id === c.id) + 1,
      })),
    });
  }

  return (
    <aside
      className={'st-rpanel' + (resizing ? ' is-resizing' : '')}
      style={width ? { width, flexBasis: width } : undefined}
      aria-label="Comments"
    >
      <div className="st-rp-tabs st-rp-tabs--filters">
        <div className="st-cm-filters" role="tablist">
          <button
            type="button"
            className={'st-cm-filter' + (filter === 'all' ? ' is-active' : '')}
            role="tab"
            aria-selected={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All · {counts.all}
          </button>
          <button
            type="button"
            className={'st-cm-filter' + (filter === 'open' ? ' is-active' : '')}
            role="tab"
            aria-selected={filter === 'open'}
            onClick={() => setFilter('open')}
          >
            Open · {counts.open}
          </button>
          <button
            type="button"
            className={'st-cm-filter' + (filter === 'resolved' ? ' is-active' : '')}
            role="tab"
            aria-selected={filter === 'resolved'}
            onClick={() => setFilter('resolved')}
          >
            Resolved · {counts.resolved}
          </button>
        </div>
      </div>
      <div className="st-rp-body" style={{ gap: 'var(--space-4)' }}>
        {groups.length === 0 ? (
          <div className="st-rp-empty">
            <p>No comments {filter !== 'all' ? `with status “${filter}”` : 'yet'}.</p>
            <p>
              Open a canvas, hold <Kbd>⌘</Kbd> and click an element, then press <Kbd>C</Kbd> — or
              hold <Kbd>⌘⇧</Kbd> and click directly.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <Fragment key={g.file}>
              <button
                type="button"
                className="st-cm-group-hd"
                onClick={() => onJump(g.file, null)}
                title={g.file}
              >
                <span>{displayName(basename(g.file))}</span>
                <span className="st-mono">{g.comments.length}</span>
              </button>
              {g.comments.map((c) => (
                <div
                  key={c.id}
                  className={
                    'st-comment' +
                    (c.status === 'resolved' ? ' is-resolved' : '') +
                    (c.id === focusedId ? ' is-active' : '')
                  }
                  onClick={() => onJump(g.file, c.id)}
                >
                  <div className="st-comment-hd">
                    <span className="st-pin st-pin--inline">{c.n || '·'}</span>
                    <span className="st-comment-time">{timeAgo(c.created)}</span>
                  </div>
                  <div className="st-comment-txt">{c.text}</div>
                  <div className="st-comment-foot">
                    <span className="st-comment-sel" title={(c.dom_path || []).join(' > ')}>
                      {c.selector || '—'}
                    </span>
                    {/* Cloud Phase 25 C2 — absent handlers (viewer) ⇒ no
                        mutating actions; the thread stays readable. */}
                    {onResolve && onReopen && onDelete ? (
                      <span className="st-mini-act">
                        {c.status === 'resolved' ? (
                          <button
                            type="button"
                            className="st-iconbtn"
                            aria-label="Reopen"
                            onClick={(e) => {
                              e.stopPropagation();
                              onReopen(c.id);
                            }}
                          >
                            <StIcon name="reopen" size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="st-iconbtn"
                            aria-label="Resolve"
                            onClick={(e) => {
                              e.stopPropagation();
                              onResolve(c.id);
                            }}
                          >
                            <StIcon name="resolve" size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="st-iconbtn"
                          aria-label="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(c.id);
                          }}
                        >
                          <StIcon name="x" size={14} />
                        </button>
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </Fragment>
          ))
        )}
      </div>
    </aside>
  );
}

// ---------- Sync banner (Phase 9 Task 8 — hub-down offline mode) ----------

// Renders nothing when online with no flash (the common case). Yellow strip
// while offline (with queued-edit count), red when offline > 24h, green flash
// for 3s right after a reconnect. Driven entirely by the 'sync:status' payload
// the dev-server's linked-mode sync runtime broadcasts.
// Phase 32 (Task 1) — auto-update notice. Shown after the shell has downloaded +
// staged a newer build in the background. Non-blocking: "Restart now" applies it,
// "Later" dismisses (the next focus/4h check re-stages and re-surfaces it).
/**
 * What this role can do, said once, where a teammate lands — Cloud Phase 27 C3.
 *
 * A browser tab arrives with none of the context a desktop has: no window
 * title, no app the person chose to install, and — for a viewer — a set of
 * controls that will refuse them without explaining why. One line, dismissible,
 * remembered per role. It re-appears if the role CHANGES, because "you can edit
 * this now" is worth saying exactly as much as the first sentence was.
 *
 * Copy comes from the role the cell vouched (`role-matrix.mjs` is the authority
 * on what each one means; this is its sentence, not a second opinion).
 */
const ROLE_LINE = {
  owner: 'You own this project — edit, invite and export.',
  member: 'You can edit this project, comment and export.',
  viewer: 'You can look at this project, comment and download it, but not change it.',
};

function CloudRoleBanner({ cloud }) {
  const role = cloud?.role || null;
  // Dismissal is READ AT RENDER, not seeded into state. `cfg.cloud` is
  // `undefined` until `/_config` lands, so a `useState` initializer runs while
  // there is no role yet — and whatever it decided then would stick forever,
  // which on the first attempt meant the banner never appeared at all. Found by
  // opening it in a browser; no test in this repo would have said a word.
  const [dismissedNow, setDismissedNow] = useState(false);
  if (!role || dismissedNow) return null;
  const storageKey = `maude-cloud-role-seen:${role}`;
  let alreadySeen = false;
  try {
    alreadySeen = localStorage.getItem(storageKey) === '1';
  } catch {
    /* private mode / storage disabled — show it, saying it twice beats never */
  }
  if (alreadySeen) return null;
  const line = ROLE_LINE[role];
  if (!line) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="st-banner st-banner--info"
      data-testid="cloud-role-banner"
    >
      <span className="st-banner-dot" aria-hidden="true" />
      <span>{line}</span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        data-testid="cloud-role-banner-dismiss"
        onClick={() => {
          setDismissedNow(true);
          try {
            localStorage.setItem(storageKey, '1');
          } catch {}
        }}
      >
        Got it
      </button>
    </div>
  );
}

function UpdateBanner({ update, onDismiss }) {
  const [restarting, setRestarting] = useState(false);
  if (!update) return null;
  const ver = update.version ? ` (v${update.version})` : '';
  return (
    <div role="status" aria-live="polite" className="st-banner st-banner--info">
      <span className="st-banner-dot" aria-hidden="true" />
      <span>Maude updated{ver} · restart to apply</span>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          restartToUpdate().catch(() => setRestarting(false));
        }}
      >
        {restarting ? 'Restarting…' : 'Restart now'}
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
        Later
      </button>
    </div>
  );
}

function SyncBanner({ status }) {
  // Plan C follow-up — the banner overlapped the menubar and wasn't dismissable.
  // Dismissal is keyed on the connection state, so a transition (reconnect flash,
  // escalation to offline-long) re-surfaces it; a stable state stays hidden.
  const [dismissedKey, setDismissedKey] = useState(null);
  if (!status || status.linked === false) return null;
  // DDR-060 / 9.1-D — the "linked but 0 syncable" state is surfaced in the
  // status bar (sb-sync slot), NOT as a floating banner. This component owns
  // the transient offline / reconnect-flash banner (Task 8) plus the DDR-102
  // rejected-docs chip and divergence-resolution toast.
  if (status.notSyncable) return null;
  const { state, queuedOps, flash, conflicts } = status;
  const showFlash = flash === 'synced';
  const offline = state === 'offline' || state === 'offline-long';
  // DDR-102 — per-doc rollup + the latest divergence notice (additive fields;
  // an old payload without them renders exactly the pre-DDR-102 banner).
  const rejected = status.docs?.rejected ?? 0;
  const lastDiverged = Array.isArray(conflicts)
    ? [...conflicts].reverse().find((c) => c.kind === 'cold-start-diverged')
    : null;
  if (!offline && !showFlash && !lastDiverged && rejected === 0) return null;

  // One banner at a time — priority: reconnect flash > offline > divergence
  // toast > rejected chip. Dismissal is keyed per state so a new event
  // (another conflict, a changed rejected count) re-surfaces it.
  let variant;
  let text;
  let dismissKey;
  if (showFlash) {
    variant = 'success';
    text = 'Synced with hub';
    dismissKey = `${state}:flash`;
  } else if (offline) {
    const conflictNote =
      conflicts && conflicts.length > 0 ? ` (${conflicts.length} conflict notice(s))` : '';
    if (state === 'offline-long') {
      variant = 'error';
      text = `Long offline — ${queuedOps} edit(s) queued. Consider \`git commit && git push\` as backup.${conflictNote}`;
    } else {
      variant = 'warn';
      text = `Working offline · ${queuedOps} edit(s) queued · will sync when the hub reconnects.${conflictNote}`;
    }
    dismissKey = `${state}:offline`;
  } else if (lastDiverged) {
    // DDR-102 fail-closed: a snapshotFailed conflict means the hub-wins overwrite
    // was REFUSED (local kept) because _history couldn't be written — surface it
    // as an error, not a routine "kept newest" notice.
    if (lastDiverged.snapshotFailed) {
      variant = 'error';
      text = `Diverged on ${lastDiverged.slug}: kept local — the history snapshot FAILED, so the overwrite was refused. Check disk space / .design/_history write access.`;
    } else {
      variant = 'warn';
      text = `Diverged on ${lastDiverged.slug}: kept the ${
        lastDiverged.winner === 'local' ? 'local (newer)' : 'hub'
      } version — the other is snapshotted in history → /design:rollback ${lastDiverged.slug}`;
    }
    dismissKey = `diverged:${lastDiverged.slug}:${lastDiverged.at}`;
  } else {
    variant = 'warn';
    text = `${rejected} canvas(es) not syncing — the hub rejected auth. Details: maude design status`;
    dismissKey = `rejected:${rejected}`;
  }
  if (dismissedKey === dismissKey) return null;

  return (
    <div role="status" aria-live="polite" className={`st-banner st-banner--${variant}`}>
      <span className="st-banner-dot" aria-hidden="true" />
      <span>{text}</span>
      <button
        type="button"
        className="st-banner-close"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => setDismissedKey(dismissKey)}
      >
        ×
      </button>
    </div>
  );
}

// ---------- CSS knobs (Phase 12.2, DDR-104) — interactive panel ----------
//
// Hybrid vocabulary (friendly collapsible section headers + CSS-named rows),
// per-field DS-token quick-pick, nested box-model widget, per-corner radius,
// per-row provenance (token-bound / raw-override / inherited), per-field save
// state, and two escape hatches: custom CSS property (via /_api/edit-css) +
// custom HTML attribute (via /_api/edit-attr). Each knob pre-fills from the
// AUTHORED inline value (`el.authored`); the resolved `computed` value is a
// faint placeholder only (NOT editable — the v1 UX bug). Ported from the
// critic-approved + user-iterated `.design/ui/Studio.tsx` spec.

const CSS_DISPLAYS = ['block', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline', 'none'];
// feature-3-web-artboards T5 — per-track unit ladder for the Grid section's
// UnitSelect (the stub's own list: px/%/fr/em/auto/min-content/max-content).
const GRID_TRACK_UNITS = ['px', '%', 'fr', 'em', 'auto', 'min-content', 'max-content'];
const CSS_FLEX_DIR = ['row', 'row-reverse', 'column', 'column-reverse'];
const CSS_FLEX_WRAP = ['nowrap', 'wrap', 'wrap-reverse'];
const CSS_ALIGN = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'];
// Stage M — flex-CHILD align-self (adds `auto` to the container align-items set).
const CSS_ALIGN_SELF = ['auto', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'];
const CSS_JUSTIFY = [
  'flex-start',
  'center',
  'flex-end',
  'space-between',
  'space-around',
  'space-evenly',
];
const CSS_WEIGHTS = ['300', '400', '500', '600', '700', '800'];
const CSS_FONTS = [
  'inherit',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  'Inter',
  'Inter Tight',
  'JetBrains Mono',
];
const CSS_BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted', 'double'];
const CSS_UNITS = ['px', 'rem', 'em', '%', 'vw', 'vh', 'auto'];
// Properties whose bare-number value is unitless — never append a unit suffix.
const CSS_UNITLESS = new Set(['line-height', 'opacity', 'font-weight', 'z-index', 'flex-grow', 'flex-shrink', 'order']);
// #2 — Figma-style property prefix inside numeric fields: a small glyph (icon) or
// a mono letter (t). Only where it reads cleanly; selects/colours keep their own.
const PROP_LEAD = {
  'font-size': { node: <Lu as={LuALargeSmall} size={12} /> },
  'line-height': { node: <Lu as={LuBaseline} size={12} /> },
  'letter-spacing': { node: <Lu as={LuMoveH} size={12} /> },
  gap: { node: <Lu as={LuSpaceBetween} size={12} /> },
  width: { t: 'W' },
  height: { t: 'H' },
  'max-width': { t: 'W' },
  'border-radius': { node: <Lu as={LuSpline} size={12} /> },
  'border-width': { node: <Lu as={LuMinus} size={12} /> },
};
const CSS_ALIGN_OPTS = ['left', 'center', 'right', 'justify'];
// feature-element-editing-robustness Stage B — enum option lists for the promoted
// DDR-104 OUT-list knobs (Position / Typography extras / Media framing).
const CSS_POSITION = ['static', 'relative', 'absolute', 'fixed', 'sticky'];
const CSS_FONT_STYLE = ['normal', 'italic', 'oblique'];
const CSS_TEXT_TRANSFORM = ['none', 'uppercase', 'lowercase', 'capitalize'];
const CSS_TEXT_DECORATION = ['none', 'underline', 'line-through', 'overline'];
const CSS_WHITE_SPACE = ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'];
const CSS_OBJECT_FIT = ['fill', 'contain', 'cover', 'none', 'scale-down'];
const CSS_OVERFLOW = ['visible', 'hidden', 'auto', 'scroll'];
// DDR-171 — Designer mode "Effects" cluster (blend) + the matching Advanced-mode
// Appearance row. Standard CSS `mix-blend-mode` keyword list.
const CSS_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];
// Common aspect ratios for the Media dropdown (dogfood request — a select, not a
// free-text field). Canonical spaced form so a dropdown-set value round-trips.
const CSS_ASPECT_RATIO = ['auto', '1 / 1', '4 / 3', '3 / 2', '16 / 9', '21 / 9', '3 / 4', '2 / 3', '9 / 16'];

// feature-element-editing-robustness Stage I4 — device presets for the "New
// artboard" menu (inserts an empty <DCArtboard> of these dims into the canvas).
const SCREEN_PRESETS = {
  desktop: { label: 'Desktop', width: 1440, height: 1024 },
  laptop: { label: 'Laptop', width: 1280, height: 800 },
  tablet: { label: 'Tablet', width: 834, height: 1194 },
  mobile: { label: 'Mobile', width: 390, height: 844 },
};

let _cssColorCtx = null;
// Normalize any CSS color string to #rrggbb for the native color input via a
// throwaway canvas fillStyle round-trip (parses rgb/hsl/named). Unparseable
// values (some oklch) fall back to '' → picker defaults to #000000; the swatch
// still shows the true color string regardless.
function cssColorToHex(c) {
  if (!c) return '';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  try {
    if (!_cssColorCtx) _cssColorCtx = document.createElement('canvas').getContext('2d');
    if (!_cssColorCtx) return '';
    _cssColorCtx.fillStyle = '#000000';
    _cssColorCtx.fillStyle = c;
    const v = _cssColorCtx.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
    }
  } catch {
    /* canvas unavailable */
  }
  return '';
}

// ---- Colour math for the HSV picker (#6 — Figma-style colour control) ----
const clamp01 = (n) => Math.min(1, Math.max(0, n));
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
function rgbToHsv({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// Round bare px to whole numbers for the placeholder hint; pass other values through.
function cssHint(v) {
  if (!v) return '';
  const m = /^(-?\d*\.?\d+)px$/.exec(v);
  return m ? `${Math.round(Number.parseFloat(m[1]))}px` : v;
}

// Split "16px" → { n:"16", unit:"px" }; "auto"→{n:"",unit:"auto"}; var()/raw → {n:raw,unit:""}.
function cssSplitUnit(v) {
  if (!v) return { n: '', unit: 'px' };
  const t = v.trim();
  const m = /^(-?\d*\.?\d+)\s*(px|rem|em|%|vw|vh)?$/.exec(t);
  if (m) return { n: m[1], unit: m[2] || 'px' };
  if (t === 'auto') return { n: '', unit: 'auto' };
  return { n: t, unit: '' };
}

// Phase 12.2/12.3 — the WS `selected` echo is the server's projection
// (SelectedElement) and LACKS the client-only DOM fields the CSS knobs pre-fill
// from (`authored` / `computed` inline style + `customStyles` / `attrs` — all
// captured in the iframe, never round-tripped through the server). When the echo
// is for the SAME element we already hold locally, preserve those fields instead
// of clobbering them to empty (else the server round-trip wipes the custom-CSS /
// custom-attr rows + computed readout right after selection).
// feature-photo-editor — `photoKind`/`photoAsset` (dom-selection.ts) are the SAME
// class of client-only DOM-derived field and belong in this list for the same
// reason: without it, every server-pushed `selected`/`snapshot` restore (a canvas
// switch, a reconnect, the persisted `_active.json` on boot — none of which carry
// these fields) silently drops the Inspector's Photo tab until the next fresh
// click re-derives it live — the "tab is there, then it's gone" flicker.
function mergeSelClientFields(incoming, prev) {
  if (!incoming || Array.isArray(incoming) || Array.isArray(prev) || !prev) return incoming;
  // Dogfood follow-up (print artboards) — a whole-ARTBOARD selection has NO
  // data-cd-id (the frame chrome carries only data-dc-screen), so the id
  // identity check below never matched it and every server echo returned
  // `incoming` bare — wiping `attrs` (which carries data-dc-kind/-print for
  // the ArtboardKnobs panel) seconds after each fresh click. The panel then
  // silently fell back to kind='digital' + screen presets even though the
  // artboard was print. Match an id-less pair by the artboard-shaped
  // SELECTOR + file — NOT by artboardId: the server projection
  // (inspect.ts `enrich()`) doesn't round-trip `artboardId` at all, so an
  // artboardId comparison always sees undefined on the echo side and never
  // matches (the second-round bug on this exact spot). The selector IS the
  // identity here — `[data-dc-screen="<id>"]` — and enrich() preserves it.
  if (!incoming.id && !prev.id) {
    const isArtboardSel = (s) =>
      typeof s.selector === 'string' && s.selector.startsWith('[data-dc-screen=');
    if (
      isArtboardSel(incoming) &&
      isArtboardSel(prev) &&
      incoming.selector === prev.selector &&
      incoming.file === prev.file
    ) {
      return {
        ...incoming,
        authored: incoming.authored ?? prev.authored,
        computed: incoming.computed ?? prev.computed,
        customStyles: incoming.customStyles ?? prev.customStyles,
        attrs: incoming.attrs ?? prev.attrs,
        // enrich() drops artboardId/worldW/worldH from the echo entirely —
        // restore them from the local snapshot so ArtboardKnobs keeps its
        // exact W/H and the resize/kind writers keep their target id.
        artboardId: incoming.artboardId ?? prev.artboardId,
        worldW: incoming.worldW ?? prev.worldW,
        worldH: incoming.worldH ?? prev.worldH,
      };
    }
    return incoming;
  }
  if (!incoming.id || incoming.id !== prev.id) return incoming;
  return {
    ...incoming,
    authored: incoming.authored ?? prev.authored,
    computed: incoming.computed ?? prev.computed,
    customStyles: incoming.customStyles ?? prev.customStyles,
    attrs: incoming.attrs ?? prev.attrs,
    photoKind: incoming.photoKind ?? prev.photoKind,
    photoAsset: incoming.photoAsset ?? prev.photoAsset,
  };
}

// Resolve the active canvas's DS tokens CSS path (mirrors canvas-url.js / DDR-093):
// the canvas's declared DS wins, else designSystems[0], else the legacy default.
function cssTokensRelFor(file, cfg) {
  const ds0 = cfg?.designSystems?.[0];
  const name = file ? cfg?.canvasDesignSystems?.[file] : null;
  const ds = (name && cfg?.designSystems?.find((d) => d.name === name)) || ds0;
  return ds?.tokensCssRel || cfg?.tokensCssRel || ds0?.tokensCssRel || '';
}

// The active canvas's DS NAME (mirrors cssTokensRelFor's resolution order).
function activeDsNameFor(file, cfg) {
  const byCanvas = file ? cfg?.canvasDesignSystems?.[file] : null;
  return byCanvas || cfg?.defaultDesignSystem || cfg?.designSystems?.[0]?.name || null;
}

// Parse a DS tokens CSS body → token names grouped by family + a name→value map
// (resolving one level of var() aliasing so the popover renders real swatches +
// values). Phase 12.3 (W2.1/W3 multi-DS).
function parseTokensCss(css) {
  const raw = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
    if (!(m[1] in raw)) raw[m[1]] = m[2].trim();
  }
  const vals = {};
  for (const name of Object.keys(raw)) {
    const v = raw[name];
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(v);
    vals[name] = ref && raw[ref[1]] ? raw[ref[1]] : v;
  }
  const names = Object.keys(raw);
  const g = (re) => names.filter((n) => re.test(n));
  // Colours detected by VALUE, not name — so EVERY colour token a DS defines is
  // offered (the name-prefix list dropped many). A token is a colour if its
  // resolved value reads as one. (#3 — "see all tokens the DS has".)
  const isColor = (v) =>
    /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|hwb\(|color\()/i.test(v) ||
    /^(transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|cyan|magenta|teal|navy|maroon|olive|lime|aqua|silver|gold)$/i.test(
      v
    );
  return {
    color: names.filter((n) => isColor(vals[n])),
    space: g(/^--space-/),
    radius: g(/^--radius-/),
    type: g(/^--type-/),
    shadow: g(/^--shadow-/),
    lh: g(/^--lh-/),
    vals,
  };
}

// Fetch + parse the tokens CSS of EVERY design system in the config (main
// origin), so the token popover can offer tokens grouped per DS (W3 multi-DS
// feedback). The active canvas's DS is ordered first. Returns
// `[{ name, color, space, radius, type, shadow, lh, vals }]`.
function useAllDsTokens(cfg, designRel, activeName) {
  const list = cfg?.designSystems || [];
  // A stable key so the effect only re-fetches when the DS set / paths change.
  const sig = list.map((d) => `${d.name}:${d.tokensCssRel}`).join('|');
  const [byDs, setByDs] = useState([]);
  useEffect(() => {
    if (!list.length) return undefined;
    let cancelled = false;
    Promise.all(
      list.map(async (ds) => {
        if (!ds.tokensCssRel) return null;
        try {
          const r = await fetch(`/${designRel}/${ds.tokensCssRel}`);
          const css = r.ok ? await r.text() : '';
          return { name: ds.name, ...parseTokensCss(css) };
        } catch {
          return null;
        }
      })
    ).then((res) => {
      if (cancelled) return;
      const got = res.filter(Boolean);
      // Active DS first, rest in config order.
      got.sort((a, b) => (a.name === activeName ? -1 : b.name === activeName ? 1 : 0));
      setByDs(got);
    });
    return () => {
      cancelled = true;
    };
  }, [sig, designRel, activeName]);
  return byDs;
}

// Phase 12.3 (#4) — the "Custom" tab of the colour popover: a normal colour
// input (native OS picker via a large swatch) + a hex/value text field. Applies
// LIVE as you adjust (onApply), so the canvas previews while the picker is open.
// #6 — the unified colour picker (Custom tab). A real HSV control: a
// saturation/value square + a hue slider + a hex field + an eyedropper — the
// Figma model. Replaces BOTH the old native <input type="color"> on the swatch
// AND the simple hex field, so colours have ONE popover (Custom · Variables).
// `seed` is the resolved current colour (hex). Drag updates the picker UI live;
// commits on pointer-up (one source write per drag); the hex field commits on
// blur/Enter.
function ColorPicker({ seed, label, onApply }) {
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(seed || '#000000')));
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const svRef = useRef(null);
  const hueRef = useRef(null);
  // Reseed when the selection's colour changes (but not while the user drags).
  const seedRef = useRef(seed);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed on seed change only.
  useEffect(() => {
    if (seed && seed !== seedRef.current) {
      seedRef.current = seed;
      setHsv(rgbToHsv(hexToRgb(seed)));
    }
  }, [seed]);
  const hex = rgbToHex(hsvToRgb(hsv));

  const dragSV = (e) => {
    e.preventDefault();
    const r = svRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = hsvRef.current.h;
    const move = (ev) => {
      setHsv({
        h,
        s: clamp01((ev.clientX - r.left) / r.width),
        v: clamp01(1 - (ev.clientY - r.top) / r.height),
      });
    };
    move(e);
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      onApply(rgbToHex(hsvToRgb(hsvRef.current)));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  const dragHue = (e) => {
    e.preventDefault();
    const r = hueRef.current?.getBoundingClientRect();
    if (!r) return;
    const { s, v } = hsvRef.current;
    const move = (ev) => {
      setHsv({ h: clamp01((ev.clientX - r.left) / r.width) * 360, s, v });
    };
    move(e);
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      onApply(rgbToHex(hsvToRgb(hsvRef.current)));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  // Keyboard equivalents for dragSV/dragHue (feature-photo-editor follow-up
  // debt, Task 18) — the pad + hue bar were pointer-only. Arrow keys nudge
  // the same `setHsv`/`onApply` path the drag handlers use; shift = a bigger
  // step (mirrors makeScrub's shift=×10 modifier convention elsewhere).
  const nudgeHsv = (patch) => {
    const next = { ...hsvRef.current, ...patch };
    setHsv(next);
    onApply(rgbToHex(hsvToRgb(next)));
  };
  const onSvKeyDown = (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = deltas[e.key];
    if (!d) return;
    e.preventDefault();
    nudgeHsv({ s: clamp01(hsvRef.current.s + d[0]), v: clamp01(hsvRef.current.v + d[1]) });
  };
  const onHueKeyDown = (e) => {
    const step = e.shiftKey ? 20 : 2;
    const deltas = { ArrowLeft: -step, ArrowRight: step };
    const d = deltas[e.key];
    if (d == null) return;
    e.preventDefault();
    nudgeHsv({ h: Math.min(360, Math.max(0, hsvRef.current.h + d)) });
  };
  const eyedrop = async () => {
    try {
      // EyeDropper is Chromium-only; guarded.
      const ED = window.EyeDropper;
      if (!ED) return;
      const res = await new ED().open();
      if (res?.sRGBHex) {
        setHsv(rgbToHsv(hexToRgb(res.sRGBHex)));
        onApply(res.sRGBHex);
      }
    } catch {
      /* user cancelled */
    }
  };

  // handoff — RGB numeric fields (design parity). Editing one re-derives hsv.
  const rgb = hsvToRgb(hsv);
  const setRgb = (patch) => {
    const next = { ...rgb, ...patch };
    const h = rgbToHsv({ r: clamp01(next.r / 255) * 255, g: clamp01(next.g / 255) * 255, b: clamp01(next.b / 255) * 255 });
    setHsv(h);
    onApply(rgbToHex(hsvToRgb(h)));
  };
  return (
    <div className="st-cp-cpick">
      {/* hex + swatch on top (design), then the SV pad, controls, RGB */}
      <div className="st-cp-cpick-hexrow">
        <span className="st-cp-cpick-hexsw" style={{ background: hex }} />
        <input
          className="st-cp-cpick-hex"
          type="text"
          value={hex}
          aria-label={label ? `${label} hex value` : 'hex value'}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#?[0-9a-f]{6}$/i.test(v)) setHsv(rgbToHsv(hexToRgb(v)));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onApply(e.currentTarget.value);
          }}
          onBlur={(e) => onApply(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
      <button
        type="button"
        ref={svRef}
        className="st-cp-cpick-sv"
        aria-label={label ? `${label} saturation and value` : 'saturation and value'}
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={dragSV}
        onKeyDown={onSvKeyDown}
      >
        <span className="st-cp-cpick-svwhite" />
        <span className="st-cp-cpick-svblack" />
        <span
          className="st-cp-cpick-knob"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
        />
      </button>
      <div className="st-cp-cpick-controls">
        {window.EyeDropper ? (
          <button
            type="button"
            className="st-cp-cpick-eye"
            aria-label="pick from screen"
            title="eyedropper"
            onClick={eyedrop}
          >
            <StIcon name="eyedropper" size={14} />
          </button>
        ) : null}
        <span className="st-cp-cpick-preview" style={{ background: hex }} aria-hidden="true" />
        <button
          type="button"
          ref={hueRef}
          className="st-cp-cpick-hue"
          aria-label={label ? `${label} hue` : 'hue'}
          onPointerDown={dragHue}
          onKeyDown={onHueKeyDown}
        >
          <span className="st-cp-cpick-huethumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </button>
      </div>
      <div className="st-cp-cpick-rgb">
        {['r', 'g', 'b'].map((k) => (
          <label key={k} className="st-cp-cpick-rgbf">
            <input
              aria-label={k.toUpperCase()}
              value={Math.round(rgb[k])}
              onChange={(e) => setRgb({ [k]: clamp01((Number.parseFloat(e.target.value) || 0) / 255) * 255 })}
              onFocus={(e) => e.currentTarget.select()}
            />
            <span>{k.toUpperCase()}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Phase 12.3 (W2.1) — token picker as a Figma-style popover instead of a native
// <select>. `kind='color'` renders a swatch grid (resolved DS color values);
// `kind='value'` a variable list (pretty name + resolved value, à la Figma's
// variable picker). Picking commits `var(--token)`. Portals to <body> +
// fixed-positions from the trigger rect so the panel's overflow never clips it.
function TokenPopover({ kind, groups, current, onPick, label, swatchBg, seedHex, activeDs, swatchClassName }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  // Phase 12.3 (#4) — colour popover gets two tabs: a normal colour input
  // (Custom) + the DS variables swatch list (Variables). Token-able non-colour
  // popovers stay single-mode.
  const [mode, setMode] = useState('custom');
  const [query, setQuery] = useState('');
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const bound = typeof current === 'string' && /var\(\s*--/.test(current);
  const isOn = (n) => current === `var(${n})`;
  const pretty = (n) => n.replace(/^--/, '').replace(/-/g, ' ');
  const gs = groups || [];
  const total = gs.reduce((s, g) => s + (g.names?.length || 0), 0);
  const showDsHeaders = gs.length > 1; // group by DS only when there's >1
  // Search filter over the token name + resolved value, per group.
  const q = query.trim().toLowerCase();
  const filteredGs = !q
    ? gs
    : gs
        .map((g) => ({
          ...g,
          names: (g.names || []).filter(
            (n) =>
              pretty(n).toLowerCase().includes(q) ||
              n.toLowerCase().includes(q) ||
              (g.vals?.[n] || '').toLowerCase().includes(q)
          ),
        }))
        .filter((g) => g.names.length);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = 224;
      const MAXH = 300;
      let left = Math.min(r.right - W, window.innerWidth - W - 8);
      if (left < 8) left = 8;
      const below = window.innerHeight - r.bottom;
      const top = below > MAXH + 8 ? r.bottom + 4 : Math.max(8, r.top - MAXH - 4);
      setPos({ left, top, width: W, maxHeight: MAXH });
    };
    place();
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Task 6 (feature-inspector-controls-redesign) — RE-ANCHOR on scroll/resize
    // instead of dismissing. `place()` computes viewport-relative coordinates
    // from `getBoundingClientRect()`, but this fixed-positioned popover's actual
    // containing block is whichever ANCESTOR (if any) has a transform/filter/
    // will-change — e.g. the right panel's mount-in `st-panel-in` transform —
    // not necessarily the viewport. Re-running place() keeps it glued to the
    // trigger through any layout change instead of vanishing on the first
    // scroll (the old dismiss-on-scroll workaround for the same root cause).
    const onScroll = (e) => {
      if (popRef.current?.contains(e.target)) return;
      place();
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Transform-ancestor compensation — regardless of WHICH ancestor ends up
  // establishing this fixed popover's containing block, measure where it
  // actually landed vs where `place()` intended (viewport-relative) and cancel
  // out the delta. This is correct independent of the cause, so it doesn't
  // require hunting down every transform/filter/will-change that could ever
  // apply between `document.body` (the portal target) and this element.
  // Converges in at most one correction: once the delta is compensated, the
  // measured rect matches the intended position and the effect is a no-op.
  useEffect(() => {
    if (!open || !pos || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    const dx = pos.left - r.left;
    const dy = pos.top - r.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setPos((p) => (p ? { ...p, left: p.left + dx, top: p.top + dy } : p));
    }
  }, [open, pos]);

  // Pick a token. #3 — apply CORRECTLY across design systems: a token from the
  // canvas's OWN active DS commits `var(--token)` (round-trips + resolves right);
  // a token from ANOTHER DS commits its RESOLVED value (literal), because
  // `var(--token)` would resolve against the canvas's DS scope and paint the WRONG
  // colour. So what you click is always what's applied ("natvrdo").
  // SECURITY (ethical-hacker A3) — a cross-DS token value is committed as a
  // LITERAL, and its source is a (possibly hub-pushed, untrusted) tokens CSS.
  // A colour-shaped value can still smuggle a fetch primitive (e.g.
  // `rgb(1 2 3) url(//x)` passes the colour sniff). Refuse to write a literal
  // carrying url()/image-set()/expression()/@import — fall back to var(), which
  // resolves against the CANVAS's own DS (never the attacker's value).
  const UNSAFE_TOKEN_VALUE = /url\(|image-set\(|cross-fade\(|element\(|expression\(|@import|javascript:/i;
  const pickFrom = (ds, n, resolved) => {
    if (activeDs && ds && ds !== activeDs && resolved && !UNSAFE_TOKEN_VALUE.test(resolved)) {
      onPick(resolved);
    } else {
      onPick(`var(${n})`);
    }
    setOpen(false);
  };
  // Custom colour / hex applies LIVE without closing, so the user can keep
  // tweaking; the popover dismisses on outside-click / Esc like everything else.
  const applyRaw = (v) => {
    const val = (v || '').trim();
    if (val) onPick(val);
  };
  // A search field over the token list (name + value). Auto-focuses so the user
  // can type straight away.
  const searchBar = (
    <div className="st-cp-pop-search">
      <StIcon name="search" size={12} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search variables"
        aria-label="search variables"
        // biome-ignore lint/a11y/noAutofocus: focusing the search on open is the intent.
        autoFocus
      />
    </div>
  );
  // #2 — colour Variables as a scannable LIST (swatch · name · value), per DS.
  const swatchList = (grps) =>
    grps.map((g) => (
      <div className="st-cp-pop-group" key={g.ds}>
        {showDsHeaders ? <div className="st-cp-pop-ds">{g.ds}</div> : null}
        <div className="st-cp-pop-list">
          {g.names.map((n) => (
            <button
              key={`${g.ds}:${n}`}
              type="button"
              className={`st-cp-pop-row st-cp-pop-crow${isOn(n) ? ' is-on' : ''}`}
              onClick={() => pickFrom(g.ds, n, g.vals?.[n])}
            >
              <span
                className="st-cp-pop-cswatch"
                style={{ background: g.vals?.[n] || 'transparent' }}
                aria-hidden="true"
              />
              <span className="st-cp-pop-name">{pretty(n)}</span>
              <span className="st-cp-pop-val">{g.vals?.[n] || ''}</span>
            </button>
          ))}
        </div>
      </div>
    ));
  // The value-token list (non-colour), per DS.
  const valueList = (grps) =>
    grps.map((g) => (
      <div className="st-cp-pop-group" key={g.ds}>
        {showDsHeaders ? <div className="st-cp-pop-ds">{g.ds}</div> : null}
        <div className="st-cp-pop-list">
          {g.names.map((n) => (
            <button
              key={`${g.ds}:${n}`}
              type="button"
              className={`st-cp-pop-row${isOn(n) ? ' is-on' : ''}`}
              onClick={() => pickFrom(g.ds, n, g.vals?.[n])}
            >
              <span className="st-cp-pop-name">{pretty(n)}</span>
              <span className="st-cp-pop-val">{g.vals?.[n] || ''}</span>
            </button>
          ))}
        </div>
      </div>
    ));
  const noMatch = <div className="st-cp-pop-empty">No match</div>;

  return (
    <>
      {swatchBg !== undefined ? (
        // Colour rows: the swatch IS the trigger — one popover, no separate native
        // OS picker + ◇ (the "two popovers" the user flagged). Shows the current
        // colour; bound-to-token gets the accent ring.
        <button
          type="button"
          ref={btnRef}
          className={`${swatchClassName || 'st-cp-swatch st-cp-swatch--mini st-cp-swatch--trigger'}${bound && !swatchClassName ? ' is-bound' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label || 'pick a colour'}
          title={current || 'pick a colour'}
          onClick={() => setOpen((v) => !v)}
        >
          <span style={{ position: 'absolute', inset: 0, background: swatchBg || 'transparent' }} />
        </button>
      ) : (
        <button
          type="button"
          ref={btnRef}
          className={`st-cp-tokbtn${bound ? ' is-bound' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label || 'pick a design token'}
          title="design tokens"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="st-cp-tokbtn-glyph" aria-hidden="true" />
        </button>
      )}
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              // Portalled to <body> (outside the App's `.maude` div), so it must
              // re-establish the maude token scope itself — otherwise var(--bg-*)
              // resolves to the legacy :root project palette (the cream popover bug).
              className="maude st-cp-pop"
              data-theme={
                (typeof document !== 'undefined' &&
                  document.documentElement.getAttribute('data-theme')) ||
                'dark'
              }
              role="dialog"
              aria-label={label || 'design tokens'}
              style={{
                left: pos.left,
                top: pos.top,
                width: pos.width,
                maxHeight: pos.maxHeight,
              }}
            >
              {kind === 'color' ? (
                <>
                  <div className="st-cp-poptabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'custom'}
                      className={`st-cp-poptab${mode === 'custom' ? ' is-active' : ''}`}
                      onClick={() => setMode('custom')}
                    >
                      Custom
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'vars'}
                      className={`st-cp-poptab${mode === 'vars' ? ' is-active' : ''}`}
                      onClick={() => setMode('vars')}
                    >
                      Variables
                    </button>
                  </div>
                  {mode === 'custom' ? (
                    <ColorPicker seed={seedHex || cssColorToHex(current) || '#000000'} onApply={applyRaw} />
                  ) : !total ? (
                    <div className="st-cp-pop-empty">No color tokens</div>
                  ) : (
                    <>
                      {searchBar}
                      {filteredGs.length ? swatchList(filteredGs) : noMatch}
                    </>
                  )}
                </>
              ) : !total ? (
                <div className="st-cp-pop-empty">No tokens for this property</div>
              ) : (
                <>
                  {searchBar}
                  {filteredGs.length ? valueList(filteredGs) : noMatch}
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

// feature-3-web-artboards T5 (absorbed feature-grid-track-editor stub) — the
// CssKnobs "Grid" section's track-list editor: one row per track (a
// NumberField + UnitSelect for a numeric px/%/fr/em track, a bare Select for
// a keyword auto/min-content/max-content track since it carries no numeric
// value), + add/remove. `tracks`/`onChange` are the parsed/serialized shape
// from `grid-track-handles.ts` — the SAME module the on-canvas gutter-drag
// overlay uses, so the Inspector and the drag handles never disagree.
function GridTracksEditor({ label, tracks, editable, onChange }) {
  const setUnit = (idx, unit) => {
    const cur = tracks[idx];
    onChange(
      tracks.map((t, i) =>
        i === idx
          ? GRID_KEYWORD_UNITS.has(unit)
            ? { value: 0, unit }
            : { value: cur.value || 1, unit }
          : t
      )
    );
  };
  const setValue = (idx, value) => {
    onChange(tracks.map((t, i) => (i === idx ? { ...t, value } : t)));
  };
  const addTrack = () => onChange([...tracks, { value: 1, unit: 'fr' }]);
  const removeTrack = (idx) => onChange(tracks.filter((_, i) => i !== idx));
  return (
    <div className="st-cp-gridtracks">
      <div className="st-cp-gridtracks-hd">
        <span className="st-cp-gridtracks-label">{label}</span>
        <button
          type="button"
          className="st-btn st-cp-gridtracks-add"
          disabled={!editable}
          onClick={addTrack}
        >
          + Track
        </button>
      </div>
      {tracks.length === 0 ? (
        <div className="st-cp-note">
          No explicit tracks — add one to start defining {label.toLowerCase()}.
        </div>
      ) : (
        tracks.map((t, idx) => {
          const isKeyword = GRID_KEYWORD_UNITS.has(t.unit);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: tracks have no stable id;
            // add/remove/reorder all rebuild the array positionally, same as every
            // other index-keyed list in this file (e.g. the Layers tree rows).
            <div className="st-cp-gridtrack-row" key={idx}>
              {isKeyword ? (
                <Select
                  value={t.unit}
                  ariaLabel={`${label} track ${idx + 1}`}
                  options={GRID_TRACK_UNITS.map((u) => ({ value: u, label: u }))}
                  onChange={(u) => setUnit(idx, u)}
                />
              ) : (
                <NumberField
                  value={t.value}
                  min={t.unit === 'fr' ? 0.1 : 0}
                  step={t.unit === 'fr' ? 0.1 : 1}
                  ariaLabel={`${label} track ${idx + 1} value`}
                  lead={String(idx + 1)}
                  unitSlot={
                    <UnitSelect
                      value={t.unit}
                      units={GRID_TRACK_UNITS}
                      ariaLabel={`${label} track ${idx + 1} unit`}
                      onChange={(u) => setUnit(idx, u)}
                    />
                  }
                  onCommit={(n) => setValue(idx, n)}
                />
              )}
              <button
                type="button"
                className="st-btn st-cp-gridtrack-remove"
                aria-label={`remove ${label} track ${idx + 1}`}
                disabled={!editable || tracks.length <= 1}
                onClick={() => removeTrack(idx)}
              >
                ×
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function CssKnobs({ el, cfg, onOptimistic, onRecordEdit, onReplaceMedia, onUndoRedo, mode, onSetMode }) {
  const editable = !!el.id;
  const computed = el.computed || {};
  // Phase 12.3 — optimistic local overlay over the selection's authored / custom
  // / attr maps. With the redundant-reload suppression (the flicker fix), an edit
  // no longer triggers a reselect that would re-post fresh `authored` values — so
  // the panel must reflect its own commits immediately or it shows the stale
  // pre-edit value until the user re-selects. Each commit/reset writes here;
  // `null` marks a removed key. Cleared when a different element is selected.
  const [overlay, setOverlay] = useState({ a: {}, c: {}, t: {} });
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear only on element change.
  useEffect(() => {
    setOverlay({ a: {}, c: {}, t: {} });
  }, [el.id]);
  const mergeOverlay = (base, ov) => {
    const out = { ...(base || {}) };
    for (const [k, v] of Object.entries(ov)) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
    return out;
  };
  const authored = mergeOverlay(el.authored, overlay.a);
  const customStyles = mergeOverlay(el.customStyles, overlay.c);
  const attrs = mergeOverlay(el.attrs, overlay.t);
  const setA = (prop, v) => setOverlay((o) => ({ ...o, a: { ...o.a, [prop]: v } }));
  const setC = (prop, v) => setOverlay((o) => ({ ...o, c: { ...o.c, [prop]: v } }));
  const setT = (attr, v) => setOverlay((o) => ({ ...o, t: { ...o.t, [attr]: v } }));
  // Token CSS is served from the MAIN origin at the repo-relative path, i.e.
  // WITH the designRoot prefix (`/.design/system/<ds>/colors_and_type.css`) —
  // `tokensCssRel` from config is DS-root-relative (no `.design/`), so prepend it.
  const _designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  const _activeDs = activeDsNameFor(el.file, cfg);
  // W3 — tokens from EVERY configured DS, active one first, so the popover can
  // offer them grouped per design system.
  const allDs = useAllDsTokens(cfg, _designRel, _activeDs);
  // Build per-DS popover groups for one token family (color/space/radius/…).
  const tokenGroups = (familyKey) =>
    allDs
      .map((d) => ({ ds: d.name, names: d[familyKey] || [], vals: d.vals }))
      .filter((g) => g.names.length);
  const [status, setStatus] = useState({});
  const [open, setOpen] = useState({
    Layout: true,
    Position: true,
    Typography: true,
    Spacing: true,
    Size: true,
    Media: true,
    Appearance: true,
    Advanced: false,
  });

  // Phase 12.3 — auto-expand Advanced when the selected element carries custom
  // CSS props / HTML attrs, so a just-added (or pre-existing) custom value is
  // visible without hunting for the disclosure. Keyed on el.id so it re-runs per
  // selection (CssKnobs persists across selections — the el prop changes).
  const hasCustom =
    Object.keys(customStyles).length > 0 || Object.keys(attrs).length > 0;
  useEffect(() => {
    if (hasCustom) setOpen((o) => (o.Advanced ? o : { ...o, Advanced: true }));
  }, [el.id, hasCustom]);
  // DDR-171 — Designer mode's Position cluster mirrors the same auto-expand
  // precedent: collapsed by default (position is the rare case), auto-opens
  // the moment the element actually has a non-static position so the inset
  // fields the user just set (or that came from the source) aren't hidden.
  const hasCustomPosition = (authored.position || cssHint(computed.position) || 'static') !== 'static';
  useEffect(() => {
    if (hasCustomPosition) setOpen((o) => (o['d:Position'] ? o : { ...o, 'd:Position': true }));
  }, [el.id, hasCustomPosition]);

  // DDR-171 — the panel's vocabulary mode: 'advanced' (today's raw-CSS panel,
  // unchanged, still the default — zero behavior change for existing users) or
  // 'designer' (the Figma-vocabulary regroup). Lifted to App state (DDR-171
  // follow-up) so the same preference is controllable from BOTH the in-panel
  // corner toggle AND Settings → Appearance, and the two never diverge — the
  // exact single-source-of-truth pattern `theme` uses. App owns the
  // `maude-cp-mode` localStorage persistence; here it's a controlled prop.
  const setMode = onSetMode;
  // Designer-mode per-cluster "···" disclosure state (Auto layout/Wrap,
  // Size/Min-Max, Position/z-index, Text/extras) — keyed by cluster name, kept
  // in-memory only (unlike `open`, not persisted; matches the disclosure being
  // a "peek", not a durable preference).
  const [designerMore, setDesignerMore] = useState({});

  async function post(url, payload, key) {
    setStatus((s) => ({ ...s, [key]: 'saving' }));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      setStatus((s) => ({
        ...s,
        [key]: !res.ok || !j.ok ? `err:${(j && j.error) || `HTTP ${res.status}`}` : 'saved',
      }));
    } catch (err) {
      setStatus((s) => ({ ...s, [key]: `err:${err && err.message ? err.message : String(err)}` }));
    }
  }
  // Optimistic preview: nudge the live element so the change shows before the
  // edit → HMR reload lands. `value` null = remove (reset path). No-op when the
  // selection has no stable id (can't be resolved in the canvas).
  const optimistic = (prop, value) => {
    if (!onOptimistic || !el.id) return;
    onOptimistic({
      id: el.id,
      artboardId: el.artboardId ?? null,
      index: el.index ?? 0,
      prop,
      value,
    });
  };
  // Record an inline edit onto the canvas undo stack (Cmd+Z). The edit has
  // already POSTed `/_api/edit-*`; the canvas iframe APPENDS the record (no
  // re-run). `before`/`after` null = the prop/attr was/becomes unset.
  const record = (op, key, before, after) => {
    onRecordEdit?.({
      op,
      canvas: el.file,
      id: el.id,
      key,
      before: before == null || before === '' ? null : before,
      after: after == null || after === '' ? null : after,
    });
  };
  const commit = (property, raw) => {
    const value = (raw || '').trim();
    if (!editable || !value) return;
    const before = authored[property] ?? null;
    if (value === (before ?? '').trim()) return; // no-op
    optimistic(property, value);
    setA(property, value); // reflect in the panel immediately (no reload → no reselect)
    post('/_api/edit-css', { canvas: el.file, id: el.id, property, value }, property);
    record('css', property, before, value);
  };
  // A custom CSS property (Advanced) — same write, but the panel surfaces it from
  // the customStyles map, so overlay THERE.
  const commitCustom = (property, raw) => {
    const value = (raw || '').trim();
    const prop = property.trim();
    if (!editable || !prop || !value) return;
    const before = customStyles[prop] ?? null;
    optimistic(prop, value);
    setC(prop, value);
    post('/_api/edit-css', { canvas: el.file, id: el.id, property: prop, value }, prop);
    record('css', prop, before, value);
  };
  const commitAttr = (attr, raw) => {
    const a = (attr || '').trim();
    const value = (raw || '').trim();
    if (!editable || !a || !value) return;
    const before = attrs[a] ?? null;
    setT(a, value);
    post('/_api/edit-attr', { canvas: el.file, id: el.id, attr: a, value }, `@${a}`);
    record('attr', a, before, value);
  };
  // Phase 12.3 — reset (remove the inline prop / attr → back to class/inherited).
  const reset = (property) => {
    if (!editable) return;
    const before = authored[property] ?? null;
    optimistic(property, null);
    setA(property, null);
    post('/_api/edit-css', { canvas: el.file, id: el.id, property, reset: true }, property);
    record('css', property, before, null);
  };
  const resetCustom = (property) => {
    if (!editable) return;
    const before = customStyles[property] ?? null;
    optimistic(property, null);
    setC(property, null);
    post('/_api/edit-css', { canvas: el.file, id: el.id, property, reset: true }, property);
    record('css', property, before, null);
  };
  const resetAttr = (attr) => {
    if (!editable) return;
    const before = attrs[attr] ?? null;
    setT(attr, null);
    post('/_api/edit-attr', { canvas: el.file, id: el.id, attr, reset: true }, `@${attr}`);
    record('attr', attr, before, null);
  };
  // Stage M1 — apply a Fixed / Hug / Fill sizing mode to one axis. The pure
  // `sizingModePatch` returns the exact writes (context-aware Fill: flex main axis
  // → flex-grow, cross axis → align-self, block/grid → 100%) + the fill-props to
  // clear. Each ride the same commit/reset lanes (per-prop edit-css + undo record);
  // the server's per-file lock serializes them, so the resulting box is coherent.
  const parentLayout = { display: el.parentDisplay, flexDirection: el.parentFlexDirection };
  const applySizing = (axis, mode) => {
    if (!editable) return;
    const px = Math.round((axis === 'width' ? el.bounds?.w : el.bounds?.h) || 0);
    const patch = sizingModePatch(axis, mode, parentLayout, px);
    for (const p of patch.reset) if (authored[p]) reset(p);
    for (const [prop, value] of patch.set) commit(prop, value);
  };
  const parentIsFlexChild =
    el.parentDisplay === 'flex' || el.parentDisplay === 'inline-flex';
  const sizeModeSeg = (axis) => {
    const cur = sizingModeOf(axis, authored, computed, parentLayout);
    return (
      // handoff — a proper inspector row: "Width sizing" / "Height sizing" label
      // in the label column, the shared Segmented right-aligned in the control
      // column (aligned with the number inputs below), input-matching height.
      <div className="st-cp-moderow" key={`mode-${axis}`}>
        <span className="st-cp-modelabel">{axis === 'width' ? 'Width sizing' : 'Height sizing'}</span>
        <div className="st-cp-modeseg" role="group" aria-label={`${axis} sizing mode`}>
          <Segmented
            value={cur}
            ariaLabel={`${axis} sizing`}
            options={[{ value: 'fixed', label: 'fixed' }, { value: 'hug', label: 'hug' }, { value: 'fill', label: 'fill' }]}
            onChange={(m) => applySizing(axis, m)}
          />
        </div>
      </div>
    );
  };
  // DDR-171 — Designer mode's Auto-layout alignment: `AlignPad`'s 9-cell grid
  // maps to the TWO real CSS axes (`justify-content` = main axis,
  // `align-items` = cross axis), which axis is "horizontal" vs "vertical"
  // depending on `flex-direction`. Only the 3 positional align-items values
  // (start/center/end) round-trip through the pad — `stretch` reads as the
  // pad's center cell (closest visual analog) but the pad never WRITES
  // `stretch`; that stays an Advanced-mode-only value, same as Figma's own
  // alignment pad (no "stretch" cell — it's a separate control there too).
  const AP_JC = ['flex-start', 'center', 'flex-end'];
  const AP_AI = ['flex-start', 'center', 'flex-end'];
  const AP_ROWS = ['t', 'c', 'b'];
  const AP_COLS = ['l', 'c', 'r'];
  const alignPadCell = () => {
    const isRow = !(authored['flex-direction'] || cssHint(computed['flex-direction']) || 'row').startsWith('column');
    const jcPos = Math.max(0, AP_JC.indexOf(authored['justify-content'] || cssHint(computed['justify-content']) || 'flex-start'));
    const aiRaw = authored['align-items'] || cssHint(computed['align-items']) || 'stretch';
    const aiPos = aiRaw === 'stretch' ? 1 : Math.max(0, AP_AI.indexOf(aiRaw));
    const [h, v] = isRow ? [jcPos, aiPos] : [aiPos, jcPos];
    return AP_ROWS[v] + AP_COLS[h];
  };
  const setAlignPadCell = (cell) => {
    const v = AP_ROWS.indexOf(cell[0]);
    const h = AP_COLS.indexOf(cell[1]);
    const isRow = !(authored['flex-direction'] || cssHint(computed['flex-direction']) || 'row').startsWith('column');
    const [jcPos, aiPos] = isRow ? [h, v] : [v, h];
    commit('justify-content', AP_JC[jcPos]);
    commit('align-items', AP_AI[aiPos]);
  };
  // Cmd+Z / Cmd+Shift+Z (or Cmd+Y) inside the inspector forwards to the canvas
  // undo stack — Figma-parity: a property field reverts the last DOCUMENT edit,
  // not field text. Without this, an edit committed with focus still in the
  // inspector couldn't be undone (the iframe's own keydown never sees the key).
  const onKnobKeyDown = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      onUndoRedo?.(e.shiftKey ? 'redo' : 'undo');
    } else if (k === 'y') {
      e.preventDefault();
      onUndoRedo?.('redo');
    }
  };
  const provOf = (prop) => {
    const v = authored[prop];
    if (!v) return 'inherit';
    return /var\(\s*--/.test(v) ? 'bound' : 'raw';
  };

  if (!editable) {
    return (
      <div className="st-cp">
        <div className="st-cp-id">
          <span className="st-cp-idtag">{el.tag || 'element'}</span>
        </div>
        <div className="st-css-disabled">
          This selection has no stable element id (a legacy canvas, or a non-element target). Edit
          it with <code>/design:edit</code>.
        </div>
      </div>
    );
  }

  const PROVLABEL = { bound: 'token-bound', raw: 'raw override', inherit: 'inherited' };
  const prov = (p) => (
    <span className={`st-cp-prov st-cp-prov--${p}`} role="img" aria-label={PROVLABEL[p]} />
  );

  // Phase 12.3 (#4) — the LEADING dot carries it all: provenance (shape) + save
  // status (a success/error/saving glow) + reset (double-click an authored row).
  // No trailing ✓/⟲ that shift the input rightward (the user's gripe). A tooltip
  // hints the double-click-to-reset.
  const provDot = (prop, provKind) => {
    const k = provKind ?? provOf(prop);
    const s = status[prop];
    const errMsg = typeof s === 'string' && s.startsWith('err:') ? s.slice(4) : '';
    const stCls = errMsg ? ' is-err' : s === 'saved' ? ' is-saved' : s === 'saving' ? ' is-saving' : '';
    const canReset = !!authored[prop];
    const tip = errMsg
      ? `error: ${errMsg}`
      : canReset
        ? `${PROVLABEL[k]} · double-click to reset`
        : PROVLABEL[k];
    return (
      <button
        type="button"
        className={`st-cp-prov st-cp-prov--${k}${stCls}${canReset ? ' is-resettable' : ''}`}
        aria-label={tip}
        title={tip}
        tabIndex={canReset ? 0 : -1}
        onDoubleClick={canReset ? () => reset(prop) : undefined}
        onKeyDown={
          canReset
            ? (e) => {
                if (e.key === 'Backspace' || e.key === 'Delete') {
                  e.preventDefault();
                  reset(prop);
                }
              }
            : undefined
        }
      />
    );
  };

  // `labelOverride` (DDR-171 — Designer mode) swaps BOTH the visible label text
  // AND the title tooltip together, so they never drift out of sync. Optional
  // and additive — every Advanced-mode call site omits it and renders exactly
  // as before (label = title = the raw CSS property name).
  const row = (prop, control, provKind, labelOverride) => {
    // #1 bigger-bet — scannable diff: a fully-unset single-prop row is dimmed so
    // the handful of overridden rows pop (Webflow/Framer model). Composite rows
    // (border — they pass an explicit provKind) are never dimmed.
    const unset = provKind === undefined && !authored[prop];
    const label = labelOverride ?? prop;
    return (
      <div className={`st-cp-row${unset ? ' is-unset' : ''}`} key={prop}>
        {provDot(prop, provKind)}
        <label className="st-cp-label" title={label}>
          {label}
        </label>
        <div className="st-cp-ctl">{control}</div>
      </div>
    );
  };

  // Props each section owns — drives the per-section "reset section" affordance.
  const SECTION_PROPS = {
    Layout: ['display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap'],
    // feature-3-web-artboards T5 — Grid track editor + cell placement, so the
    // section-reset affordance clears them like every other section.
    Grid: ['grid-template-columns', 'grid-template-rows'],
    'Grid item': ['grid-column', 'grid-row'],
    // feature-element-editing-robustness Stage B — promoted DDR-104 OUT-list.
    Position: ['position', 'top', 'right', 'bottom', 'left', 'z-index'],
    Typography: [
      'font-family',
      'color',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
      'font-style',
      'text-transform',
      'text-decoration',
      'white-space',
    ],
    Spacing: [
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ],
    Size: [
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'overflow',
      // Stage M — flex-child sizing props (written by the Fill mode + shown as rows
      // when the parent is flex). Included so a section-reset clears them too.
      'flex-grow',
      'flex-shrink',
      'flex-basis',
      'align-self',
    ],
    Media: ['object-fit', 'aspect-ratio', 'object-position'],
    Appearance: [
      'background-color',
      'border-radius',
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-left-radius',
      'border-bottom-right-radius',
      'border-width',
      'border-style',
      'border-color',
      'box-shadow',
      'filter',
      'mix-blend-mode',
      'opacity',
      'transform',
      'transform-origin',
    ],
  };
  const resetSection = (name) => {
    (SECTION_PROPS[name] || []).forEach((p) => {
      if (authored[p]) reset(p);
    });
  };

  const sec = (name, body) => {
    const dirty = (SECTION_PROPS[name] || []).some((p) => authored[p]);
    return (
      <section className="st-cp-sec" key={name}>
        <div className="st-cp-sechd-row">
          <button
            type="button"
            className="st-cp-sechd"
            aria-expanded={!!open[name]}
            onClick={() => setOpen((o) => ({ ...o, [name]: !o[name] }))}
          >
            <span className="st-cp-caret" aria-hidden="true">
              {open[name] ? '▾' : '▸'}
            </span>
            {name}
          </button>
          {/* handoff — reset always present (design), dimmed when nothing to reset. */}
          <button
            type="button"
            className={`st-cp-secreset${dirty ? '' : ' is-quiet'}`}
            aria-label={`reset ${name} section to original`}
            title={`reset ${name}`}
            disabled={!dirty}
            onClick={() => resetSection(name)}
          >
            <Lu as={LuRotateCw} size={12} />
          </button>
        </div>
        {/* animated collapse — grid-rows 0fr→1fr keeps the DOM + interpolates
            height (feature-inspector-controls-redesign handoff). */}
        <div className={`st-cp-sec-anim${open[name] ? ' is-open' : ''}`}>
          <div className="st-cp-sec-inner">{body}</div>
        </div>
      </section>
    );
  };

  // DDR-171 — Designer mode's cluster wrapper. Mirrors `sec()`'s exact chrome
  // (caret, reset, animated collapse — reuses `.st-cp-sec`/`.st-cp-sechd`/
  // `.st-cp-sec-anim` verbatim, no new CSS shape) but takes an explicit
  // `props` reset-list instead of looking one up in `SECTION_PROPS`, because
  // Designer clusters cut across Advanced-mode section boundaries and don't
  // map 1:1 onto it (e.g. "Auto layout" pulls from both Layout and Size).
  // Open-state lives in the SAME `open` object under a `d:`-prefixed key so no
  // second piece of state is needed; `defaultOpen=false` is how the Position
  // cluster starts collapsed (see `hasCustomPosition` auto-expand above).
  const dsec = (name, props, body, defaultOpen = true) => {
    const key = `d:${name}`;
    const isOpen = open[key] === undefined ? defaultOpen : open[key];
    const dirty = props.some((p) => authored[p]);
    return (
      <section className="st-cp-sec" key={key}>
        <div className="st-cp-sechd-row">
          <button
            type="button"
            className="st-cp-sechd"
            aria-expanded={isOpen}
            onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
          >
            <span className="st-cp-caret" aria-hidden="true">
              {isOpen ? '▾' : '▸'}
            </span>
            {name}
          </button>
          <button
            type="button"
            className={`st-cp-secreset${dirty ? '' : ' is-quiet'}`}
            aria-label={`reset ${name} to original`}
            title={`reset ${name}`}
            disabled={!dirty}
            onClick={() => props.forEach((p) => { if (authored[p]) reset(p); })}
          >
            <Lu as={LuRotateCw} size={12} />
          </button>
        </div>
        <div className={`st-cp-sec-anim${isOpen ? ' is-open' : ''}`}>
          <div className="st-cp-sec-inner">{body}</div>
        </div>
      </section>
    );
  };
  // A cluster's "···" disclosure toggle for its less-common rows (Figma's own
  // per-panel overflow affordance) — distinct from the cluster's own
  // open/collapse caret above. `designerMore[key]` gates the extra rows.
  const moreBtn = (key) => (
    <button
      type="button"
      className="st-cp-clustermore"
      aria-expanded={!!designerMore[key]}
      aria-label={designerMore[key] ? `${key} — fewer options` : `${key} — more options`}
      title={designerMore[key] ? 'fewer' : 'more'}
      onClick={() => setDesignerMore((m) => ({ ...m, [key]: !m[key] }))}
    >
      {designerMore[key] ? '▴' : '···'}
    </button>
  );

  // native <select> committing a CSS value directly
  const csel = (prop, list) => (
    <select
      className="st-cp-nsel"
      aria-label={prop}
      value={list.includes(authored[prop]) ? authored[prop] : ''}
      onChange={(e) => commit(prop, e.target.value)}
    >
      <option value="" disabled>
        {cssHint(computed[prop]) || '—'}
      </option>
      {list.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );

  // ── feature-inspector-controls-redesign handoff — the design's control set,
  // wired to CssKnobs' CSS-string commit lane. ────────────────────────────────
  const flatTokens = (familyKey) => tokenGroups(familyKey).flatMap((g) => (g.names || []).map((n) => ({ name: n, value: g.vals?.[n] || '' })));
  // enum → lucide icon button group (commits the raw CSS keyword)
  const iconseg = (prop, options) => (
    <IconButtonGroup value={authored[prop] || cssHint(computed[prop]) || options[0].value} ariaLabel={prop} options={options} onChange={(v) => commit(prop, v)} />
  );
  // number + unit + ◇ design-token binding (space / radius / type families)
  const vtok = (prop, familyKey, opts = {}) => {
    const cur = cssSplitUnit(authored[prop] ?? '');
    const unitless = CSS_UNITLESS.has(prop);
    const av = authored[prop] ?? '';
    const bound = typeof av === 'string' && /var\(\s*--/.test(av);
    const unit = unitless ? '' : cur.unit && cur.unit !== 'auto' ? cur.unit : 'px';
    const hintN = Number.parseFloat(cssSplitUnit(cssHint(computed[prop]) ?? '').n) || 0;
    const numVal = cur.n !== '' && cur.n != null ? Number.parseFloat(cur.n) || 0 : hintN;
    const lead = PROP_LEAD[prop];
    return (
      <ValueTokenField
        value={bound ? av : numVal}
        tokens={flatTokens(familyKey)}
        ariaLabel={prop}
        min={opts.min ?? 0}
        lead={lead ? (lead.node ?? lead.t) : undefined}
        unitSlot={unitless ? null : <UnitSelect units={CSS_UNITS} value={cur.unit || 'px'} ariaLabel={`${prop} unit`} onChange={(u) => commit(prop, u === 'auto' ? 'auto' : `${cur.n || '0'}${u}`)} />}
        onChange={(v) => commit(prop, typeof v === 'string' ? v : unitless ? `${v}` : `${v}${unit}`)}
      />
    );
  };
  // border-radius → uniform field + ▢ detach → 2×2 corner quad
  const radiusControl = () => {
    const parse = (p) => Number.parseFloat(cssSplitUnit(authored[p] ?? authored['border-radius'] ?? cssHint(computed[p]) ?? cssHint(computed['border-radius']) ?? '0').n) || 0;
    const corners = { tl: parse('border-top-left-radius'), tr: parse('border-top-right-radius'), bl: parse('border-bottom-left-radius'), br: parse('border-bottom-right-radius') };
    const onCorners = (c) => {
      const uniform = c.tl === c.tr && c.tr === c.bl && c.bl === c.br;
      if (uniform) {
        ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'].forEach((p) => { if (authored[p]) reset(p); });
        commit('border-radius', `${c.tl}px`);
      } else {
        commit('border-top-left-radius', `${c.tl}px`);
        commit('border-top-right-radius', `${c.tr}px`);
        commit('border-bottom-left-radius', `${c.bl}px`);
        commit('border-bottom-right-radius', `${c.br}px`);
      }
    };
    const lead = PROP_LEAD['border-radius'];
    return <RadiusControl corners={corners} lead={lead ? (lead.node ?? lead.t) : undefined} onCorners={onCorners} />;
  };
  // border composite (width + style + colour) — DDR-171 pulled this out of the
  // Advanced-mode Appearance row inline JSX so Designer mode's "Stroke"
  // cluster (Task 6) can reuse the exact same control, not a re-implementation.
  const borderControl = () => (
    <div className="st-cp-border">
      {num('border-width', null, { fixedUnit: 'px' })}
      <select
        className="st-cp-nsel st-cp-nsel--mini"
        aria-label="border-style"
        value={CSS_BORDER_STYLES.includes(authored['border-style']) ? authored['border-style'] : ''}
        onChange={(e) => commit('border-style', e.target.value)}
      >
        <option value="" disabled>
          style
        </option>
        {CSS_BORDER_STYLES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <TokenPopover
        kind="color"
        groups={tokenGroups('color')}
        current={authored['border-color']}
        activeDs={_activeDs}
        swatchBg={computed['border-color'] || authored['border-color'] || ''}
        seedHex={cssColorToHex(computed['border-color'] || authored['border-color']) || '#000000'}
        onPick={(v) => commit('border-color', v)}
        label="border colour"
      />
    </div>
  );
  // rotation dial, reading/writing the rotate() term of `transform`
  const rotationControl = () => {
    const t = authored.transform || cssHint(computed.transform) || '';
    const m = /rotate\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/.exec(t);
    const deg = (((m ? Number.parseFloat(m[1]) : 0) % 360) + 360) % 360;
    const setDeg = (d) => {
      const norm = ((d % 360) + 360) % 360;
      const base = (authored.transform || '').replace(/\s*rotate\([^)]*\)\s*/g, ' ').trim();
      commit('transform', `${base ? `${base} ` : ''}rotate(${norm}deg)`.trim());
    };
    return (
      <div className="st-cp-num" style={{ border: 0, background: 'transparent', gap: 'var(--space-2)' }}>
        <AngleDial value={deg} onChange={setDeg} />
        <NumberField value={deg} min={0} max={360} ariaLabel="rotation" lead={<Lu as={LuRotateCw} />} steppers={false} unitSlot={<span className="st-cp-numsuffix" aria-hidden="true">°</span>} onCommit={setDeg} />
      </div>
    );
  };
  // DDR-171 — `filter: blur(Npx)`, scoped to blur-only for v1 (not a full
  // filter-function editor). Local parse/serialize (unlike most rows this
  // doesn't pass the raw string straight to `commit`) — kept as a closure here,
  // not a top-level utility, so it stays governed by the "no new primitives"
  // constraint. A non-blur `filter` value (set via Advanced's raw-CSS hatch)
  // reads as 0 here rather than being clobbered — only written back once the
  // user actually commits a blur amount.
  const blurControl = () => {
    const f = authored.filter || cssHint(computed.filter) || '';
    const m = /blur\(\s*(-?\d+(?:\.\d+)?)px\s*\)/.exec(f);
    const px = m ? Number.parseFloat(m[1]) : 0;
    const setBlur = (n) => {
      const base = (authored.filter || '').replace(/\s*blur\([^)]*\)\s*/g, ' ').trim();
      commit('filter', n > 0 ? `${base ? `${base} ` : ''}blur(${n}px)`.trim() : base || 'none');
    };
    return <NumberField value={px} min={0} ariaLabel="filter blur" unitSlot={<span className="st-cp-numsuffix" aria-hidden="true">px</span>} onCommit={setBlur} />;
  };
  // handoff — shown as 0–100 % (design), stored as the CSS 0–1 value. Pulled
  // out (DDR-171) so Designer mode's "Opacity" cluster reuses it verbatim.
  const opacityControl = () => {
    const a = authored.opacity;
    const raw = a != null && a !== '' ? Number.parseFloat(a) : Number.parseFloat(cssHint(computed.opacity)) || 1;
    const pct = Math.round((Number.isNaN(raw) ? 1 : raw) * 100);
    return (
      <SliderField
        key={`opacity:${a ?? ''}`}
        value={pct}
        min={0}
        max={100}
        step={1}
        unit="%"
        ariaLabel="opacity"
        onInput={(n) => optimistic('opacity', String(n / 100))}
        onCommit={(n) => commit('opacity', String(n / 100))}
      />
    );
  };
  // B / I / U quick-style toggle group → font-weight / font-style / text-decoration
  const textStyleToggle = () => {
    const isBold = Number.parseInt(authored['font-weight'] || cssHint(computed['font-weight']) || '400', 10) >= 600;
    const isItalic = (authored['font-style'] || cssHint(computed['font-style'])) === 'italic';
    const isUnder = /underline/.test(authored['text-decoration'] || cssHint(computed['text-decoration']) || '');
    return (
      <IconToggleGroup
        value={{ b: isBold, i: isItalic, u: isUnder }}
        ariaLabel="text style"
        options={[{ value: 'b', node: <Lu as={LuBold} />, label: 'Bold' }, { value: 'i', node: <Lu as={LuItalic} />, label: 'Italic' }, { value: 'u', node: <Lu as={LuUnderline} />, label: 'Underline' }]}
        onToggle={(k) => {
          if (k === 'b') commit('font-weight', isBold ? '400' : '700');
          else if (k === 'i') commit('font-style', isItalic ? 'normal' : 'italic');
          else commit('text-decoration', isUnder ? 'none' : 'underline');
        }}
      />
    );
  };
  const DIR_OPTS = [{ value: 'row', node: <Lu as={LuColumns3} />, label: 'Row' }, { value: 'column', node: <Lu as={LuRows3} />, label: 'Column' }];
  const JUSTIFY_OPTS = [{ value: 'flex-start', node: <Lu as={LuJustifyStart} />, label: 'Start' }, { value: 'center', node: <Lu as={LuJustifyCenter} />, label: 'Center' }, { value: 'flex-end', node: <Lu as={LuJustifyEnd} />, label: 'End' }, { value: 'space-between', node: <Lu as={LuSpaceBetween} />, label: 'Space between' }];
  const ALIGNITEMS_OPTS = [{ value: 'flex-start', node: <Lu as={LuVJustifyStart} />, label: 'Start' }, { value: 'center', node: <Lu as={LuVJustifyCenter} />, label: 'Center' }, { value: 'flex-end', node: <Lu as={LuVJustifyEnd} />, label: 'End' }, { value: 'stretch', node: <Lu as={LuStretch} />, label: 'Stretch' }];
  const TEXTALIGN_OPTS = [{ value: 'left', node: <Lu as={LuAlignLeft} />, label: 'Left' }, { value: 'center', node: <Lu as={LuAlignCenter} />, label: 'Center' }, { value: 'right', node: <Lu as={LuAlignRight} />, label: 'Right' }, { value: 'justify', node: <Lu as={LuAlignJustify} />, label: 'Justify' }];
  const OVERFLOW_OPTS = [{ value: 'visible', node: <Lu as={LuEye} />, label: 'Visible' }, { value: 'hidden', node: <Lu as={LuScissors} />, label: 'Hidden' }, { value: 'scroll', node: <Lu as={LuScrollText} />, label: 'Scroll' }];

  // token quick-pick — Figma-style POPOVER (W2.1) listing the DS variables for
  // this property (name + resolved value), grouped per design system (W3);
  // picking writes var(--token). `familyKey` selects the token family.
  const tok = (prop, familyKey) => {
    const groups = tokenGroups(familyKey);
    return groups.length ? (
      <TokenPopover
        kind="value"
        groups={groups}
        current={authored[prop]}
        activeDs={_activeDs}
        onPick={(v) => commit(prop, v)}
        label={`${prop} design token`}
      />
    ) : null;
  };

  // Select-all-on-focus (deferred past the browser's own click-caret placement
  // so a SECOND click, already focused, places the caret instead) — the
  // interaction-model rule applied to the CssKnobs fields that stay bespoke
  // <input>s (free text, box-model cells) rather than the shared NumberField.
  const selectAllOnFocus = (e) => {
    const el = e.currentTarget;
    requestAnimationFrame(() => {
      if (document.activeElement === el) el.select();
    });
  };
  // Arrow-key stepping (±1, Shift ×10) for the bespoke box-model cells — same
  // keyboard model NumberField gives the main fields, hand-rolled here because
  // these stay compact <input>s (no room for NumberField's handle+stepper
  // chrome in a 36×24 box-model cell). Returns true if it handled the key.
  const stepBoxInput = (e, commitFn) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
    e.preventDefault();
    const mult = e.shiftKey ? 10 : 1;
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const n = (Number.parseFloat(e.currentTarget.value) || 0) + dir * mult;
    e.currentTarget.value = String(n);
    commitFn(n);
    return true;
  };

  // free text input — raw value or var(--token), commits on blur/Enter
  const text = (prop) => (
    <input
      className="st-cp-fin"
      key={`${prop}:${authored[prop] ?? ''}`}
      aria-label={prop}
      defaultValue={authored[prop] ?? ''}
      placeholder={cssHint(computed[prop]) || '—'}
      onFocus={selectAllOnFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => commit(prop, e.currentTarget.value)}
    />
  );

  // number + steppers + unit-select (+ optional token quick-pick after) — built
  // on the shared NumberField (feature-inspector-controls-redesign): the drag
  // handle moves to the leading icon/grip (never the input body, so click-to-
  // type + select-all-on-focus work), and arrow-key stepping comes for free.
  const num = (prop, tokenList, opts = {}) => {
    const cur = cssSplitUnit(authored[prop] ?? '');
    // Unitless CSS properties — a bare number must commit WITHOUT a unit suffix
    // (line-height: 1.5px ≠ 1.5 — knob-smoke finding, 2026-06-12).
    const unitless = CSS_UNITLESS.has(prop);
    // `opts.fixedUnit` — a px-only field (border-width) skips the unit <select>
    // entirely so the compact border-cluster row (width + style + swatch) has
    // room to fit at the panel's 260-304px widths (Task 5 overflow fix).
    const unit = unitless ? '' : opts.fixedUnit || (cur.unit && cur.unit !== 'auto' ? cur.unit : 'px');
    const lead = PROP_LEAD[prop];
    // Unset (no authored value) shows the computed/inherited value as the
    // starting number — same value the old placeholder hinted at; the row's own
    // dimming (`row()`'s `is-unset`) is what signals "inherited", not this field.
    const hintN = Number.parseFloat(cssSplitUnit(cssHint(computed[prop]) ?? '').n) || 0;
    const shownN = cur.n !== '' && cur.n != null ? Number.parseFloat(cur.n) || 0 : hintN;
    return (
      <>
        <NumberField
          key={`${prop}:${authored[prop] ?? ''}`}
          value={shownN}
          min={opts.min ?? 0}
          step={1}
          ariaLabel={prop}
          lead={lead ? (lead.node ?? lead.t) : undefined}
          onCommit={(n) => commit(prop, unitless ? `${n}` : `${n}${unit}`)}
          unitSlot={
            unitless || opts.fixedUnit ? null : (
              <UnitSelect
                units={CSS_UNITS}
                value={cur.unit || 'px'}
                ariaLabel={`${prop} unit`}
                onChange={(u) => commit(prop, u === 'auto' ? 'auto' : `${cur.n || '0'}${u}`)}
              />
            )
          }
        />
        {tok(prop, tokenList)}
      </>
    );
  };

  // color swatch (native picker → hex) + raw text + token quick-pick
  const color = (prop) => {
    // ONE compact colour field (feature-inspector-controls-redesign handoff): the
    // TokenPopover swatch is the FLUSH prefix (divider, no gap) inside ColorField,
    // then the value input — swatch + value read as one field. The popover keeps
    // its full HSV picker (Custom) + DS swatches (Variables) + cross-DS/security.
    const resolved = computed[prop] || authored[prop] || '';
    const av = authored[prop] ?? '';
    const bound = typeof av === 'string' && /var\(\s*--/.test(av);
    const display = bound ? av.replace(/^var\(\s*|\s*\)$/g, '').replace(/^--/, '').replace(/-/g, ' ') : av;
    return (
      <ColorField
        swatch={
          <TokenPopover
            kind="color"
            swatchClassName="st-cp-cf-sw"
            groups={tokenGroups('color')}
            current={authored[prop]}
            activeDs={_activeDs}
            swatchBg={resolved}
            seedHex={cssColorToHex(computed[prop] || authored[prop]) || '#000000'}
            onPick={(v) => commit(prop, v)}
            label={`${prop} colour`}
          />
        }
        displayValue={display}
        bound={bound}
        ariaLabel={prop}
        onValue={(v) => commit(prop, v)}
      />
    );
  };

  // a box-model side input (margin/padding longhand). Phase 12.3 — Webflow-style:
  // always shows the RESOLVED value (0 instead of blank) and a faint `is-zero`
  // styling for an unset/zero side. Edits the single side (the old "link all
  // sides" toggle was removed — DDR-104 Phase 12.3 W1.5).
  // Built on the shared `makeScrubHandler` engine (feature-inspector-controls-
  // redesign) — a plain (non-hook) factory, since `side`/`inset` are helper
  // closures invoked during render, not components (can't call a hook there).
  // These stay compact <input>s with whole-cell scrub (no separate drag handle
  // — the Figma/Webflow convention for tiny box-model cells with no room for
  // one; the 3px dead-zone already lets a plain click through to focus). A
  // multi-side drag (alt = pair, alt+shift = all four) live-updates the sibling
  // box inputs too, so the whole move shows in the panel, not just the dragged
  // cell — `node` closes over the actual input DOM element via onPointerDown.
  const boxScrub = (prop, opts) => {
    let node = null;
    const unit = opts.unitless ? '' : 'px';
    const fmt = (n) => (opts.unitless ? `${n}` : `${n}${unit}`);
    const applyToSides = (n, activeSides, fn) => {
      for (const p of activeSides ?? [prop]) fn(p, fmt(n));
    };
    const scrub = makeScrubHandler({
      getBase: () => node?.value ?? '0',
      min: opts.min ?? 0,
      step: 1,
      sides: opts.sides,
      onInput: (n, activeSides) => {
        if (node) node.value = String(n);
        if (activeSides) {
          const box = node?.closest('.st-cp-box');
          for (const p of activeSides) {
            if (p === prop) continue;
            const sib = box?.querySelector(`.st-cp-boxv[aria-label="${p}"]`);
            if (sib) sib.value = String(n);
          }
        }
        applyToSides(n, activeSides, optimistic);
      },
      onCommit: (n, activeSides) => applyToSides(n, activeSides, commit),
    });
    return {
      onPointerDown: (e) => {
        node = e.currentTarget;
        scrub(e);
      },
    };
  };

  const side = (prop, group) => {
    const a = authored[prop];
    const shown =
      a != null && a !== ''
        ? cssSplitUnit(a).n || a
        : cssSplitUnit(cssHint(computed[prop]) ?? '').n || '0';
    const isZero = !a || a === '0' || a === '0px' || a === 'auto';
    // Webflow scrub modifiers — alt = symmetric pair (block for top/bottom,
    // inline for left/right), alt+shift = all four.
    const edge = prop.split('-').pop();
    const pair =
      edge === 'top' || edge === 'bottom'
        ? [`${group}-top`, `${group}-bottom`]
        : [`${group}-left`, `${group}-right`];
    const all = [`${group}-top`, `${group}-right`, `${group}-bottom`, `${group}-left`];
    return (
      <input
        className={`st-cp-boxv st-cp-scrub st-cp-boxv--${group[0]}${prop.split('-').pop()[0]}${
          isZero ? ' is-zero' : ''
        }`}
        key={`${prop}:${a ?? ''}`}
        aria-label={prop}
        defaultValue={shown}
        title="drag to scrub · alt = symmetric · alt+shift = all sides"
        {...boxScrub(prop, { sides: { pair, all } })}
        onFocus={selectAllOnFocus}
        onKeyDown={(e) => {
          if (stepBoxInput(e, (n) => commit(prop, `${n}px`))) return;
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const raw = e.currentTarget.value.trim();
          if (!raw) return;
          const val = /[a-z%]/i.test(raw) ? raw : `${raw}px`;
          commit(prop, val);
        }}
      />
    );
  };

  // feature-element-editing-robustness Stage B (Task B3) — a position INSET side
  // (top/right/bottom/left). Mirrors `side()` but for the bare inset longhands
  // (no group prefix), allowing NEGATIVE values and an `auto` default, and reuses
  // the same box-model scrub grammar: alt = the axis pair, alt+shift = all four.
  const inset = (prop) => {
    const a = authored[prop];
    const shown =
      a != null && a !== '' && a !== 'auto'
        ? cssSplitUnit(a).n || a
        : cssSplitUnit(cssHint(computed[prop]) ?? '').n || '';
    const isZero = !a || a === 'auto' || a === '0' || a === '0px';
    const pair = prop === 'top' || prop === 'bottom' ? ['top', 'bottom'] : ['left', 'right'];
    const all = ['top', 'right', 'bottom', 'left'];
    return (
      <input
        className={`st-cp-boxv st-cp-scrub st-cp-boxv--i${prop[0]}${isZero ? ' is-zero' : ''}`}
        key={`${prop}:${a ?? ''}`}
        aria-label={prop}
        defaultValue={shown}
        placeholder="auto"
        title="drag to scrub · alt = axis pair · alt+shift = all sides · type auto"
        {...boxScrub(prop, { sides: { pair, all }, min: -Infinity })}
        onFocus={selectAllOnFocus}
        onKeyDown={(e) => {
          if (stepBoxInput(e, (n) => commit(prop, `${n}px`))) return;
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const raw = e.currentTarget.value.trim();
          if (!raw) return;
          const val = /[a-z%]/i.test(raw) ? raw : `${raw}px`;
          commit(prop, val);
        }}
      />
    );
  };

  // Phase 12.3 — authored inline props with no curated row + custom HTML attrs,
  // surfaced in Advanced so the user can see/edit/remove what they added.
  const customStyleRows = Object.entries(customStyles);
  const attrRows = Object.entries(attrs);

  // Stage B (Task B5) — Media framing gate + body, pulled out (DDR-171) so
  // Designer mode's "Media" cluster renders the identical content (just a
  // relabeled wrapper) instead of re-deriving `showMedia`/`canReplace`.
  // Rendered only for a media element (img / video / picture / svg / canvas)
  // or a selection that already carries a framing prop, so a plain <div>
  // doesn't grow object-fit rows. Media = box/framing/source (this plan); the
  // photo-editor plan's "Photo" tab owns pixels/look — separate DOM slots by
  // design.
  const mediaGate = () => {
    const t = (el.tag || '').toLowerCase();
    const isMediaEl = t === 'img' || t === 'video' || t === 'picture' || t === 'svg' || t === 'canvas';
    const showMedia =
      isMediaEl || !!authored['object-fit'] || !!authored['object-position'] || !!authored['aspect-ratio'];
    // Stage F2 — "Replace…" opens the AssetPicker to re-point src (authored
    // <img>/<video> only; a template-expression src can't be string-swapped,
    // so gate on a real src attr being present).
    const canReplace = (t === 'img' || t === 'video') && !!el.attrs?.src && !!onReplaceMedia;
    return { showMedia, canReplace };
  };
  const mediaBody = (canReplace) => (
    <>
      {canReplace && (
        <div className="st-cp-mediabtn">
          <button type="button" className="st-btn st-cp-replace" onClick={() => onReplaceMedia(el)}>
            Replace…
          </button>
        </div>
      )}
      {row('object-fit', csel('object-fit', CSS_OBJECT_FIT))}
      {row('object-position', text('object-position'))}
      {row(
        'aspect-ratio',
        <select
          className="st-cp-nsel"
          aria-label="aspect-ratio"
          value={CSS_ASPECT_RATIO.includes(authored['aspect-ratio']) ? authored['aspect-ratio'] : ''}
          onChange={(e) => {
            const v = e.target.value;
            commit('aspect-ratio', v);
            // A fixed height overrides aspect-ratio (CSS: explicit width+height
            // win). When applying a real ratio, release the height so the ratio
            // actually reshapes the box (dogfood: "nastavil jsem 16/9 a nic se
            // nestalo").
            if (v && v !== 'auto' && authored.height) reset('height');
          }}
        >
          <option value="" disabled>
            {cssHint(computed['aspect-ratio']) || '—'}
          </option>
          {CSS_ASPECT_RATIO.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )}
    </>
  );

  return (
    <div className={`st-cp${mode === 'designer' ? ' st-cp--designer' : ''}`} key={el.id} data-tour="css-panel" onKeyDown={onKnobKeyDown}>
      <div className="st-cp-id">
        <span className="st-cp-idtag">
          {el.tag || 'element'}
          {el.classes ? <span className="st-cp-idcls">.{el.classes.split(/\s+/)[0]}</span> : null}
        </span>
        {/* DDR-171 — vocabulary mode toggle, tucked into the id row's corner
            slot (was a full-width Segmented row — read as too heavy; a
            two-icon IconButtonGroup matches every other compact toggle in
            this panel). 'advanced' is the default (today's panel, byte-
            identical below); 'designer' swaps in the Figma-vocabulary regroup.
            Named "Advanced" (not "Simple"/"Basic") so neither mode reads as
            the lesser fallback — see DDR-171 for the naming-collision call
            against the nested Advanced *section* below. */}
        <span className="st-cp-idmode" data-tour="cp-mode">
          <IconButtonGroup
            value={mode}
            ariaLabel="panel vocabulary mode"
            options={[
              { value: 'advanced', node: <Lu as={LuBraces} size={12} />, label: 'Advanced — raw CSS' },
              { value: 'designer', node: <Lu as={LuWand2} size={12} />, label: 'Designer — Figma vocabulary' },
            ]}
            onChange={setMode}
          />
        </span>
      </div>

      {mode === 'designer' ? (
        <>
          {dsec(
            'Auto layout',
            ['display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
            (() => {
              const disp = (authored.display || cssHint(computed.display) || '').trim();
              const isFlex = disp === 'flex' || disp === 'inline-flex';
              return isFlex ? (
                <>
                  {row('flex-direction', iconseg('flex-direction', DIR_OPTS), undefined, 'Direction')}
                  {row(
                    'align-items',
                    <AlignPad value={alignPadCell()} onChange={setAlignPadCell} ariaLabel="auto-layout alignment" />,
                    provOf('align-items'),
                    'Alignment'
                  )}
                  {row('gap', vtok('gap', 'space'), undefined, 'Gap')}
                  <div className="st-cp-modes">
                    {sizeModeSeg('width')}
                    {sizeModeSeg('height')}
                  </div>
                  <div className="st-cp-box" aria-label="padding">
                    <span className="st-cp-boxtag st-cp-boxtag--p">
                      {prov(provOf('padding-top'))}padding
                    </span>
                    {side('padding-top', 'padding')}
                    {side('padding-right', 'padding')}
                    {side('padding-bottom', 'padding')}
                    {side('padding-left', 'padding')}
                  </div>
                  <div className="st-cp-clustermore-row">{moreBtn('Auto layout')}</div>
                  {designerMore['Auto layout']
                    ? row(
                        'flex-wrap',
                        <Toggle
                          checked={/^wrap/.test(authored['flex-wrap'] || cssHint(computed['flex-wrap']) || '')}
                          label="wrap items"
                          ariaLabel="flex-wrap"
                          onChange={(w) => commit('flex-wrap', w ? 'wrap' : 'nowrap')}
                        />,
                        provOf('flex-wrap'),
                        'Wrap'
                      )
                    : null}
                </>
              ) : (
                <button type="button" className="st-cp-makeflex" disabled={!editable} onClick={() => commit('display', 'flex')}>
                  + Auto layout (flex)
                </button>
              );
            })()
          )}

          {dsec(
            'Size',
            ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'],
            <>
              {row('width', num('width'), undefined, 'Width')}
              {row('height', num('height'), undefined, 'Height')}
              <div className="st-cp-clustermore-row">{moreBtn('Size')}</div>
              {designerMore.Size ? (
                <>
                  {row('min-width', num('min-width'), undefined, 'Min width')}
                  {row('max-width', num('max-width'), undefined, 'Max width')}
                  {row('min-height', num('min-height'), undefined, 'Min height')}
                  {row('max-height', num('max-height'), undefined, 'Max height')}
                </>
              ) : null}
            </>
          )}

          {dsec(
            'Position',
            ['position', 'top', 'right', 'bottom', 'left', 'z-index'],
            <>
              {row('position', csel('position', CSS_POSITION), undefined, 'Position')}
              <div className="st-cp-box st-cp-box--inset" aria-label="position inset (top / right / bottom / left)">
                <span className="st-cp-boxtag st-cp-boxtag--i">{prov(provOf('top'))}inset</span>
                {inset('top')}
                {inset('right')}
                {inset('bottom')}
                {inset('left')}
                <div className="st-cp-boxcore st-cp-boxcore--pos">
                  {authored.position || cssHint(computed.position) || 'static'}
                </div>
              </div>
              {(authored.position || cssHint(computed.position) || 'static') === 'static' ? (
                <div className="st-cp-note">
                  top / right / bottom / left apply once position is relative, absolute, fixed, or sticky
                </div>
              ) : null}
              <div className="st-cp-clustermore-row">{moreBtn('Position')}</div>
              {designerMore.Position ? row('z-index', num('z-index'), undefined, 'Layer order') : null}
            </>,
            false
          )}

          {dsec('Fill', ['background-color'], row('background-color', color('background-color'), undefined, 'Fill'))}

          {dsec('Stroke', ['border-width', 'border-style', 'border-color'], row('border', borderControl(), provOf('border-width'), 'Stroke'))}

          {dsec(
            'Corner radius',
            ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'],
            row('border-radius', radiusControl(), provOf('border-radius'), 'Corner radius')
          )}

          {dsec(
            'Effects',
            ['box-shadow', 'filter', 'mix-blend-mode'],
            <>
              {row('box-shadow', tok('box-shadow', 'shadow') || text('box-shadow'), undefined, 'Shadow')}
              {row('filter', blurControl(), provOf('filter'), 'Blur')}
              {row('mix-blend-mode', csel('mix-blend-mode', CSS_BLEND_MODES), undefined, 'Blend')}
            </>
          )}

          {dsec('Opacity', ['opacity'], row('opacity', opacityControl(), undefined, 'Opacity'))}

          {dsec(
            'Text',
            ['font-family', 'color', 'font-size', 'font-weight', 'line-height', 'text-align', 'letter-spacing', 'font-style', 'text-transform', 'white-space'],
            <>
              {row('font-family', csel('font-family', CSS_FONTS), undefined, 'Font')}
              {row('color', color('color'), undefined, 'Color')}
              {row('font-size', vtok('font-size', 'type'), undefined, 'Size')}
              {row('font-weight', csel('font-weight', CSS_WEIGHTS), undefined, 'Weight')}
              {row('line-height', num('line-height', 'lh'), undefined, 'Line height')}
              {row('text-align', iconseg('text-align', TEXTALIGN_OPTS), undefined, 'Align')}
              <div className="st-cp-clustermore-row">{moreBtn('Text')}</div>
              {designerMore.Text ? (
                <>
                  {row('letter-spacing', num('letter-spacing', null, { min: -Infinity }), undefined, 'Letter spacing')}
                  {row('font-style', csel('font-style', CSS_FONT_STYLE), undefined, 'Style')}
                  {row('text-transform', csel('text-transform', CSS_TEXT_TRANSFORM), undefined, 'Case')}
                  {row('white-space', csel('white-space', CSS_WHITE_SPACE), undefined, 'Whitespace')}
                </>
              ) : null}
            </>
          )}

          {dsec(
            'Spacing',
            ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
            <div className="st-cp-box" aria-label="margin">
              <span className="st-cp-boxtag st-cp-boxtag--m">{prov(provOf('margin-top'))}margin</span>
              {side('margin-top', 'margin')}
              {side('margin-right', 'margin')}
              {side('margin-bottom', 'margin')}
              {side('margin-left', 'margin')}
            </div>
          )}

          {(() => {
            const { showMedia, canReplace } = mediaGate();
            return showMedia
              ? dsec('Media', ['object-fit', 'object-position', 'aspect-ratio'], mediaBody(canReplace))
              : null;
          })()}
        </>
      ) : (
        <>
      {sec(
        'Layout',
        (() => {
          // Stage M2 — auto-layout editor. Present the flex vocabulary (Direction ·
          // Wrap · Distribution · Align · Gap) only when the element IS a flex/grid
          // container, so a plain block doesn't carry knobs that do nothing; a
          // non-container gets a one-click "make it a flex layout" instead (the
          // DDR-104 gap-degrades-gracefully precedent). align-items / justify-content
          // / gap apply to grid too; flex-direction / flex-wrap are flex-only.
          const disp = (authored.display || cssHint(computed.display) || '').trim();
          const isFlex = disp === 'flex' || disp === 'inline-flex';
          const isGrid = disp === 'grid' || disp === 'inline-grid';
          return (
            <>
              {row('display', csel('display', CSS_DISPLAYS))}
              {isFlex ? (
                <>
                  {row('flex-direction', iconseg('flex-direction', DIR_OPTS))}
                  {row('flex-wrap', <Toggle checked={/^wrap/.test(authored['flex-wrap'] || cssHint(computed['flex-wrap']) || '')} label="wrap items" ariaLabel="flex-wrap" onChange={(w) => commit('flex-wrap', w ? 'wrap' : 'nowrap')} />, provOf('flex-wrap'))}
                </>
              ) : null}
              {isFlex || isGrid ? (
                <>
                  {row('align-items', iconseg('align-items', ALIGNITEMS_OPTS))}
                  {row('justify-content', iconseg('justify-content', JUSTIFY_OPTS))}
                  {row('gap', vtok('gap', 'space'))}
                </>
              ) : (
                <button
                  type="button"
                  className="st-cp-makeflex"
                  disabled={!editable}
                  onClick={() => commit('display', 'flex')}
                >
                  + Auto layout (flex)
                </button>
              )}
            </>
          );
        })()
      )}

      {(() => {
        // feature-3-web-artboards T5 (absorbed feature-grid-track-editor
        // stub) — Grid section, only when the element IS a grid container.
        // Track parse/serialize is the SAME grid-track-handles.ts module the
        // on-canvas gutter-drag overlay uses, so the Inspector and the drag
        // handles never disagree about track shape.
        const disp = (authored.display || cssHint(computed.display) || '').trim();
        const isGrid = disp === 'grid' || disp === 'inline-grid';
        if (!isGrid) return null;
        const colsRaw = authored['grid-template-columns'] || '';
        const rowsRaw = authored['grid-template-rows'] || '';
        const cols = parseTrackList(colsRaw);
        const rows = parseTrackList(rowsRaw);
        const colsEditable = cols.length > 0 || !colsRaw.trim();
        const rowsEditable = rows.length > 0 || !rowsRaw.trim();
        return sec(
          'Grid',
          <>
            {colsEditable ? (
              <GridTracksEditor
                label="Columns"
                tracks={cols}
                editable={editable}
                onChange={(next) => commit('grid-template-columns', serializeTrackList(next))}
              />
            ) : (
              <div className="st-cp-note">
                Columns use <code>{colsRaw}</code> — not editable as tracks here (repeat()/
                minmax()/subgrid); use /design:edit for these.
              </div>
            )}
            {rowsEditable ? (
              <GridTracksEditor
                label="Rows"
                tracks={rows}
                editable={editable}
                onChange={(next) => commit('grid-template-rows', serializeTrackList(next))}
              />
            ) : (
              <div className="st-cp-note">
                Rows use <code>{rowsRaw}</code> — not editable as tracks here (repeat()/minmax()/
                subgrid); use /design:edit for these.
              </div>
            )}
          </>
        );
      })()}

      {sec(
        'Position',
        <>
          {row('position', csel('position', CSS_POSITION))}
          <div className="st-cp-box st-cp-box--inset" aria-label="position inset (top / right / bottom / left)">
            <span className="st-cp-boxtag st-cp-boxtag--i">{prov(provOf('top'))}inset</span>
            {inset('top')}
            {inset('right')}
            {inset('bottom')}
            {inset('left')}
            <div className="st-cp-boxcore st-cp-boxcore--pos">
              {authored.position || cssHint(computed.position) || 'static'}
            </div>
          </div>
          {(authored.position || cssHint(computed.position) || 'static') === 'static' ? (
            <div className="st-cp-note">
              top / right / bottom / left apply once position is relative, absolute, fixed, or sticky
            </div>
          ) : null}
          {row('z-index', num('z-index'))}
        </>
      )}

      {(el.parentDisplay === 'grid' || el.parentDisplay === 'inline-grid') &&
        sec(
          'Grid item',
          <>
            <div className="st-cp-note">
              Manual cell placement — <code>start / end</code> or <code>start / span N</code>.
            </div>
            {row('grid-column', text('grid-column'))}
            {row('grid-row', text('grid-row'))}
          </>
        )}

      {sec(
        'Typography',
        <>
          {row('font-family', csel('font-family', CSS_FONTS))}
          {row('color', color('color'))}
          {row('font-size', vtok('font-size', 'type'))}
          {row('font-weight', csel('font-weight', CSS_WEIGHTS))}
          {row('line-height', num('line-height', 'lh'))}
          {row('letter-spacing', num('letter-spacing', null, { min: -Infinity }))}
          {/* handoff — text-align as a lucide icon button group; B/I/U as a toggle
              group mapped to font-weight / font-style / text-decoration. */}
          {row('text-align', iconseg('text-align', TEXTALIGN_OPTS))}
          {row('font-style', textStyleToggle(), provOf('font-style'))}
          {/* Stage B (Task B4) — promoted typography knobs (was DDR-104 OUT-list). */}
          {row('text-transform', csel('text-transform', CSS_TEXT_TRANSFORM))}
          {row('white-space', csel('white-space', CSS_WHITE_SPACE))}
        </>
      )}

      {sec(
        'Spacing',
        <>
          <div className="st-cp-box" aria-label="margin and padding">
            <span className="st-cp-boxtag st-cp-boxtag--m">
              {prov(provOf('margin-top'))}margin
            </span>
            {side('margin-top', 'margin')}
            {side('margin-right', 'margin')}
            {side('margin-bottom', 'margin')}
            {side('margin-left', 'margin')}
            <div className="st-cp-boxpad">
              <span className="st-cp-boxtag st-cp-boxtag--p">
                {prov(provOf('padding-top'))}padding
              </span>
              {side('padding-top', 'padding')}
              {side('padding-right', 'padding')}
              {side('padding-bottom', 'padding')}
              {side('padding-left', 'padding')}
              <div className="st-cp-boxcore">
                {/* handoff — prefer the AUTHORED size (updates live as you edit
                    width/height); el.bounds is stale until the canvas re-measures. */}
                {Math.round(Number.parseFloat(authored.width) || el.bounds?.w || 0)} × {Math.round(Number.parseFloat(authored.height) || el.bounds?.h || 0)}
              </div>
            </div>
          </div>
        </>
      )}

      {sec(
        'Size',
        <>
          {/* Stage M1 — per-axis Fixed / Hug / Fill sizing mode (Figma parity). The
              Fixed case leaves the numeric width/height knobs below in control. */}
          <div className="st-cp-modes">
            {sizeModeSeg('width')}
            {sizeModeSeg('height')}
          </div>
          {row('width', num('width'))}
          {row('height', num('height'))}
          {row('min-width', num('min-width'))}
          {row('max-width', num('max-width'))}
          {row('min-height', num('min-height'))}
          {row('max-height', num('max-height'))}
          {row('overflow', iconseg('overflow', OVERFLOW_OPTS))}
          {/* Stage M1 — flex-CHILD controls, only meaningful when the parent is a
              flex container. align-self is the cross-axis override; flex-grow/shrink/
              basis are the main-axis behavior the Fill mode writes for you. */}
          {parentIsFlexChild ? (
            <>
              <div className="st-cp-subhd">In flex parent</div>
              {row('align-self', csel('align-self', CSS_ALIGN_SELF))}
              {row('flex-grow', num('flex-grow', null, { unitless: true }))}
              {row('flex-shrink', num('flex-shrink', null, { unitless: true }))}
              {row('flex-basis', num('flex-basis'))}
            </>
          ) : null}
        </>
      )}

      {/* Stage B (Task B5) — Media framing (gate/body pulled into mediaGate()/
          mediaBody() above, DDR-171, so Designer mode's "Media" cluster
          reuses the identical content). */}
      {(() => {
        const { showMedia, canReplace } = mediaGate();
        return showMedia ? sec('Media', mediaBody(canReplace)) : null;
      })()}

      {sec(
        'Appearance',
        <>
          {row('background-color', color('background-color'))}
          {row('border-radius', radiusControl(), provOf('border-radius'))}
          {row('border', borderControl(), provOf('border-width'))}
          {row('box-shadow', tok('box-shadow', 'shadow') || text('box-shadow'))}
          {/* DDR-171 — blur + blend, real Advanced-mode rows (not Designer-exclusive);
              also power Designer mode's "Effects" cluster. */}
          {row('filter', blurControl(), provOf('filter'))}
          {row('mix-blend-mode', csel('mix-blend-mode', CSS_BLEND_MODES))}
          {row('opacity', opacityControl())}
          {/* Stage B (Task B4) — transform as a free-value row (mirrors box-shadow). */}
          {row('rotation', rotationControl(), provOf('transform'))}
          {row('transform', text('transform'))}
          {row('transform-origin', text('transform-origin'))}
        </>
      )}

      {/* #5 — the idle/saved status now lives in each row's leading dot (a glow),
          so the panel no longer carries a confusing standing 'written to source'
          line. Only a hard ERROR surfaces here, with the failing property. */}
      {(() => {
        const err = Object.entries(status).find(
          ([, s]) => typeof s === 'string' && s.startsWith('err:')
        );
        return err ? (
          <div className="st-cp-save is-err" role="status">
            <StIcon name="x" size={12} />
            {err[0]}: {err[1].slice(4)}
          </div>
        ) : null;
      })()}

      {sec(
        'Advanced',
        <div className="st-cp-advbody">
          {customStyleRows.length ? (
            <>
              <div className="st-cp-advgrp">Custom CSS properties</div>
              {customStyleRows.map(([p, v]) => (
                <div className="st-cp-kv" key={`cs:${p}`}>
                  <input
                    className="st-cp-fin st-cp-fin--ro"
                    readOnly
                    value={p}
                    aria-label={`custom property ${p} name`}
                  />
                  <input
                    className="st-cp-fin"
                    key={`cs:${p}:${v}`}
                    defaultValue={v}
                    aria-label={`${p} value`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    onBlur={(e) => commitCustom(p, e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    className="st-cp-kvx"
                    aria-label={`remove ${p}`}
                    title="remove"
                    onClick={() => resetCustom(p)}
                  >
                    <StIcon name="x" size={11} />
                  </button>
                </div>
              ))}
            </>
          ) : null}
          <div className="st-cp-advgrp">Add CSS property</div>
          <RawKnob commit={commitCustom} />
          <div className="st-cp-note">applied as-is — not token-bound</div>
          {attrRows.length ? (
            <>
              <div className="st-cp-advgrp">Custom HTML attributes</div>
              {attrRows.map(([a, v]) => (
                <div className="st-cp-kv" key={`at:${a}`}>
                  <input
                    className="st-cp-fin st-cp-fin--ro"
                    readOnly
                    value={a}
                    aria-label={`attribute ${a} name`}
                  />
                  <input
                    className="st-cp-fin"
                    key={`at:${a}:${v}`}
                    defaultValue={v}
                    aria-label={`${a} value`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    onBlur={(e) => commitAttr(a, e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    className="st-cp-kvx"
                    aria-label={`remove ${a}`}
                    title="remove"
                    onClick={() => resetAttr(a)}
                  >
                    <StIcon name="x" size={11} />
                  </button>
                </div>
              ))}
            </>
          ) : null}
          <div className="st-cp-advgrp">Add HTML attribute</div>
          <AttrKnob commit={commitAttr} />
        </div>
      )}
        </>
      )}

      <div className="st-cp-legend">
        <span>
          <i className="st-cp-prov st-cp-prov--bound" aria-hidden="true" />
          token
        </span>
        <span>
          <i className="st-cp-prov st-cp-prov--raw" aria-hidden="true" />
          override
        </span>
        <span>
          <i className="st-cp-prov st-cp-prov--inherit" aria-hidden="true" />
          inherited
        </span>
      </div>
    </div>
  );
}

// Custom CSS property hatch — writes an arbitrary `property: value` to inline style.
function RawKnob({ commit }) {
  const [prop, setProp] = useState('');
  const [val, setVal] = useState('');
  const submit = () => {
    if (prop.trim() && val.trim()) {
      commit(prop.trim(), val);
      setProp('');
      setVal('');
    }
  };
  return (
    <div className="st-cp-kv">
      <input
        className="st-cp-fin"
        aria-label="custom property name"
        placeholder="property"
        value={prop}
        onChange={(e) => setProp(e.target.value)}
      />
      <input
        className="st-cp-fin"
        aria-label="custom property value"
        placeholder="value"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        onBlur={submit}
      />
    </div>
  );
}

// Custom HTML attribute hatch — writes a plain JSX attribute (data-*, aria-*, …).
function AttrKnob({ commit }) {
  const [attr, setAttr] = useState('');
  const [val, setVal] = useState('');
  const submit = () => {
    if (attr.trim() && val.trim()) {
      commit(attr.trim(), val);
      setAttr('');
      setVal('');
    }
  };
  return (
    <div className="st-cp-kv">
      <input
        className="st-cp-fin"
        aria-label="custom attribute name"
        placeholder="data-…"
        value={attr}
        onChange={(e) => setAttr(e.target.value)}
      />
      <input
        className="st-cp-fin"
        aria-label="custom attribute value"
        placeholder="value"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        onBlur={submit}
      />
    </div>
  );
}

// ---------- Inspector panel (display-only) ----------
//
// T6 (Plan C) — right-dock Inspect / Layers / CSS tabs per `.design/ui/Studio.tsx`
// InspectorPanel. DISPLAY-ONLY: reads the live `selected` payload from the
// inspector bridge (`bounds`, `tag`, `classes`, `dom_path`, `html`). The
// mockup's live-CSS-knob WRITEBACK is Phase 12 (needs a canvas-origin write
// bridge, DDR-054) — the CSS tab shows markup read-only + keeps that callout, so
// it never implies functionality it lacks (the exact reason DDR-096 deferred it).
// ---------- Layers tree row (Phase 12 Task 4) ----------
// Phase 12.3 (W3.1) — map a LayerNode `type` (classified in canvas-shell) to a
// type-distinct icon, matching the Studio.tsx layers design.
const LAYER_TYPE_ICON = {
  button: 'button',
  heading: 'type',
  text: 'type',
  input: 'input',
  form: 'input',
  image: 'image',
  link: 'link',
  list: 'list',
  nav: 'layers',
  box: 'box',
  // feature-4 T7 — synthetic group row (unstamped wrapper with stamped kids).
  group: 'folder',
};


// Optimistic layers-tree reorder — move the node with `draggedId` relative to
// `refId` (before / after a sibling, or inside-end as a last child). Pure: clones
// the node array and returns a new one, so React re-renders. Ids are distinct
// here (repeated/list nodes can't be dragged), so first-match-by-id is safe.
// Returns the input unchanged if either node isn't found (the HMR rebuild will
// reconcile).
function moveLayerNode(nodes, draggedId, refId, position) {
  if (!Array.isArray(nodes) || draggedId === refId) return nodes;
  const clone = JSON.parse(JSON.stringify(nodes));
  let dragged = null;
  const remove = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === draggedId) {
        dragged = arr[i];
        arr.splice(i, 1);
        return true;
      }
      if (arr[i].children && remove(arr[i].children)) return true;
    }
    return false;
  };
  remove(clone);
  if (!dragged) return nodes;
  const insert = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === refId) {
        if (position === 'inside-start' || position === 'inside-end') {
          arr[i].children = arr[i].children || [];
          if (position === 'inside-start') arr[i].children.unshift(dragged);
          else arr[i].children.push(dragged);
        } else {
          arr.splice(position === 'before' ? i : i + 1, 0, dragged);
        }
        return true;
      }
      if (arr[i].children && insert(arr[i].children)) return true;
    }
    return false;
  };
  return insert(clone) ? clone : nodes;
}

// Void / self-closing tags can't hold children → not a nest target. Everything
// else (div, section, span, …) can be nested into (matches "drop into any div").
const LAYER_VOID_TAGS = new Set([
  'img', 'input', 'br', 'hr', 'area', 'base', 'col', 'embed', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

function LayerRow({
  node,
  depth,
  selectedId,
  selectedIndex,
  collapsed,
  hiddenOverride,
  onToggle,
  onSelect,
  onHover,
  onToggleVisibility,
  onReorder,
  onRowPointerDown,
  dragState,
  // feature-4 T7a/b/c — component map (purple ◇/◆), locked keys + toggle,
  // dblclick rename (writes data-dc-element via edit-attr).
  componentMap,
  lockedKeys,
  onToggleLock,
  onRename,
}) {
  const key = `${node.id}:${node.index}`;
  const hasKids = node.children && node.children.length > 0;
  const isCollapsed = collapsed.has(key);
  // feature-4 T7 — a synthetic group row (unstamped wrapper) is a pure
  // structural stand-in: NOT selectable (no data-cd-id to address in source),
  // NOT draggable, NO eye toggle. Clicking it just expands/collapses.
  const isSynthetic = !!node.synthetic;
  // feature-4 T7a — purple instance rows: this element renders through an
  // instantiated component. `root` = the component's own frame root (◆).
  const inst = !isSynthetic && componentMap ? componentMap[node.id] : null;
  // feature-4 T7b — locked layers can't be selected/dragged on the canvas.
  const isLocked = !isSynthetic && !!lockedKeys?.has(key);
  // feature-4 T7c — inline rename (dblclick the label).
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  // Match the specific INSTANCE (id + occurrence index), not every element that
  // shares this source id — otherwise a `.map`ed element highlights all its
  // clones at once. Fall back to id-only when the selection carries no index.
  const isSel =
    !isSynthetic &&
    node.id === selectedId &&
    (selectedIndex == null || node.index === selectedIndex);
  const isHidden = hiddenOverride?.has(key) ? hiddenOverride.get(key) : !!node.hidden;
  // A shared data-cd-id (reused component instance) IS reorderable now — the
  // server maps the occurrence index to the parent <Component> usage — so these
  // are no longer greyed/blocked. A `.map()`ed single-usage element still can't
  // split; that move is refused server-side and reverts. A LOCKED row never
  // drags (feature-4 T7b).
  const canDrag = !!onReorder && !isSynthetic && !isLocked;
  const commitRename = () => {
    setRenaming(false);
    const v = renameDraft
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (!v || v === (node.dcElement ?? '')) return;
    onRename?.(node, v);
  };
  // Phase 12.1 — the row being dragged FLOATS with the cursor (same model as the
  // in-canvas drag): a transform follows the pointer, its layout box stays
  // reserved (empty slot at the origin), and pointer-events:none lets the row
  // under the pointer be hit-tested. A blue divider (rendered by the tree) marks
  // where it drops — indented to show the depth it will nest at (Figma-style).
  const isDragging = dragState?.key === key;
  const dragStyle = isDragging
    ? {
        transform: `translate(${dragState.dx}px, ${dragState.dy}px)`,
        opacity: 0.9,
        zIndex: 20,
        position: 'relative',
        pointerEvents: 'none',
        cursor: 'grabbing',
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.28)',
      }
    : null;
  return (
    <>
      <div
        className={
          'st-layer st-layer--row' +
          (isSel ? ' is-sel' : '') +
          (isHidden ? ' is-hidden' : '') +
          (isSynthetic ? ' is-group' : '') +
          (inst ? ' is-instance' : '') +
          (isLocked ? ' is-locked' : '')
        }
        style={{ paddingLeft: 6 + depth * 14, ...dragStyle }}
        role="treeitem"
        aria-selected={isSynthetic ? undefined : isSel}
        aria-expanded={hasKids ? !isCollapsed : undefined}
        aria-grabbed={canDrag ? isDragging : undefined}
        tabIndex={0}
        title={
          isSynthetic
            ? `${node.tag} · group (unstamped wrapper)`
            : `${node.tag} · ${node.type}${onRename ? ' · F2 to rename' : ''}`
        }
        data-layer-key={key}
        onClick={() => (isSynthetic ? hasKids && onToggle(key) : onSelect(node))}
        onMouseEnter={() => !isSynthetic && onHover(node)}
        onMouseLeave={() => onHover(null)}
        onPointerDown={canDrag ? (e) => onRowPointerDown(e, node, key) : undefined}
        onKeyDown={(e) => {
          // Enter/Space select (or, for a synthetic group, toggle); ↑/↓ (+
          // modifiers) are handled at the tree container (selection-driven —
          // survives the HMR re-render).
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isSynthetic) hasKids && onToggle(key);
            else onSelect(node);
          } else if (e.key === 'F2' && onRename && !isSynthetic) {
            // a11y fix (review fan-out, 2026-07-21) — dblclick was the ONLY
            // entry point into rename, a keyboard-only user had no way to
            // reach it at all (WCAG 2.1.1). F2 is the conventional rename key
            // (Explorer/Finder/most tree UIs); mirrors the dblclick handler's
            // own pre-fill.
            e.preventDefault();
            setRenameDraft(node.dcElement || node.label || '');
            setRenaming(true);
          }
        }}
      >
        {hasKids ? (
          <button
            type="button"
            className="st-layer-caret"
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(key);
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="st-layer-caret" aria-hidden="true" />
        )}
        {inst ? (
          // feature-4 T7a — Figma vocabulary: ◆ the component's own frame root,
          // ◇ an inner member of an instance. Purple via .is-instance CSS.
          <span className="st-layer-inst-glyph" aria-hidden="true">
            {inst.root ? '◆' : '◇'}
          </span>
        ) : (
          <StIcon name={LAYER_TYPE_ICON[node.type] || 'box'} size={12} className="st-layer-ticon" />
        )}
        {renaming ? (
          <input
            className="st-layer-rename"
            value={renameDraft}
            autoFocus
            aria-label={`Rename ${node.label}`}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span
            className="st-layer-label"
            onDoubleClick={
              onRename && !isSynthetic
                ? (e) => {
                    // feature-4 T7c — dblclick rename. Pre-fill from the raw
                    // data-dc-element (kebab) when set, else the display label.
                    e.stopPropagation();
                    setRenameDraft(node.dcElement || node.label || '');
                    setRenaming(true);
                  }
                : undefined
            }
          >
            {node.label}
          </span>
        )}
        <span className="st-layer-type">{inst ? inst.component : node.type}</span>
        {onToggleLock && !isSynthetic ? (
          <button
            type="button"
            className="st-layer-lock"
            aria-label={isLocked ? `Unlock ${node.label}` : `Lock ${node.label}`}
            aria-pressed={isLocked}
            title={isLocked ? 'Unlock' : 'Lock'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock(key);
            }}
          >
            <StIcon name={isLocked ? 'lock' : 'unlock'} size={12} />
          </button>
        ) : null}
        {onToggleVisibility && !isSynthetic ? (
          <button
            type="button"
            className="st-layer-eye"
            aria-label={isHidden ? `Show ${node.label}` : `Hide ${node.label}`}
            aria-pressed={isHidden}
            title={isHidden ? 'Show' : 'Hide'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility(node);
            }}
          >
            <StIcon name={isHidden ? 'eye-off' : 'eye'} size={13} />
          </button>
        ) : null}
      </div>
      {hasKids && !isCollapsed
        ? node.children.map((c, ci) => (
            <LayerRow
              key={`${c.id}:${c.index}`}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              selectedIndex={selectedIndex}
              collapsed={collapsed}
              hiddenOverride={hiddenOverride}
              onToggle={onToggle}
              onSelect={onSelect}
              onHover={onHover}
              onToggleVisibility={onToggleVisibility}
              onReorder={onReorder}
              onRowPointerDown={onRowPointerDown}
              dragState={dragState}
              componentMap={componentMap}
              lockedKeys={lockedKeys}
              onToggleLock={onToggleLock}
              onRename={onRename}
            />
          ))
        : null}
    </>
  );
}

// Phase 12.3 — live computed readout for the Inspect tab (replaces the stale
// "lands with the live CSS bridge (Phase 12)" callout — that bridge shipped).
// Reads the resolved values the selection already carries (dom-selection
// styleMapsFor → el.computed). Read-only; the CSS tab is where you edit.
function InspectComputed({ el }) {
  const c = el?.computed || {};
  const a = el?.authored || {};
  // Prefer the authored token name (var(--accent) → "--accent") as the label;
  // fall back to the resolved value. The swatch always shows the RESOLVED color.
  const valueLabel = (prop) => {
    const av = a[prop];
    if (av && /var\(\s*--/.test(av)) return av.replace(/^var\(\s*|\s*\)$/g, '');
    return c[prop] || av || '';
  };
  const colorRow = (lbl, prop) => {
    const resolved = c[prop] || a[prop];
    if (!resolved) return null;
    return (
      <div className="st-insp-row" key={lbl}>
        <span className="st-insp-label">{lbl}</span>
        <div className="st-swatch-row">
          <span className="st-insp-swatch" style={{ background: resolved }} aria-hidden="true" />
          <span className="st-mono" style={{ fontSize: 11, color: 'var(--fg-1)' }}>
            {valueLabel(prop)}
          </span>
        </div>
      </div>
    );
  };
  const hasRadius = c['border-radius'] && c['border-radius'] !== '0px';
  const radiusN = hasRadius ? cssSplitUnit(c['border-radius']).n || c['border-radius'] : null;
  const font =
    c['font-size'] || c['font-weight']
      ? [c['font-size'], c['font-weight']].filter(Boolean).join(' / ')
      : null;
  const anyType = c['background-color'] || c.color || hasRadius || font;
  if (!anyType) return null;
  return (
    <>
      {hasRadius ? (
        <div className="st-insp-row">
          <span className="st-insp-label">Radius</span>
          <div className="st-insp-fields">
            <span className="st-fmini" style={{ flex: '0 0 auto', maxWidth: 84 }}>
              <span className="st-mtag">r</span>
              <input value={radiusN} readOnly aria-label="border radius" />
            </span>
            <span className="st-insp-unit">px</span>
          </div>
        </div>
      ) : null}
      {colorRow('Fill', 'background-color')}
      {colorRow('Text', 'color')}
      {font ? (
        <div className="st-insp-row">
          <span className="st-insp-label">Font</span>
          <div className="st-insp-fields">
            <span className="st-mono" style={{ fontSize: 11, color: 'var(--fg-0)' }}>{font}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

// Dogfood 2026-07-07 — resolve the artboard id for a whole-artboard selection
// defensively: prefer `el.artboardId` (set by `hoverTargetToSelection` for a
// live chrome click), but fall back to parsing it out of `el.selector` — some
// selection-construction paths (Layers-tree artboard row, a restored
// `_active.json` selection) may not carry `artboardId` even though the
// selector is always the `[data-dc-screen="…"]` chrome form for one.
function resolveArtboardIdFromSelection(el) {
  if (el.artboardId) return el.artboardId;
  const m = /^\[data-dc-screen="([^"]+)"\]$/.exec(el.selector || '');
  return m ? m[1] : null;
}

// Dogfood 2026-07-07 — the CSS tab showed everything disabled for a
// whole-ARTBOARD selection (`CssKnobs`'s `editable = !!el.id`, and an artboard
// chrome click has NO data-cd-id — DCArtboard doesn't forward it to the DOM).
// A dedicated, MUCH smaller panel: exact width/height fields (writes via
// /_api/resize-artboard, NOT edit-css — DDR-027 numeric JSX props) + the SAME
// SCREEN_PRESETS the "+ Artboard" menu uses, so picking "Tablet" resizes the
// CURRENT artboard to 834×1194 in one click instead of typing both fields.
const ARTBOARD_LAYOUT_OPTIONS = [
  ['', 'Block (default)'],
  ['flex-col', 'Flex ↓ (column)'],
  ['flex-row', 'Flex → (row)'],
  ['grid', 'Grid'],
];

// feature-1-artboard-kinds-foundation, T8 — kind picker options. Order
// mirrors the DCArtboard `kind` union; 'digital' is the implicit default
// (writes `kind: null`, clearing the explicit prop, per applySetArtboardKind).
const ARTBOARD_KIND_OPTIONS = [
  ['digital', 'Digital'],
  ['print', 'Print'],
  ['web', 'Web'],
  ['video', 'Video'],
];

function ArtboardKnobs({
  el,
  cfg,
  onResizeArtboard,
  onSetArtboardHug,
  onSetArtboardStyle,
  onSetArtboardKind,
  onSetArtboardPrint,
  onDuplicateArtboard,
}) {
  const artboardId = resolveArtboardIdFromSelection(el);
  // Dogfood (artboard panel ↔ shared inspector controls) — the panel now uses
  // the SAME control library + design-token plumbing as CssKnobs (NumberField
  // / Segmented / Select / ColorField+TokenPopover / ValueTokenField), so Bg
  // binds color variables and Pad/Gap bind space variables exactly like any
  // CSS-panel row. Token resolution mirrors CssKnobs' own tokenGroups/
  // flatTokens closures over useAllDsTokens.
  const _designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  const _activeDs = activeDsNameFor(el.file, cfg);
  const allDs = useAllDsTokens(cfg, _designRel, _activeDs);
  const tokenGroups = (familyKey) =>
    allDs
      .map((d) => ({ ds: d.name, names: d[familyKey] || [], vals: d.vals }))
      .filter((g) => g.names.length);
  const flatTokens = (familyKey) =>
    tokenGroups(familyKey).flatMap((g) => (g.names || []).map((n) => ({ name: n, value: g.vals?.[n] || '' })));
  // Resolve a `var(--x)` binding to its concrete value across every DS (for
  // the Bg swatch color); a raw value passes through.
  const resolveTokenValue = (v) => {
    const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v || '');
    if (!m) return v || '';
    for (const d of allDs) {
      const val = d.vals?.[m[1]];
      if (val) return val;
    }
    return '';
  };
  // Dogfood 2026-07-07 (round 2) — `worldW`/`worldH` (zoom-independent) are
  // undefined for a selection that reached here via a code path predating
  // that field (a canvas iframe that hasn't remounted since); fall back to
  // `bounds` (the SCREEN rect — always populated, but wrong at any zoom other
  // than 100%) so the fields show SOMETHING rather than sit empty. Self-heals
  // to the exact value the moment `worldW`/`worldH` are present.
  const w = Number.isFinite(el.worldW)
    ? el.worldW
    : Number.isFinite(el.bounds?.w)
      ? el.bounds.w
      : null;
  const h = Number.isFinite(el.worldH)
    ? el.worldH
    : Number.isFinite(el.bounds?.h)
      ? el.bounds.h
      : null;
  const commitSize = (width, height) => {
    if (!artboardId) return;
    const nw = Number.isFinite(width) && width > 0 ? Math.round(width) : undefined;
    const nh = Number.isFinite(height) && height > 0 ? Math.round(height) : undefined;
    if (nw == null && nh == null) return;
    onResizeArtboard?.(artboardId, nw, nh);
  };
  const activePreset = Object.entries(SCREEN_PRESETS).find(
    ([, p]) => p.width === w && p.height === h
  )?.[0];
  // feature-3-web-artboards T2 — a web artboard hugs height (Design Decision
  // 1), so its `h` rarely equals a preset's device height even when the
  // artboard genuinely represents that breakpoint. Match by WIDTH alone so
  // the picker still shows "Desktop" selected after the hugged height
  // settles to the content's real size.
  const activeWidthPreset = Object.entries(SCREEN_PRESETS).find(([, p]) => p.width === w)?.[0];
  // Hug default (artboard "hug height") — current mode + the "more settings"
  // (background/padding/layout/gap) read off the SAME generic `attrs` escape
  // hatch dom-selection.ts already scrapes for every selection (the `data-dc-*`
  // attributes DCArtboard stamps on the frame purely for this panel to read
  // its own resolved props back — see canvas-lib.tsx readBackAttrs).
  const fixed = el.attrs?.['data-dc-fixed'] === 'true';
  const bg = el.attrs?.['data-dc-bg'] ?? '';
  const padding = el.attrs?.['data-dc-padding'] ?? '';
  const layoutMode = el.attrs?.['data-dc-layout'] ?? '';
  const gap = el.attrs?.['data-dc-gap'] ?? '';
  // T8 — `data-dc-kind` is DCArtboard's RESOLVED kind (readBackAttrs always
  // emits it, unlike the optional-override attrs above — see T1's comment on
  // why), so this reads 'digital' even for an implicit/unmigrated artboard.
  const kind = el.attrs?.['data-dc-kind'] || 'digital';
  // feature-2-print-artboards T2 — paper/orientation/bleed. Read-back mirrors
  // `data-dc-kind` above: a small JSON attr DCArtboard stamps for exactly this
  // panel (canvas-lib.tsx readBackAttrs), since `print` (unlike bg/padding/…)
  // is object-valued, not a scalar.
  let print = null;
  try {
    print = el.attrs?.['data-dc-print'] ? JSON.parse(el.attrs['data-dc-print']) : null;
  } catch {
    /* malformed attr — treat as absent */
  }
  const setKind = (nextKind) => {
    if (!artboardId) return;
    // Dogfood fix — switching TO "print" with no print prop yet left the
    // artboard half-configured (no guides geometry, no bleed for the PDF
    // exporter). Seed a default A4 print prop + its resolved px size in the
    // SAME gesture. Round 6: the seed is PASSED THROUGH the kind flow (not
    // written immediately) so the freeze-convert the canvas may enqueue first
    // lands BEFORE the A4 resize — resizing pre-freeze moved elements around
    // while the confirm dialog was still open.
    let seedPrint = null;
    if (nextKind === 'print' && !print) {
      const defaults = { paper: 'a4' };
      try {
        const resolved = resolvePrintArtboard(defaults);
        if (resolved) {
          seedPrint = { defaults, widthPx: resolved.widthPx, heightPx: resolved.heightPx };
        }
      } catch {
        /* keep null */
      }
    }
    // Picking "Digital" clears the explicit prop back to the implicit
    // default (applySetArtboardKind's `kind: null` path) rather than writing
    // a redundant `kind="digital"`.
    onSetArtboardKind?.(artboardId, nextKind === 'digital' ? null : nextKind, seedPrint);
    // feature-3-web-artboards Design Decision 1 — a web artboard's height
    // hugs content (`fixed` omitted); switching TO "web" flips hug mode in
    // the same gesture so the artboard doesn't stay pinned to whatever exact
    // height a prior digital/print size left it at. Mirrors the print
    // auto-seed above — switching kind should never require a second,
    // easy-to-miss step in the Hug/Fixed segmented control above.
    if (nextKind === 'web' && fixed) {
      onSetArtboardHug?.(artboardId, false, undefined);
    }
  };
  const setPrint = (patch) => {
    if (!artboardId) return;
    const next = { paper: 'a4', ...print, ...patch };
    let resolved;
    try {
      resolved = resolvePrintArtboard(next);
    } catch {
      return; // unknown paper id — ignore rather than write garbage
    }
    // Design Decision 2 — the picker writes BOTH the resolved px size (via
    // the existing resize lane, DDR-027) and the `print` intent prop, in the
    // same gesture, so geometry and intent never drift apart.
    onResizeArtboard?.(artboardId, resolved.widthPx, resolved.heightPx);
    onSetArtboardPrint?.(artboardId, next);
  };
  const setHug = (nextFixed, explicitHeight) => {
    if (!artboardId) return;
    const src = Number.isFinite(explicitHeight) ? explicitHeight : h;
    const freezeHeight = nextFixed && Number.isFinite(src) ? Math.round(src) : undefined;
    onSetArtboardHug?.(artboardId, nextFixed, freezeHeight);
  };
  const commitHeight = (n) => {
    const action = resolveHeightCommit(fixed, n);
    if (action.kind === 'resize') commitSize(null, action.height);
    else if (action.kind === 'promote-to-fixed') setHug(true, action.height);
  };
  const commitStyle = (patch) => {
    if (!artboardId) return;
    onSetArtboardStyle?.(artboardId, patch);
  };
  return (
    <section className="st-cp-sec">
      <div className="st-cp-sechd-row">
        <span className="st-cp-sechd">Artboard</span>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '4px 12px' }}>
        <NumberField
          value={w ?? 0}
          min={1}
          ariaLabel="artboard width"
          lead="W"
          steppers={false}
          onCommit={(n) => commitSize(n, null)}
        />
        <NumberField
          value={h ?? 0}
          min={1}
          ariaLabel="artboard height"
          lead="H"
          steppers={false}
          scrub={fixed}
          onCommit={commitHeight}
        />
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        {kind === 'print' ? (
          // Dogfood follow-up — a PRINT artboard's "Preset size…" dropdown
          // showed only the screen presets (Desktop/Laptop/Tablet/Mobile),
          // which are meaningless for paper. Show the paper ladder here
          // instead, writing through the SAME setPrint lane as the Print
          // section below (resolved px + print prop together).
          <select
            className="st-cp-nsel"
            aria-label="artboard paper preset"
            value={print?.paper ?? ''}
            onChange={(e) => setPrint({ paper: e.currentTarget.value })}
          >
            <option value="" disabled>
              Paper size…
            </option>
            {PAPER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.width}×{p.height}
                {p.unit}
              </option>
            ))}
          </select>
        ) : kind === 'web' ? (
          // feature-3-web-artboards T2 — a web artboard's "Preset size…"
          // dropdown reads as BREAKPOINT selection, not exact-box selection:
          // same SCREEN_PRESETS widths (Design Decision 2 — no separate
          // preset table needed), but commits width-only (height stays
          // hug-driven) and labels each option as the breakpoint it is.
          <select
            className="st-cp-nsel"
            aria-label="artboard breakpoint preset"
            value={activeWidthPreset ?? ''}
            onChange={(e) => {
              const p = SCREEN_PRESETS[e.currentTarget.value];
              if (p) commitSize(p.width, null);
            }}
          >
            <option value="" disabled>
              {activeWidthPreset
                ? `${SCREEN_PRESETS[activeWidthPreset].label} — ≤ ${SCREEN_PRESETS[activeWidthPreset].width}px`
                : 'Breakpoint…'}
            </option>
            {Object.entries(SCREEN_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label} — ≤ {p.width}px breakpoint
              </option>
            ))}
          </select>
        ) : (
          <select
            className="st-cp-nsel"
            aria-label="artboard size preset"
            value={activePreset ?? ''}
            onChange={(e) => {
              const p = SCREEN_PRESETS[e.currentTarget.value];
              if (p) commitSize(p.width, p.height);
            }}
          >
            <option value="" disabled>
              {activePreset ? SCREEN_PRESETS[activePreset].label : 'Preset size…'}
            </option>
            {Object.entries(SCREEN_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label} — {p.width}×{p.height}
              </option>
            ))}
          </select>
        )}
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <Segmented
          value={fixed ? 'fixed' : 'hug'}
          ariaLabel="artboard height sizing mode"
          options={[
            { value: 'hug', label: 'Hug' },
            { value: 'fixed', label: 'Fixed' },
          ]}
          onChange={(v) => setHug(v === 'fixed')}
        />
      </div>
      <div className="st-cp-sechd-row">
        <span className="st-cp-sechd">Kind</span>
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <Select
          value={kind}
          ariaLabel="artboard kind"
          options={ARTBOARD_KIND_OPTIONS.map(([value, label]) => ({ value, label }))}
          onChange={setKind}
        />
      </div>
      {kind !== 'print' && artboardId && onDuplicateArtboard ? (
        // feature-3-web-artboards T3 — "Duplicate at width…". A stateless
        // action trigger (not a size preset reflecting current state, unlike
        // the Preset-size select above), so the control resets to its
        // placeholder after firing rather than showing the last pick as
        // though it were now selected. Gated off kind="print" — paper size
        // is picked via the Artboard preset dropdown above, not a px width.
        <div style={{ padding: '0 12px 8px' }}>
          <select
            className="st-cp-nsel"
            aria-label="duplicate artboard at breakpoint width"
            value=""
            onChange={(e) => {
              const p = SCREEN_PRESETS[e.currentTarget.value];
              if (p) onDuplicateArtboard(artboardId, p.width);
              e.currentTarget.value = '';
            }}
          >
            <option value="" disabled>
              Duplicate at width…
            </option>
            {Object.entries(SCREEN_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label} — {p.width}px
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {kind === 'print' ? (
        <>
          <div className="st-cp-sechd-row">
            <span className="st-cp-sechd">Print</span>
          </div>
          {/* Paper picker lives in the Artboard section's own preset dropdown
              above (it REPLACES the screen presets for kind="print") — this
              section carries the print-specific residue: orientation + bleed. */}
          <div style={{ padding: '0 12px 8px' }}>
            <Segmented
              value={print?.orientation ?? 'portrait'}
              ariaLabel="paper orientation"
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              onChange={(v) => setPrint({ orientation: v })}
            />
          </div>
          <div style={{ padding: '0 12px 8px' }}>
            <NumberField
              value={Number.isFinite(print?.bleedMm) ? print.bleedMm : 3}
              min={0}
              step={0.5}
              ariaLabel="bleed, millimeters"
              // Single-glyph lead — the drag-handle slot is sized for 1–2
              // chars ("W"/"Pad"); a full word clips. mm suffix + aria carry
              // the meaning.
              lead="B"
              steppers={false}
              unitSlot={
                <span className="st-cp-numsuffix" aria-hidden="true">
                  mm
                </span>
              }
              onCommit={(n) => setPrint({ bleedMm: n })}
            />
          </div>
        </>
      ) : null}
      <div className="st-cp-sechd-row">
        <span className="st-cp-sechd">Style</span>
      </div>
      <div style={{ padding: '4px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(() => {
          // Bg — the CssKnobs `color()` recipe: TokenPopover swatch as the
          // flush prefix inside ColorField (HSV picker + per-DS variables).
          const bgResolved = resolveTokenValue(bg);
          const bgBound = /var\(\s*--/.test(bg);
          const bgDisplay = bgBound
            ? bg.replace(/^var\(\s*|\s*\)$/g, '').replace(/^--/, '').replace(/-/g, ' ')
            : bg;
          return (
            <ColorField
              swatch={
                <TokenPopover
                  kind="color"
                  swatchClassName="st-cp-cf-sw"
                  groups={tokenGroups('color')}
                  current={bg}
                  activeDs={_activeDs}
                  swatchBg={bgResolved}
                  seedHex={cssColorToHex(bgResolved) || '#000000'}
                  onPick={(v) => commitStyle({ background: v || null })}
                  label="artboard background colour"
                />
              }
              displayValue={bgDisplay}
              bound={bgBound}
              ariaLabel="artboard background"
              onValue={(v) => commitStyle({ background: (v || '').trim() || null })}
            />
          );
        })()}
        <Select
          value={layoutMode}
          ariaLabel="artboard body layout"
          options={ARTBOARD_LAYOUT_OPTIONS.map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(v) => commitStyle({ layout: v || null })}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <ValueTokenField
            value={/^var\(/.test(padding) ? padding : Number.parseFloat(padding) || 0}
            tokens={flatTokens('space')}
            ariaLabel="artboard padding"
            lead="Pad"
            min={0}
            onChange={(v) =>
              commitStyle({ padding: typeof v === 'string' ? v : v > 0 ? v : null })
            }
          />
          <ValueTokenField
            value={/^var\(/.test(gap) ? gap : Number.parseFloat(gap) || 0}
            tokens={flatTokens('space')}
            ariaLabel="artboard gap"
            lead="Gap"
            min={0}
            onChange={(v) => commitStyle({ gap: typeof v === 'string' ? v : v > 0 ? v : null })}
          />
        </div>
      </div>
    </section>
  );
}

// feature-photo-editor (Task 13/14) — derive the content-addressed photo asset a
// DOM selection points at (an artboard `<img src="assets/<sha8>.<ext>">`). Prefers
// the `photoAsset` the resolver stamped (dom-selection.ts), falling back to a scan
// of the selection's src/html for a selection that reached the panel via a code
// path predating that field. Returns null for a non-photo element.
const PHOTO_ASSET_RE = /assets\/[0-9a-f]{8}\.[a-z0-9]+/i;
// Simplifier fix (review fan-out, 2026-07-21) — reuse PHOTO_ASSET_RE's own
// source for the global-match variant instead of re-inlining the pattern, so
// the two can never drift apart (e.g. an extension-charset fix landing in one
// and not the other).
const PHOTO_ASSET_RE_G = new RegExp(PHOTO_ASSET_RE.source, 'gi');
function photoAssetOfSelection(el) {
  if (!el || Array.isArray(el)) return null;
  if (el.photoAsset) return el.photoAsset;
  const html = el.html || '';
  // feature-4 regression fix (2026-07-20) — the select tool's bare click now
  // picks the TOP-LEVEL container, so a photo selection often arrives as the
  // WRAPPER around the <img>, not the <img> itself. When the selection's
  // subtree contains EXACTLY ONE content-addressed image, offer the Photo tab
  // for it (ambiguous multi-photo containers stay photo-less — drill/⌘-click
  // to pick one).
  if ((el.tag || '').toLowerCase() !== 'img') {
    const imgs = [...new Set(html.match(PHOTO_ASSET_RE_G) || [])];
    const tagged = [...new Set([...html.matchAll(/data-photo-asset="([^"]+)"/g)].map((m) => m[1]))];
    if (tagged.length === 1) return tagged[0];
    if (tagged.length === 0 && imgs.length === 1 && /<img/i.test(html)) return imgs[0];
    return null;
  }
  // Once an edit is baked, the element's LIVE src is a `data:` URL (canvas-lib's
  // PhotoPreviewBridge swaps it in directly) — it never matches PHOTO_ASSET_RE,
  // so a REPLAYED/serialized selection (a WS resync, or the persisted
  // `_active.json` restored on boot) that arrives without the dedicated
  // `photoAsset` field would otherwise permanently lose the Photo tab for any
  // already-edited photo. The element still carries the `data-photo-asset` tag
  // the bridge stamped, and that DOES survive into an outerHTML snapshot — check
  // it before falling back to the plain assets/<sha8> src scan.
  const tagged = /data-photo-asset="([^"]+)"/.exec(html);
  if (tagged) return tagged[1];
  const m = PHOTO_ASSET_RE.exec(`${el.attrs?.src || ''} ${html}`);
  return m ? m[0] : null;
}

function InspectorPanel({
  /** E4 — `inspector-panel` / `layers-panel`, so one parity spec can assert
   *  both shells show them. Undefined elsewhere; the attribute simply absent. */
  testId,
  selected,
  onClose,
  layersTree,
  // feature-4 T7a — { [cdId]: { component, root, usages } } for purple rows.
  componentMap,
  // feature-4 T7b — locked layer keys (`"<id>:<index>"`) + toggle.
  lockedKeys,
  onToggleLock,
  // feature-4 detach-component — clone-definition detach for a shared instance.
  onDetachInstance,
  canvasFile,
  onSelectLayer,
  onHoverLayer,
  onReorderLayer,
  layersBusyRef,
  cfg,
  onOptimistic,
  onRecordEdit,
  onReplaceMedia,
  onResizeArtboard,
  onSetArtboardHug,
  onSetArtboardStyle,
  onSetArtboardKind,
  onSetArtboardPrint,
  onDuplicateArtboard,
  onUndoRedo,
  editScope,
  tab: tabProp,
  onTabChange,
  width,
  resizing,
  // feature-photo-editor (Task 13/15) — the Photo tab + its live-preview /
  // bg-removal / undo channels. `photoSel` is the annotation-image target
  // (threaded up separately since the annotation model has no DOM selection);
  // an artboard `<img>` target is derived from `selected` instead.
  photoSel,
  photoRev,
  onPhotoEdit,
  onPhotoRemoveBackground,
  onPhotoRecordEdit,
  onPhotoUndoRedo,
  // feature-configurable-panel-docking — when true this instance IS the standalone
  // Layers panel: it forces the Layers view and hides the tab bar (the tab strip
  // lives on the dock slot instead). `hideLayersTab` drops the inline Layers tab
  // when Layers has been split into its own panel.
  layersOnly = false,
  hideLayersTab = false,
  // DDR-171 — CSS-panel vocabulary mode ('advanced' | 'designer'), owned by App
  // (single source of truth shared with Settings → Appearance).
  cpMode,
  onSetCpMode,
}) {
  // Tab is controllable from the parent (the guided tour drives it to 'css' /
  // 'layers' so a spotlight step lands on a real row) but falls back to local
  // state for normal use. A user click both updates local state and notifies the
  // parent, so the two stay in lockstep whichever owns it.
  const [tabState, setTabState] = useState('inspect');
  const tab = layersOnly ? 'layers' : (tabProp ?? tabState);
  const setTab = (t) => {
    setTabState(t);
    onTabChange?.(t);
  };
  const [collapsed, setCollapsed] = useState(() => new Set());
  // Phase 12.3 (W3.1) — per-layer visibility toggle. Persists via /_api/edit-css
  // (property 'display', mirroring CssKnobs' commit/reset) and is undoable via
  // the same edit-source command (see the undo/redo coverage RCA:
  // .ai/logs/rca/issue-undo-redo-coverage-gaps.md). Keyed by `${id}:${index}`;
  // holds only OPTIMISTIC overrides (either direction) over the tree-reported
  // `node.hidden` (the authoritative source value) so a first render of an
  // already-hidden element shows the correct eye-icon state without a click.
  const [hiddenOverride, setHiddenOverride] = useState(() => new Map());
  // feature-4 T7 — auto-reveal the selected row: expand any collapsed ancestor
  // group + scroll it into view, so a canvas selection is never hidden behind a
  // collapsed wrapper (a Figma layers-panel expectation). Runs whenever the
  // selection or the (HMR-refreshed) tree changes.
  useEffect(() => {
    const sel = Array.isArray(selected) ? selected[0] : selected;
    const selId = sel?.id;
    if (!selId || !layersTree?.nodes) return;
    const selIdx = sel.index;
    let matchedKey = null;
    const ancestorKeys = [];
    (function find(nodes, trail) {
      for (const n of nodes || []) {
        const k = `${n.id}:${n.index}`;
        if (!n.synthetic && n.id === selId && (selIdx == null || n.index === selIdx)) {
          matchedKey = k;
          ancestorKeys.push(...trail);
          return true;
        }
        if (n.children && n.children.length && find(n.children, [...trail, k])) return true;
      }
      return false;
    })(layersTree.nodes, []);
    if (!matchedKey) return;
    if (ancestorKeys.length) {
      setCollapsed((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const k of ancestorKeys) if (next.delete(k)) changed = true;
        return changed ? next : prev;
      });
    }
    requestAnimationFrame(() => {
      try {
        document
          .querySelector(`.st-layer--row[data-layer-key="${matchedKey}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      } catch {
        /* selector edge case — non-fatal */
      }
    });
  }, [selected, layersTree]);
  const isNodeHidden = (node) => {
    const key = `${node.id}:${node.index}`;
    return hiddenOverride.has(key) ? hiddenOverride.get(key) : !!node.hidden;
  };
  // Phase 12.1 (DDR-138) — drag-to-reorder state (lifted so every row sees the
  // same drop target) + an aria-live announcement for keyboard moves.
  const [dragState, setDragState] = useState(null);
  const [reorderMsg, setReorderMsg] = useState('');
  // feature-4 T7c — Layers-panel rename: writes `data-dc-element` (the label's
  // top-priority source in `layerLabel`) via the existing /_api/edit-attr lane
  // + records undo through the same source-edit channel CssKnobs uses. The
  // HMR reload re-posts the tree with the new label.
  const renameLayer = (node, value) => {
    if (!canvasFile || !node?.id) return;
    fetch('/_api/edit-attr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: canvasFile, id: node.id, attr: 'data-dc-element', value }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!j.ok) return;
        onRecordEdit?.({
          op: 'attr',
          canvas: canvasFile,
          id: node.id,
          key: 'data-dc-element',
          before: node.dcElement ?? null,
          after: value,
        });
      })
      .catch(() => {});
  };
  const handleReorder = onReorderLayer
    ? (dragged, ref, position) => {
        // Gate keyboard + drop moves while a prior reorder is still landing — the
        // write churns positional ids, so acting on the stale tree would misfire.
        if (layersBusyRef?.current) return;
        // feature-4 T7 — a synthetic group row (unstamped wrapper) has no
        // data-cd-id to address in source, so it can be neither dragged nor a
        // drop target. Abort silently rather than post an unresolvable refId
        // that would optimistically move then revert (a visible flicker).
        if (dragged?.synthetic || ref?.synthetic) return;
        const verb =
          position === 'before'
            ? `before ${ref.label}`
            : position === 'after'
              ? `after ${ref.label}`
              : `into ${ref.label}`;
        setReorderMsg(`Moved ${dragged.label} ${verb}`);
        // Pass occurrence indices so a reused-component instance maps to its
        // parent <Component> usage server-side (same-id instances are distinct).
        onReorderLayer(dragged.id, ref.id, position, {
          idIndex: dragged.index,
          refIndex: ref.index,
        });
      }
    : undefined;
  // Flatten the VISIBLE tree (respecting collapse) with each node's depth,
  // parent, siblings, and index — the basis for keyboard nav + moves.
  const flattenVisibleLayers = () => {
    const flat = [];
    (function walk(nodes, depth, parentNode) {
      (nodes || []).forEach((n, i) => {
        flat.push({ node: n, depth, parentNode, siblings: nodes, pos: i });
        if (n.children && n.children.length && !collapsed.has(`${n.id}:${n.index}`))
          walk(n.children, depth + 1, n);
      });
    })(layersTree?.nodes, 0, null);
    return flat;
  };
  // The keyboard cursor is the SELECTED element (NOT DOM focus, which the HMR
  // re-render churns). ↑/↓ move the selection through the flattened tree;
  // Alt+↑/↓ reorder within the parent; Alt+Shift+↑/↓ reorder across the parent
  // boundary (out at first/last, into an adjacent open container). After a move
  // the reorder re-selects the moved element (movedId), so the cursor follows
  // and the next press keeps working — the fix for "Alt+arrow works once".
  const onTreeKeyDown = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!el) return;
    const flat = flattenVisibleLayers();
    const i = flat.findIndex((f) => f.node.id === el.id && f.node.index === el.index);
    if (i < 0) return;
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const cur = flat[i];
    if (!e.altKey) {
      const t = flat[i + dir];
      if (t) {
        e.preventDefault();
        onSelectLayer?.(t.node);
      }
      return;
    }
    if (!handleReorder || !Array.isArray(cur.siblings)) return;
    e.preventDefault();
    const expanded = (n) =>
      n && n.children && n.children.length && !collapsed.has(`${n.id}:${n.index}`);
    if (!e.shiftKey) {
      // Within-parent reorder; stop at the first/last sibling.
      if (dir < 0 && cur.pos > 0) handleReorder(cur.node, cur.siblings[cur.pos - 1], 'before');
      else if (dir > 0 && cur.pos < cur.siblings.length - 1)
        handleReorder(cur.node, cur.siblings[cur.pos + 1], 'after');
      return;
    }
    // Cross-parent reorder (flattened traversal).
    if (dir > 0) {
      const next = cur.siblings[cur.pos + 1];
      if (next) handleReorder(cur.node, next, expanded(next) ? 'inside-start' : 'after');
      else if (cur.parentNode) handleReorder(cur.node, cur.parentNode, 'after');
    } else {
      const prev = cur.siblings[cur.pos - 1];
      if (prev) handleReorder(cur.node, prev, expanded(prev) ? 'inside-end' : 'before');
      else if (cur.parentNode) handleReorder(cur.node, cur.parentNode, 'before');
    }
  };
  // Pointer-based drag-to-reorder in the Layers tree — same model as the
  // in-canvas drag: the row FLOATS with the cursor (transform, slot reserved), a
  // blue divider (or nest ring) marks the drop, and the move commits only on
  // release. Same-origin shell, so it's all local (no dgn bus).
  const layerDragRef = useRef(null);
  const layerTreeRef = useRef(null);
  const startLayerDrag = (e, node, key) => {
    if (!handleReorder || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (layersBusyRef?.current) return; // a prior reorder is still landing (ids churning)
    const startX = e.clientX;
    const startY = e.clientY;
    // Forbid dropping a node into itself or its own subtree.
    const forbidden = new Set([key]);
    (function walk(n) {
      (n.children || []).forEach((c) => {
        forbidden.add(`${c.id}:${c.index}`);
        walk(c);
      });
    })(node);
    // Flatten the VISIBLE tree (respecting collapse) with depth. The drop is
    // computed dnd-kit-tree style: a GAP between rows + a DEPTH from the pointer's
    // X — so you can nest into any container (even an empty one) and the divider
    // INDENTS to show it's going into that nested list (Figma-style).
    const INDENT = 14;
    const BASE = 6;
    const flat = [];
    (function walk(nodes, depth) {
      (nodes || []).forEach((n) => {
        const k = `${n.id}:${n.index}`;
        flat.push({ node: n, key: k, id: n.id, depth, tag: n.tag });
        if (n.children && n.children.length && !collapsed.has(k)) walk(n.children, depth + 1);
      });
    })(layersTree?.nodes, 0);
    const flatByKey = new Map(flat.map((it) => [it.key, it]));
    let started = false;
    const onMove = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        started = true;
      }
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let target = null;
      // Visible rows in DOM (== flat) order, minus the dragged one (its rect is
      // floated, so it's meaningless for gap math).
      const rows = [].slice
        .call(document.querySelectorAll('.st-layer--row[data-layer-key]'))
        .map((el) => ({ rect: el.getBoundingClientRect(), it: flatByKey.get(el.getAttribute('data-layer-key')) }))
        .filter((r) => r.it && r.it.key !== key);
      if (rows.length) {
        const rowLeft = rows[0].rect.left;
        const rowRight = rows[0].rect.right;
        // Gap = index of the first row whose vertical midpoint is below the pointer.
        let gap = rows.length;
        for (let i = 0; i < rows.length; i++) {
          if (ev.clientY < rows[i].rect.top + rows[i].rect.height / 2) {
            gap = i;
            break;
          }
        }
        const prev = rows[gap - 1]?.it || null;
        const nextIt = rows[gap]?.it || null;
        // Depth from pointer X. Clamp between the row below (min) and one level
        // under the row above (max, if it can hold children).
        const raw = Math.round((ev.clientX - rowLeft - BASE) / INDENT);
        const maxDepth = prev ? prev.depth + (LAYER_VOID_TAGS.has(prev.tag) ? 0 : 1) : 0;
        const minDepth = nextIt ? nextIt.depth : 0;
        const depth = Math.max(minDepth, Math.min(raw, maxDepth));
        // Resolve (prev, depth) → { refId, position, refNode, targetDepth }.
        let refIt = null;
        let position = 'before';
        let targetDepth = 0;
        if (!prev) {
          if (nextIt) {
            refIt = nextIt;
            position = 'before';
            targetDepth = nextIt.depth;
          }
        } else if (depth > prev.depth) {
          refIt = prev; // nest as prev's FIRST child
          position = 'inside-start';
          targetDepth = prev.depth + 1;
        } else if (depth === prev.depth) {
          refIt = prev;
          position = 'after';
          targetDepth = prev.depth;
        } else {
          for (let i = gap - 1; i >= 0; i--) {
            if (rows[i].it.depth === depth) {
              refIt = rows[i].it;
              break;
            }
          }
          if (!refIt) refIt = prev;
          position = 'after';
          targetDepth = depth;
        }
        // Guard: no self, no dragged-subtree, no repeated (list) target.
        // forbidden already holds the dragged node's own key + its subtree, so a
        // different INSTANCE of the same reused component (same id, other key) is
        // still a valid target.
        if (refIt && refIt.key !== key && !forbidden.has(refIt.key)) {
          const y = prev ? rows[gap - 1].rect.bottom : rows[0].rect.top;
          const left = rowLeft + BASE + targetDepth * INDENT;
          target = { refId: refIt.id, position, node: refIt.node, y, left, w: Math.max(24, rowRight - left) };
        }
      }
      const next = { key, node, dx, dy, target };
      layerDragRef.current = next;
      setDragState(next);
    };
    const teardown = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
    // Swallow the click that trails a drag so it doesn't also select a row.
    const suppressClick = () => {
      const sup = (ce) => {
        ce.preventDefault();
        ce.stopImmediatePropagation();
        document.removeEventListener('click', sup, true);
      };
      document.addEventListener('click', sup, true);
      setTimeout(() => document.removeEventListener('click', sup, true), 300);
    };
    const onUp = () => {
      teardown();
      const d = layerDragRef.current;
      layerDragRef.current = null;
      setDragState(null);
      if (started && d?.target) {
        suppressClick();
        handleReorder(d.node, d.target.node, d.target.position);
      }
    };
    // Esc — abort the drag: the row snaps back, nothing commits.
    const onKey = (ke) => {
      if (ke.key !== 'Escape') return;
      ke.preventDefault();
      ke.stopImmediatePropagation();
      teardown();
      layerDragRef.current = null;
      setDragState(null);
      if (started) suppressClick();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  };
  const toggleCollapse = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleVisibility = (node) => {
    const key = `${node.id}:${node.index}`;
    const wasHidden = isNodeHidden(node);
    const willHide = !wasHidden;
    setHiddenOverride((prev) => new Map(prev).set(key, willHide));
    onOptimistic?.({
      id: node.id,
      artboardId: layersTree?.artboardId ?? null,
      index: node.index,
      prop: 'display',
      value: willHide ? 'none' : null,
    });
    if (!canvasFile || !node.id) return;
    fetch('/_api/edit-css', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        willHide
          ? { canvas: canvasFile, id: node.id, property: 'display', value: 'none' }
          : { canvas: canvasFile, id: node.id, property: 'display', reset: true }
      ),
    }).catch(() => {});
    // Record onto the canvas undo stack (Cmd+Z), same as any other inline CSS
    // edit — fire-and-forget alongside the POST above, mirroring CssKnobs'
    // commit()/reset() (which don't gate the record on the fetch resolving).
    onRecordEdit?.({
      op: 'css',
      canvas: canvasFile,
      id: node.id,
      key: 'display',
      before: wasHidden ? 'none' : null,
      after: willHide ? 'none' : null,
    });
  };
  // `selected` may be a single element, an array (multi-select), or null.
  const el = Array.isArray(selected) ? selected[0] : selected;
  // feature-photo-editor (Task 13) — resolve the Photo-tab target. Priority: an
  // annotation-image threaded up (`photoSel`, no DOM selection) → a Photo-ONLY
  // panel; else a content-addressed artboard `<img>` selection → Photo alongside
  // the normal tabs.
  const photoTarget = photoSel
    ? { asset: photoSel.asset, kind: 'annotation-image' }
    : (() => {
        const a = photoAssetOfSelection(el);
        return a ? { asset: a, kind: 'artboard-img' } : null;
      })();
  const photoOnly = photoTarget?.kind === 'annotation-image';
  // Cmd+Z / Cmd+Shift+Z (or Cmd+Y) while focus is still inside a Photo-tab
  // slider — mirrors `onKnobKeyDown` above for the same reason: the window-
  // level shortcut listener bails out whenever `document.activeElement` is an
  // `<input>` (native text-undo would otherwise win), so a commit-then-Cmd+Z
  // with the slider still focused needs its own forwarder here.
  const onPhotoKnobKeyDown = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      onPhotoUndoRedo?.(e.shiftKey ? 'redo' : 'undo');
    } else if (k === 'y') {
      e.preventDefault();
      onPhotoUndoRedo?.('redo');
    }
  };
  // An annotation-image has no element tabs; force Photo. Otherwise honor the
  // requested tab, but drop off a stale 'photo' tab when the new selection isn't
  // photo-eligible (so switching from a photo to a normal element lands sanely).
  const effTab = photoOnly ? 'photo' : tab === 'photo' && !photoTarget ? 'inspect' : tab;
  const tabBtn = (id, label, icon) => (
    <button
      type="button"
      className={'st-rp-tab' + (effTab === id ? ' is-active' : '')}
      onClick={() => setTab(id)}
    >
      <StIcon name={icon} size={14} />
      {label}
    </button>
  );
  const b = el?.bounds || null;
  return (
    <aside
      className={'st-rpanel' + (resizing ? ' is-resizing' : '')}
      style={width ? { width, flexBasis: width } : undefined}
      aria-label="Inspector"
      data-tour="inspector"
      data-testid={testId}
    >
      <div
        className="st-rp-tabs"
        data-tour="inspector-tabs"
        style={layersOnly ? { display: 'none' } : undefined}
      >
        {photoOnly ? (
          tabBtn('photo', 'Photo', 'image')
        ) : (
          <>
            {tabBtn('inspect', 'Inspect', 'sliders')}
            {!hideLayersTab && tabBtn('layers', 'Layers', 'layers')}
            {tabBtn('css', 'CSS', 'code')}
            {photoTarget ? tabBtn('photo', 'Photo', 'image') : null}
          </>
        )}
        <button
          type="button"
          className="st-iconbtn"
          aria-label="Close inspector"
          style={{ marginLeft: 'auto' }}
          onClick={onClose}
        >
          <StIcon name="x" size={14} />
        </button>
      </div>
      {/* Stage H (INV-3) — edit-scope strip: is an edit local to this element or
          shared across N rendered places? Visible across every tab so it's never
          a surprise. Only for a single element selection with a resolved verdict. */}
      {el?.id && !(Array.isArray(selected) && selected.length > 1) && editScope ? (
        <div
          className={`st-scope st-scope--${editScope.scope}`}
          title={
            editScope.scope === 'shared'
              ? `Editing this element's style changes ${editScope.affects} place${
                  editScope.affects === 1 ? '' : 's'
                }${
                  editScope.componentName ? ` (component ${editScope.componentName})` : ''
                }. Move/resize a whole instance to keep it local.`
              : 'This edit affects only this element.'
          }
        >
          <span className="st-scope-dot" aria-hidden="true" />
          {editScope.scope === 'shared'
            ? `Shared${editScope.componentName ? ` · ${editScope.componentName}` : ''} · edits ${
                editScope.affects
              } place${editScope.affects === 1 ? '' : 's'}`
            : 'Local · this element only'}
          {/* feature-4 detach-component (2026-07-19) — make THIS instance its
              own single-usage component so edits (incl. absolute positions)
              stay local per artboard. */}
          {editScope.scope === 'shared' && onDetachInstance ? (
            <button
              type="button"
              className="st-scope-detach"
              title="Clone this component for this instance only — edits stop affecting the other places"
              onClick={() => onDetachInstance(el.id, el.index)}
            >
              Detach
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="st-rp-body">
        {effTab === 'photo' && photoTarget ? (
          <div onKeyDown={onPhotoKnobKeyDown}>
            <PhotoKnobs
              key={`${photoTarget.asset}:${photoRev ?? 0}`}
              asset={photoTarget.asset}
              ColorPicker={ColorPicker}
              StIcon={StIcon}
              onEdit={(edit) => onPhotoEdit?.(photoTarget.asset, edit)}
              onRemoveBackground={onPhotoRemoveBackground}
              onRecordEdit={(before, after) => onPhotoRecordEdit?.(photoTarget.asset, before, after)}
            />
          </div>
        ) : !el && !(effTab === 'layers' && layersTree?.nodes?.length) ? (
          <div className="st-rp-empty">
            {/* <p> wrapper — st-rp-empty is a flex column, bare text nodes +
                kbd would stack as stretched flex items. */}
            <p>
              Press <Kbd>V</Kbd>, then click an element to select it — or <Kbd>⌘</Kbd>-click
              straight from Browse.
            </p>
          </div>
        ) : el && effTab === 'inspect' ? (
          <>
            <div className="st-rp-hd">{el.selector || el.tag || 'element'}</div>
            <div className="st-insp-row">
              <span className="st-insp-label">Pos</span>
              <div className="st-insp-fields">
                <span className="st-fmini">
                  <span className="st-mtag">X</span>
                  <input value={b ? Math.round(b.x) : '—'} readOnly aria-label="x position" />
                </span>
                <span className="st-fmini">
                  <span className="st-mtag">Y</span>
                  <input value={b ? Math.round(b.y) : '—'} readOnly aria-label="y position" />
                </span>
              </div>
            </div>
            <div className="st-insp-row">
              <span className="st-insp-label">Size</span>
              <div className="st-insp-fields">
                <span className="st-fmini">
                  <span className="st-mtag">W</span>
                  <input value={b ? Math.round(b.w) : '—'} readOnly aria-label="width" />
                </span>
                <span className="st-fmini">
                  <span className="st-mtag">H</span>
                  <input value={b ? Math.round(b.h) : '—'} readOnly aria-label="height" />
                </span>
              </div>
            </div>
            <div className="st-insp-row">
              <span className="st-insp-label">Tag</span>
              <div className="st-insp-fields">
                <span className="st-mono" style={{ fontSize: 11, color: 'var(--fg-0)' }}>
                  {el.tag || '—'}
                </span>
              </div>
            </div>
            {el.classes ? (
              <div className="st-insp-row">
                <span className="st-insp-label">Class</span>
                <div className="st-insp-fields">
                  <span className="st-mono" style={{ fontSize: 11, color: 'var(--fg-1)' }}>
                    {el.classes}
                  </span>
                </div>
              </div>
            ) : null}
            <InspectComputed el={el} />
          </>
        ) : effTab === 'layers' ? (
          <>
            <div className="st-rp-hd">Layers{layersTree?.nodes?.length ? '' : ' · ancestry'}</div>
            {layersTree?.nodes?.length ? (
              <>
                {handleReorder ? (
                  <div className="st-rp-hint" aria-hidden="true">
                    Drag or ↑/↓ select · Alt+↑/↓ move · Alt+Shift+↑/↓ move across
                  </div>
                ) : null}
                {/* Keyboard nav/move handled at the container (tabIndex=0), driven
                    by the SELECTION not row focus — survives the HMR re-render. */}
                <div
                  role="tree"
                  aria-label="Artboard layers"
                  tabIndex={0}
                  ref={layerTreeRef}
                  onKeyDown={onTreeKeyDown}
                >
                  {layersTree.nodes.map((n, ni) => (
                    <LayerRow
                      key={`${n.id}:${n.index}`}
                      node={n}
                      depth={0}
                      selectedId={el?.id}
                      selectedIndex={el?.index}
                      collapsed={collapsed}
                      hiddenOverride={hiddenOverride}
                      onToggle={toggleCollapse}
                      onSelect={(node) => {
                        onSelectLayer?.(node);
                        layerTreeRef.current?.focus();
                      }}
                      onHover={(node) => onHoverLayer?.(node)}
                      onToggleVisibility={toggleVisibility}
                      onReorder={handleReorder}
                      onRowPointerDown={startLayerDrag}
                      dragState={dragState}
                      componentMap={componentMap}
                      lockedKeys={lockedKeys}
                      onToggleLock={onToggleLock}
                      onRename={renameLayer}
                    />
                  ))}
                </div>
                {dragState?.target ? (
                  <div
                    className="st-layer-divider"
                    aria-hidden="true"
                    style={{
                      left: dragState.target.left,
                      top: dragState.target.y - 1,
                      width: dragState.target.w,
                    }}
                  />
                ) : null}
                <div className="sr-only" role="status" aria-live="polite">
                  {reorderMsg}
                </div>
              </>
            ) : el && Array.isArray(el.dom_path) && el.dom_path.length ? (
              el.dom_path.map((node, i) => (
                <div
                  key={i}
                  className={'st-layer' + (i === el.dom_path.length - 1 ? ' is-sel' : '')}
                  style={{ paddingLeft: 8 + i * 12 }}
                >
                  <StIcon name="square" size={13} />
                  {node}
                </div>
              ))
            ) : (
              <div className="st-rp-empty">
                Select an element (⌘-click in the canvas) to see its layer tree.
              </div>
            )}
          </>
        ) : !el.id && resolveArtboardIdFromSelection(el) ? (
          <ArtboardKnobs
            el={el}
            cfg={cfg}
            onResizeArtboard={onResizeArtboard}
            onSetArtboardHug={onSetArtboardHug}
            onSetArtboardStyle={onSetArtboardStyle}
            onSetArtboardKind={onSetArtboardKind}
            onSetArtboardPrint={onSetArtboardPrint}
            onDuplicateArtboard={onDuplicateArtboard}
          />
        ) : (
          <CssKnobs
            el={el}
            cfg={cfg}
            onOptimistic={onOptimistic}
            onRecordEdit={onRecordEdit}
            onReplaceMedia={onReplaceMedia}
            onUndoRedo={onUndoRedo}
            mode={cpMode}
            onSetMode={onSetCpMode}
          />
        )}
      </div>
    </aside>
  );
}

// ---------- App ----------

function App() {
  const [groups, setGroups] = useState([]);
  const [project, setProject] = useState('Design');
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState(null);
  // feature-studio-file-preview — deliberately separate from `tabs`/
  // `activePath`: a previewed file was never a canvas, so it must never
  // trigger the WS `active`/`tabs` broadcasts, the compile-skeleton loading
  // state, or iframe registration that openTab()/openSystem() drive.
  const [previewPath, setPreviewPath] = useState(null);
  const onPreview = useCallback((path) => {
    setPreviewPath(path);
  }, []);
  const [selected, setSelected] = useState(null);
  // Phase 12.3 — latest selection, readable from the (stale-closure) onMessage
  // handler so an HMR reload (triggered by a CSS/attr edit) can re-select the
  // same element and restore the in-canvas halo the remount dropped.
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Stage H (INV-3) — resolve the edit-scope (local vs shared component instance)
  // for the current single selection so the Inspector can show whether an edit
  // stays here or changes N places. Read-only GET, debounced by the selection id;
  // aborts a stale in-flight fetch when the selection changes. Fetched with
  // rendered=1 (source-usage-driven; the .map() refinement is a follow-up).
  const [editScope, setEditScope] = useState(null);
  useEffect(() => {
    const one = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
    const id = one && typeof one.id === 'string' ? one.id : null;
    if (!id || !activePath) {
      setEditScope(null);
      return;
    }
    const ac = new AbortController();
    const q = new URLSearchParams({ canvas: activePath, id });
    fetch(`/_api/edit-scope?${q}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) setEditScope(j);
      })
      .catch(() => {
        /* aborted / offline — leave the last verdict, the badge just won't show */
      });
    return () => ac.abort();
  }, [selected, activePath]);
  // feature-acp-context-hardening — halo re-apply retry ladder. A single
  // select-by-id post races the fresh iframe: dgn:'loaded' fires from the
  // inline inspector script at HTML-parse time, BEFORE the React canvas-shell
  // mounts its message listener (module fetch + mount takes 100ms–seconds), so
  // a one-shot post silently evaporates and the restored selection never gets
  // its halo back. Re-post on a fixed ladder; each attempt aborts when the
  // user meanwhile selected something else. select-by-id is idempotent
  // (replace-same → select-set echo → ws guard sees same id → no re-schedule),
  // so the ladder can't loop.
  // feature-4 dogfood fix — timestamp of the last LOCAL selection change sent
  // over WS. The ws 'selected' broadcast is both (a) our own echo and (b) a
  // genuine cross-canvas restore; within this window it's always (a) and must
  // not overwrite fresher local state (multi-select / drill races).
  const lastLocalSelectAtRef = useRef(0);
  const haloRestoreTimersRef = useRef([]);
  const scheduleHaloRestore = useCallback((one) => {
    if (!one?.id || !one.file) return;
    for (const t of haloRestoreTimersRef.current) clearTimeout(t);
    haloRestoreTimersRef.current = [50, 450, 1200, 2500, 5000].map((delay) =>
      setTimeout(() => {
        const cur = selectedRef.current;
        const c1 = Array.isArray(cur) ? cur[0] : cur;
        if (!c1 || c1.id !== one.id || c1.file !== one.file) return; // superseded
        const frame = iframesRef.current.get(one.file);
        if (!frame?.contentWindow) return;
        try {
          frame.contentWindow.postMessage(
            {
              dgn: 'select-by-id',
              id: one.id,
              artboardId: one.artboardId ?? null,
              index: one.index ?? 0,
            },
            '*'
          );
        } catch {}
      }, delay)
    );
  }, []);
  // Dogfood follow-up — the ArtboardKnobs panel (Kind/Print/Style/Hug/W-H)
  // writes via structuralWrite, which never refreshed the Inspector's OWN
  // `attrs` snapshot afterward: the artboard itself re-rendered correctly
  // (new kind, new size) but the Inspector kept showing the PRE-edit values
  // (e.g. "Digital" right after picking "Print") until the user manually
  // re-clicked the artboard. Mirrors scheduleHaloRestore's retry ladder
  // (the HMR reload lands async, so a single immediate post races it) but
  // for a bare ARTBOARD selection (no data-cd-id to key off of — compares
  // by artboardId instead of id).
  const artboardResyncTimersRef = useRef([]);
  const scheduleArtboardResync = useCallback((artboardId, file) => {
    if (!artboardId || !file) return;
    for (const t of artboardResyncTimersRef.current) clearTimeout(t);
    artboardResyncTimersRef.current = [50, 450, 1200, 2500, 5000].map((delay) =>
      setTimeout(() => {
        const cur = selectedRef.current;
        const c1 = Array.isArray(cur) ? cur[0] : cur;
        if (!c1 || c1.artboardId !== artboardId || c1.file !== file) return; // superseded
        const frame = iframesRef.current.get(file);
        if (!frame?.contentWindow) return;
        try {
          frame.contentWindow.postMessage({ dgn: 'select-by-id', artboardId }, '*');
        } catch {}
      }, delay)
    );
  }, []);
  // Phase 12.1 (DDR-138) — after a reorder writes source, the HMR reload remounts
  // the canvas and the positional data-cd-id of the moved element (and everything
  // after it) renumbers. Stash the re-settle target { file, movedId, artboardId }
  // so the dgn:'loaded' handler re-selects the moved element by its NEW id.
  const pendingReorderRef = useRef(null);
  // Latest `reorderLayer` (defined far below), read from the stale-closure
  // onMessage handler when the in-canvas grip posts dgn:'reorder-request'
  // (same freshness idiom as selectedRef; avoids a render-time TDZ on the
  // later useCallback).
  const reorderLayerRef = useRef(null);
  // Same freshness idiom for `repositionElement` (defined far below), read
  // when the in-canvas drag posts dgn:'reposition-request' — the coordinate-
  // mode commit for out-of-flow (position:absolute/fixed) elements.
  const repositionElementRef = useRef(null);
  // feature-element-editing-robustness Stage D — sibling ref for `resizeElement`
  // (defined far below), read when the in-canvas resize overlay posts
  // dgn:'resize-request' on pointer-up. Same origin-split as reposition.
  const resizeElementRef = useRef(null);
  // Phase 12.1 — true between a layers-panel reorder and the fresh layers-tree
  // landing. A reorder churns positional data-cd-ids, so a rapid 2nd drag would
  // target stale ids; the Layers tree gates new drags on this until the rebuilt
  // tree (with correct ids) arrives. Cleared by the layers-tree message.
  const layersBusyRef = useRef(false);
  const layersBusyTimerRef = useRef(null);
  // Phase 12 Task 4 — Layers tree for the active artboard (posted by canvas-shell).
  const [layersTree, setLayersTree] = useState(null);
  // feature-4 T7a — Layers-panel component map ({ [cdId]: { component, root,
  // usages } }) for purple instance rows. Fetched from the read-only main-origin
  // /_api/component-map on canvas/tree changes, throttled: the map only changes
  // when SOURCE changes, but the tree re-posts on any DOM churn (drag reflows) —
  // don't re-parse the canvas for those.
  const [componentMap, setComponentMap] = useState(null);
  const componentMapAtRef = useRef({ canvas: null, at: 0 });
  useEffect(() => {
    if (!activePath || !layersTree) return;
    const now = Date.now();
    const last = componentMapAtRef.current;
    if (last.canvas === activePath && now - last.at < 1500) return;
    componentMapAtRef.current = { canvas: activePath, at: now };
    fetch(`/_api/component-map?canvas=${encodeURIComponent(activePath)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && j.map && typeof j.map === 'object') setComponentMap(j.map);
        else setComponentMap(null);
      })
      .catch(() => setComponentMap(null));
  }, [activePath, layersTree]);
  const [wsConnected, setWsConnected] = useState(false);
  // Phase 8 Task 7 — git lifecycle reload prompt. Server has already flushed
  // every dirty Y.Doc to disk by the time this state populates, so accepting
  // the reload is data-loss-safe (DDR-051 §3).
  const [gitLifecycle, setGitLifecycle] = useState(null);
  // Phase 9 Task 8 — hub-down offline mode banner. Driven by the 'sync:status'
  // WS message the linked-mode sync runtime emits. null in solo mode.
  const [syncStatus, setSyncStatus] = useState(null);
  // feature-large-project-seed — the NATIVE half of seed progress.
  //
  // A seed against a large project is minutes to hours of work, and the target
  // user (DDR-177) never opens a terminal. The Sync panel is the detail view;
  // this is what reaches them when the panel is not on screen: the window
  // title while it runs, and ONE notification per phase transition.
  //
  // Per TRANSITION, never per file. A 2 961-file seed must produce two
  // notifications, not 2 961 — `send_notification` throttles on the Rust side
  // too, but a client that leans on that is a client that would spam a plain
  // browser tab through the Web fallback.
  const seedPhaseRef = useRef(null);
  useEffect(() => {
    const p = syncStatus?.files?.progress;
    if (!p) return;
    const prev = seedPhaseRef.current;
    seedPhaseRef.current = p.phase;
    if (prev === null || prev === p.phase) return;
    if (p.phase === 'converged' && (prev === 'seeding' || prev === 'paused')) {
      notifyDesktop('Project synced', `${p.delivered} files are up to date.`);
    } else if (p.phase === 'blocked') {
      const total = (p.blocked ?? []).reduce((n, b) => n + b.count, 0);
      notifyDesktop(
        'Sync needs a decision',
        `${total} file${total === 1 ? '' : 's'} could not be sent. Open the Sync panel for the reason.`
      );
    }
  }, [syncStatus?.files?.progress]);
  // The title carries the count while a seed runs, and is restored afterwards —
  // it is the one surface visible without opening anything.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const p = syncStatus?.files?.progress;
    const base = document.title.replace(/\s+—\s+syncing\s+\d+\/\d+$/, '');
    if (p && (p.phase === 'seeding' || p.phase === 'paused') && p.tracked > 0) {
      document.title = `${base} — syncing ${p.delivered}/${p.tracked}`;
    } else {
      document.title = base;
    }
    return undefined;
  }, [syncStatus?.files?.progress]);
  // DDR-218 — the folder's cloud link ({url, credentialed} | null), lifted from
  // CloudBar (status resolve / attach / detach). Gates the GitPanel's
  // cloud-managed posture; linked-but-uncredentialed keeps the full panel.
  const [cloudLinkedHub, setCloudLinkedHub] = useState(null);
  // Phase 27 (E2) — in-UI git layer. `gitStatus` is the live dirty-state the
  // server broadcasts on `git-status`; `changesOpen` toggles the Changes panel;
  // `diffTarget` opens the before/after DiffView ({ file, conflict }).
  const [gitStatus, setGitStatus] = useState(null);
  // Phase 28 (E3) — remote ahead/behind ("Get latest" nudge). Kept in its OWN
  // slice, NOT folded into `gitStatus`, because the `git-status` WS broadcast
  // (line ~5791) replaces `gitStatus` on every dirty-state change and carries
  // only LOCAL status — merging remote-ahead into it would be clobbered on the
  // next keystroke. The probe is a real network `git fetch` (server-side, token
  // from the keychain bridge), so it runs on a slow cadence — mount, a periodic
  // tick, and after each git action — never on the per-edit WS path.
  const [remoteSync, setRemoteSync] = useState(null); // { remoteAhead, behind } | null
  const [changesOpen, setChangesOpen] = useState(false);
  // feature-sync-progress-modal — the per-file Sync panel; toggled from the
  // status-bar HUB SYNC chip. Only available while `syncStatus` is non-null
  // (a linked project), mirroring how `changes` gates on `gitStatus.repo`.
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [diffTarget, setDiffTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [systemData, setSystemData] = useState(null);
  // Canvas-compile skeleton (single-canvas model → one path at a time).
  const [loadingPath, setLoadingPath] = useState(null);
  const loadFallbackTimer = useRef(null);
  // issue #115 — a canvas that never reported `loaded`. `{ path, kind }`, where
  // kind is 'server' (the canvas origin did not answer /_health — a dead or
  // respawned sidecar) or 'compile' (the origin is up, the canvas itself never
  // mounted). Rendered instead of the blank pane the cap used to leave behind.
  const [canvasError, setCanvasError] = useState(null);
  // Bumped by the error panel's Retry. Folded into the iframe `key` so a retry
  // REMOUNTS the frame — re-setting `src` to the identical URL would not
  // re-navigate, and after a respawn the URL is identical in every case except
  // the port that `loadServerConfig()` is about to correct.
  const [canvasReloadNonce, setCanvasReloadNonce] = useState(0);
  // The canvas whose SHELL DOCUMENT has actually loaded, per its `dgn:'loaded'`
  // post. Distinct from `!loadingPath`, which the 2.5 s onLoad fallback and the
  // 15 s cap also clear — this one only ever means "the shell ran". That makes
  // it the honest signal for `data-canvas-state` below, and the one the #115 E2E
  // scenario asserts: the shell's inline script posts it whether or not the
  // canvas TSX went on to build, so it isolates "the origin was reachable" from
  // "the canvas compiled" — exactly the axis #115 is about.
  const [loadedPath, setLoadedPath] = useState(null);
  // Resizable side panels (DS components-resize-panels) + the active drag side.
  const sbSize = usePanelSize('maude-sb-w', { min: 200, max: 420, def: 252 });
  const rpSize = usePanelSize('maude-rp-w', { min: 260, max: 480, def: 304 });
  const [dragSide, setDragSide] = useState(null); // 'sb' | 'rp' | null
  const bodyRef = useRef(null);

  // Pointer drag for the panel grips — window listeners while dragging (the
  // grip also pointer-captures, and `.st-body.is-resizing iframe` drops pointer
  // events so the canvas iframe can't swallow the move stream mid-drag).
  useEffect(() => {
    if (!dragSide) return;
    const onMove = (e) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (dragSide === 'sb') sbSize.setW(e.clientX - rect.left);
      else rpSize.setW(rect.right - e.clientX);
    };
    const onUp = () => setDragSide(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragSide, sbSize.setW, rpSize.setW]);

  // Loading-skeleton lifecycle: dgn:'loaded' clears it instantly (TSX canvases);
  // the iframe load event arms a short fallback for legacy .html canvases that
  // never post it; a hard cap guards against a canvas that dies mid-compile.
  const onIframeLoad = useCallback((path) => {
    clearTimeout(loadFallbackTimer.current);
    loadFallbackTimer.current = setTimeout(() => {
      setLoadingPath((p) => (p === path ? null : p));
    }, 2500);
  }, []);
  // Loaded at boot from /_config and re-fetched on the server's
  // `config-updated` push (config.json hot-reload — /design:setup-ds rewrites
  // it mid-session) — informs canvasUrl() so TSX iframes can pass the right
  // ?designRel + ?tokens query to the canvas mount shell.
  // `cloud` is deliberately TRI-STATE, and the third state is the useful one:
  //   undefined — `/_config` has not answered yet; which shell this is is
  //               UNKNOWN, and anything that would behave differently in the
  //               two shells must wait rather than assume the desktop.
  //   null      — desktop or plain local browser.
  //   object    — a cloud tab (`{ dashboardUrl?, projectName, user, role }`).
  //
  // Collapsing unknown into "not cloud" is what made the cloud studio open with
  // two console 404s every time: the sign-in bar and the export centre mounted
  // for one frame, each fired the request its shell exists to refuse, and then
  // unmounted. Nothing was broken and everything looked broken.
  const [cfg, setCfg] = useState({ designRel: '.design', cloud: undefined });
  // THE CAP MUST NOT CLEAR TO WHITE — issue #115. This used to be a bare
  // `setLoadingPath(null)`, which is the most useless thing it could do: when
  // the canvas origin is unreachable the shell HTML never loads, so the shell's
  // own `#canvas-mount-error` surface (templates/_shell.html) does not exist to
  // report anything, and dropping the skeleton left a blank pane with no error,
  // no reason and no way back inside the app. Probe the canvas origin to tell
  // the two failures apart — a dead server (the #115 stale-origin case, and any
  // sidecar crash) versus a canvas that genuinely never finished compiling —
  // and hand the user the recovery in both cases.
  //
  // DECLARED AFTER `cfg`, ON PURPOSE — the same rule the block below states for
  // the git flags, and this effect is what taught us it is not decorative. Its
  // dependency array reads `cfg?.canvasOrigin`, and A DEPENDENCY ARRAY IS
  // EVALUATED DURING RENDER: sitting above the `useState` above, it hit `cfg` in
  // its temporal dead zone, so `App` threw `Cannot access 'cfg' before
  // initialization` on its very first render and the WHOLE STUDIO mounted
  // nothing — a white page for every user, not only the desktop shell the fix
  // was written for. It reached the branch because the PR carried a merge
  // conflict, which stops GitHub from building a merge ref, which means the
  // client-boot gate never ran on it (issue #112 close-out).
  useEffect(() => {
    if (!loadingPath) return;
    const path = loadingPath;
    const cap = setTimeout(async () => {
      let kind = 'compile';
      try {
        const r = await fetch(`${cfg?.canvasOrigin || ''}/_health`, {
          cache: 'no-store',
        });
        if (!r.ok) kind = 'server';
      } catch {
        kind = 'server';
      }
      setCanvasError({ path, kind });
      setLoadingPath((p) => (p === path ? null : p));
    }, 15000);
    return () => clearTimeout(cap);
  }, [loadingPath, cfg?.canvasOrigin]);
  // WHO IS SAVING THIS PROJECT — one expression, read by every surface that
  // would otherwise offer to save it, poll for it, or badge it (DDR-218, widened
  // by feature-cloud-managed-git-posture).
  //
  // These two flags were previously derived at the GitPanel call site alone, so
  // the panel withdrew correctly while the toolbar menu and the status-bar chip
  // kept rendering a raw dirty count from `gitStatus.files.length` — the very
  // "lie about work that is already saved" the withdrawal exists to delete. The
  // count is the claim, wherever it is drawn; hoisting the rule here is what
  // keeps a third surface from re-introducing it.
  //
  // DECLARED HERE, AT THE TOP, ON PURPOSE. Every local-git POLL below is gated
  // on it, and a dependency array evaluates during render — a `const` further
  // down would be in its temporal dead zone at the first `useEffect` that names
  // it. The same hazard the remote-sync effect's own comment records.
  //
  // PRESENTATION, NOT A CONTROL — unchanged from DDR-218. `.git` is untouched:
  // no hook is installed, no config is written, a terminal `git status` /
  // `git commit` behaves exactly as before, the local `/_api/git/*` routes keep
  // exactly their old gates, and `git/watch.ts` still flushes a terminal
  // `git checkout` into Yjs (DDR-051). What stops is MAUDE's own local git
  // activity — the polls and the surfaces that describe a repo nobody is
  // editing through. Disconnect restores every one of them live.
  const cellManaged = !!cfg.cloud;
  const cloudManaged = !cfg.cloud && !!cloudLinkedHub?.credentialed;
  const savingIsManaged = cellManaged || cloudManaged;
  // The raw truth stays available for surfaces that legitimately need it (the
  // panel's own file list); only the COUNT — the thing that reads as a to-do —
  // is withheld when this project's saving is somebody else's job.
  const unsavedCount = savingIsManaged ? 0 : gitStatus?.files?.length || 0;
  // The posture, readable from callbacks that must NOT re-subscribe when it
  // flips: the WS handler is installed once for the socket's lifetime, and the
  // two git-status refreshers are `useCallback([])`s a dozen call sites depend
  // on being stable. A ref is how they read a live value without becoming a
  // reason to tear the socket down.
  const savingIsManagedRef = useRef(savingIsManaged);
  savingIsManagedRef.current = savingIsManaged;
  // Cloud Phase 25 C2 — viewer role, known at boot from /_config. Every
  // editing affordance in the shell gates on this (absent, not hidden).
  const viewerMode = !!cfg.readOnly;
  const loadServerConfig = useCallback(() => {
    fetch('/_config')
      .then((r) => r.json())
      .then((data) => {
        const designRel = (data.designRoot || '.design').replace(/^\/+|\/+$/g, '');
        // Functional merge — the `/_config` and `/_index-data` fetches race, and
        // the latter contributes `canvasDesignSystems` (DDR-093). A full-replace
        // here would clobber that map if it resolved second.
        setCfg((prev) => ({
          ...prev,
          designRel,
          tokensCssRel: data.tokensCssRel,
          // Pass through designSystems so canvasUrl can resolve the right
          // tokens/components paths per-DS. Top-level tokensCssRel is the
          // legacy default; designSystems[0].tokensCssRel is the project's
          // authoritative value (post DS-bootstrap).
          designSystems: data.designSystems,
          // T2 (9.1-A) — segregated canvas-content origin. canvasUrl() prepends
          // it so iframes load cross-origin (hub-pushed JSX is then walled off
          // from the main origin's /_api). Absent on older servers → relative
          // URL fallback keeps same-origin behavior.
          canvasOrigin: data.canvasOrigin,
          // Cloud Phase 25 C2 — the linked hub vouched a `viewer` role at
          // sign-in. Known at BOOT (before anything draws), so editing
          // affordances are ABSENT rather than shown-then-refused. This flag
          // decides what the UI offers; the cell (C1) and the dev-server's
          // read-only gate (http.ts) are what actually stop a write.
          readOnly: !!data.readOnly,
          // Cloud Phase 27 (DDR-209) — the capability that opens the cookieless
          // canvas origin. `canvasUrl()` appends it to every iframe URL. Absent
          // on a desktop, where the canvas origin is loopback and needs none.
          //
          // NOTE FOR WHOEVER ADDS THE NEXT FIELD: this is an explicit
          // projection, not a spread of `data`. A field the server starts
          // returning does NOT arrive here until it is named — which is how
          // both of these went missing and the cloud studio rendered without
          // its chrome and with every canvas iframe unauthenticated.
          canvasToken: data.canvasToken,
          // Which release this server is — rendered as the status-bar chip.
          // Undefined on a server too old to report it, which is why the chip
          // renders conditionally rather than printing `vundefined`.
          version: data.version,
          // C2/C4 — `{ dashboardUrl?, projectName, user, role }` when this is a
          // cloud tab. Its presence is what tells the shared client it is in a
          // browser tab on somebody else's machine; `user`/`role` are what let
          // it say WHICH account that tab is, and offer the way out.
          cloud: data.cloud ?? null,
          // feature-cloud-export-render-workers — `local` | `remote` | `none`.
          // Which export formats this server can actually produce; the export
          // dialogs gate on it. Absent on older servers → undefined, treated
          // as `local` (the pre-lane behavior) everywhere it is read.
          exportLane: data.exportLane,
        }));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadServerConfig();
  }, [loadServerConfig]);
  // Backfill the sync banner on mount from /_sync-status. The 'sync:status' WS
  // broadcast is one-shot for the zero-syncable case (DDR-060 / 9.1-D), so a
  // tab that connects after boot would otherwise miss it. {linked:false} (solo)
  // leaves the banner null.
  useEffect(() => {
    let cancelled = false;
    fetch('/_sync-status')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data || data.linked === false) return;
        setSyncStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Phase 27 (E2) — seed the git dirty-state on mount; live updates arrive over
  // the `git-status` WS broadcast (Task 5). Solo/non-git projects → repo:false.
  //
  // NOT WHILE SOMEBODY ELSE IS COMMITTING. In cloud-managed posture this asks
  // about a repo the user is not editing through, and every answer it brings
  // back is drawn somewhere as a claim about their work. Reactive on
  // `savingIsManaged`, not mount-only, so Disconnect resumes it live and
  // Connect stops it live — the requirement `git-cloud-posture.test.ts`
  // already pins for the panel.
  useEffect(() => {
    if (savingIsManaged) {
      // Drop what the local repo last said, too. A stale `gitStatus` left
      // standing keeps the tree's M/A/D badges lit after the posture changed.
      setGitStatus(null);
      return undefined;
    }
    let cancelled = false;
    fetch('/_api/git/status')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data) setGitStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savingIsManaged]);
  const [commentsByFile, setCommentsByFile] = useState({}); // { file: [Comment] }
  // Phase 6 — the in-iframe composer owns drafting; the shell no longer holds
  // a `draft` state. Mutations route through postMessage → WS instead.
  const [focusedCommentId, setFocusedCommentId] = useState(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [commentsFilter, setCommentsFilter] = useState('open'); // 'all' | 'open' | 'resolved'
  const [theme, setTheme] = useState(readInitialTheme);
  // DDR-171 — CSS-panel vocabulary mode ('advanced' | 'designer'), App-owned so
  // the in-panel corner toggle (CssKnobs) and Settings → Appearance share one
  // source of truth; persisted to `maude-cp-mode` (same pattern as `theme`).
  const [cpMode, setCpMode] = useState(() => {
    const m = readJsonStore(CP_MODE_STORE, 'advanced');
    return m === 'designer' ? 'designer' : 'advanced';
  });
  useEffect(() => {
    try {
      localStorage.setItem(CP_MODE_STORE, JSON.stringify(cpMode));
    } catch {}
  }, [cpMode]);
  const [openMenu, setOpenMenu] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => readBoolStore(SIDEBAR_STORE, true));
  const [showHidden, setShowHidden] = useState(() => readBoolStore(SHOW_HIDDEN_STORE, false));
  const [sectionsExpanded, setSectionsExpanded] = useState(() => readJsonStore(SECTIONS_STORE, {}));
  const [helpOpen, setHelpOpen] = useState(false);
  const [reportBugOpen, setReportBugOpen] = useState(false);

  // Native Help ▸ Report a Bug… (menu.rs emits `menu://report-bug`) — same
  // lane as IdentityBar's File ▸ New Project… subscription.
  useEffect(() => {
    if (!isNativeApp()) return;
    const p = onMenuReportBug(() => setReportBugOpen(true));
    return () => {
      p.then((un) => un()).catch(() => {});
    };
  }, []);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [brandUploadOpen, setBrandUploadOpen] = useState(false);
  const [figmaImportOpen, setFigmaImportOpen] = useState(false);
  // DDR-166 plan, Phase 2 (T7) — the persistent "Setup" affordance in the empty
  // canvas state (below) only renders while the project's own setup (design
  // system / first canvas / brand assets) is incomplete; native-only concern.
  const { report: setupReadiness } = useSetupReadiness(isNativeApp());
  // ? cheat-sheet (DS components-shortcuts-overlay) — separate from the deep
  // Help modal (F1), which keeps commands & flows.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // T5/T6 (Plan C) — shell-level export/handoff dialog + inspector panel state.
  // The palette (T4) drives them; the dialog (T5) + panel (T6) consume them.
  const [exportDialog, setExportDialog] = useState(null); // null | { mode: 'export'|'handoff', scope? }
  // feature-ai-media-generation (DDR-16x) — BYOK provider-key Settings modal +
  // the AI generate action.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // feature-configurable-panel-docking — Layers as its own openable panel (when
  // layersMode==='separate'), plus the per-panel side map + layers mode. All
  // three hydrate from disk (/_api/ui-prefs) on mount and persist on change,
  // mirroring the view-pref pattern.
  const [layersOpen, setLayersOpen] = useState(false);
  const [panelSide, setPanelSide] = useState(() =>
    readJsonStore(PANEL_SIDES_STORE, PANEL_SIDES_DEFAULTS)
  );
  const [layersMode, setLayersMode] = useState(() => {
    try {
      const v = localStorage.getItem(LAYERS_MODE_STORE);
      if (v === 'separate' || v === 'in-inspector') return v;
    } catch {}
    return 'separate';
  });
  // DDR-148 — Timeline panel (right dock) for scrubbing a video-comp. `activeComps`
  // is populated from the iframe's `timeline-comps` announce; `timelineFrame` from
  // its live `timeline-frame`. Empty comps ⇒ the panel shows its empty state.
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [activeComps, setActiveComps] = useState([]);
  const [timelineFrame, setTimelineFrame] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  // Default off — looping is an explicit opt-in per session, not a surprise
  // once the user presses Play (rca/issue-video-artboard-loop-defaults-on).
  const [timelineLoop, setTimelineLoop] = useState(false);
  const [timelineMuted, setTimelineMuted] = useState(false);
  const [timelineVolume, setTimelineVolume] = useState(1);
  const [timelineHeight, setTimelineHeight] = useState(216);
  // The artboard nearest the viewport centre (reported by canvas-lib on pan) —
  // the Timeline follows THIS, so it redraws as you move across the canvas.
  const [canvasActiveArtboard, setCanvasActiveArtboard] = useState(null);
  // DDR-148 — parsed sequence/keyframe rows for the Timeline (from raw .tsx).
  const [timelineSequences, setTimelineSequences] = useState([]);
  const [timelineAudio, setTimelineAudio] = useState([]);
  // Task 5 — seam transitions between series beats ({ afterIndex, dur }).
  const [timelineTransitions, setTimelineTransitions] = useState([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  // rca/issue-video-artboard-frame-reset-on-edit — last known playhead, read
  // from the `timeline-comps` handler below (which fires on every comp
  // (re)mount, incl. a ⌘R hard iframe reload) to re-seed the fresh Player
  // instance. A ref, not state, so the handler always sees the latest value
  // without pulling `timelineFrame` into that big message-listener's deps.
  const timelineFrameRef = useRef(0);
  useEffect(() => {
    timelineFrameRef.current = timelineFrame;
  }, [timelineFrame]);
  // The DCArtboard id the timeline scoped to (from parseCompTimeline). Used for
  // /_api/comp-clips + every clip op so the enumerator targets the SAME comp the
  // rows came from — `timelineCompId` is the Player's `videocomp-N` id, which
  // never matches a DCArtboard id and made the enumerator fall back to the wrong
  // comp on a multi-comp canvas (the showreel badge/replace/op mis-scope).
  const [timelineArtboardId, setTimelineArtboardId] = useState(null);
  const timelineArtboardIdRef = useRef(null);
  useEffect(() => {
    timelineArtboardIdRef.current = timelineArtboardId;
  }, [timelineArtboardId]);
  // On a multi-comp canvas the Timeline drives ONE comp: the one mounted in the
  // artboard whose rows the panel is drawing. Resolved by artboard identity
  // (announced by video-comp.tsx), NOT by duration — two comps of equal length
  // made the old duration match return the first artboard's Player, so scrub +
  // playback moved a comp the user wasn't even looking at (issue #75).
  const timelineCompId = useMemo(
    () =>
      resolveCompTarget(activeComps, {
        // Both signals, in confidence order: the artboard the ROW PARSER scoped
        // to (lexical, from the .tsx) then the viewport-active one canvas-lib
        // reports on pan (structural). See resolveCompTarget — when the two
        // disagree, the one that names a comp actually mounted there wins.
        artboardId: [timelineArtboardId, canvasActiveArtboard],
        total: timelineTotal,
      }),
    [activeComps, timelineArtboardId, canvasActiveArtboard, timelineTotal]
  );
  const timelineCompIdRef = useRef(null);
  useEffect(() => {
    timelineCompIdRef.current = timelineCompId;
  }, [timelineCompId]);
  // Frame math (drop position, split, overlay insert) must use the timebase of
  // the comp the Timeline is actually on — `activeComps[0].fps` silently used
  // the first artboard's (issue #75).
  const timelineFps = useMemo(
    () => activeComp(activeComps, timelineCompId)?.fps || 30,
    [activeComps, timelineCompId]
  );
  // feature-enhanced-video-editing (Task 3) — the timeline's single-select model.
  // Holds the selected clip's stableId (NOT a row index — DDR-150), so the
  // selection survives comp-clips refetches, reorders, and external file edits.
  const [timelineSelectedClip, setTimelineSelectedClip] = useState(null);
  // Task 8 — bumped after a concurrent-edit refusal so the source + comp-clips
  // effects refetch ("Timeline changed — reloaded, try again").
  const [timelineRefresh, setTimelineRefresh] = useState(0);
  const timelineOpFailed = useCallback((prefix, msg) => {
    if (/concurrent edit|changed since it was read/i.test(msg || '')) {
      shellToast('Timeline changed — reloaded, try again.');
      setTimelineRefresh((n) => n + 1);
    } else {
      shellToast(`${prefix}: ${msg || 'failed'}`);
    }
  }, []);
  // Phase 31 (DDR-123) — the native ACP chat sidepanel (right dock, native-only).
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantUnseen, setAssistantUnseen] = useState(false);
  const assistantOpenRef = useRef(assistantOpen);
  useEffect(() => {
    assistantOpenRef.current = assistantOpen;
    if (assistantOpen) {
      setAssistantUnseen(false); // opening clears the unseen badge
      // Ask for notification permission on a real user gesture (panel open).
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      } catch {
        /* notifications unavailable */
      }
    }
  }, [assistantOpen]);
  // ChatPanel owns one connection PER CHAT (so chats run in parallel in the
  // background) and reports up here: `onBusyChange` for the menubar pulse, and
  // `onFinished` when any chat's turn ends — badge + notify if you weren't looking.
  const handleAssistantFinished = useCallback(() => {
    if (!assistantOpenRef.current || document.hidden) {
      setAssistantUnseen(true);
      notifyDesktop('Claude finished', 'Your assistant turn is ready in Maude.');
    }
  }, []);
  // DDR-185 — same "you weren't looking" gate as handleAssistantFinished
  // above, fired instead when a chat is PAUSED waiting on the user (a
  // permission prompt or an AskUserQuestion/elicitation form), not just when
  // a turn completes. A stalled turn otherwise gives no signal at all if the
  // window isn't focused. Distinct copy so it doesn't read as "done".
  //
  // Security-review addendum (Finding G): DDR-179/180 already cap concurrent
  // pending requests at 10 permissions + 5 elicitations, so a single
  // adversarial turn can legitimately queue up to 15 DISTINCT approval
  // decisions — each one now fires a real OS Notification, which is exactly
  // the burst that manufactures the "rapid Enter-mashing" precondition
  // DDR-179's own addendum already treats as a security-relevant habituation
  // risk. The in-app badge (setAssistantUnseen) still reflects EVERY new
  // request instantly — only the OS notification itself is rate-limited, so
  // a burst reads as one attention-getting ping, not fifteen.
  const lastAttentionNotifyRef = useRef(0);
  const handleAssistantAttention = useCallback(() => {
    if (!assistantOpenRef.current || document.hidden) {
      setAssistantUnseen(true);
      const now = Date.now();
      if (now - lastAttentionNotifyRef.current < ATTENTION_NOTIFY_COOLDOWN_MS) return;
      lastAttentionNotifyRef.current = now;
      notifyDesktop('Maude needs your input', 'Claude is waiting on an approval or a question in Maude.');
    }
  }, []);
  // Inspector tab is lifted so View ▸ Layers can open the panel ON the Layers
  // tab (the menu item sat disabled as "Phase 12" long after the tab shipped).
  const [inspectorTab, setInspectorTab] = useState('inspect');
  // feature-photo-editor (Task 13) — the annotation-image Photo-tab target,
  // threaded up from the annotation layer's "Edit Photo…" (the annotation model
  // has no DOM selection to ride, unlike an artboard `<img>`). `{ asset, strokeId }`
  // or null. Cleared whenever a normal DOM selection arrives so the two never
  // fight over the panel. The shell-side photo undo stack lives alongside it.
  const [photoSel, setPhotoSel] = useState(null);
  const photoUndoRef = useRef({ undo: [], redo: [] });
  // Bumped by the Cmd+Z/Cmd+Shift+Z photo-undo handler below so the mounted
  // PhotoKnobs (keyed on `asset:photoRev`) remounts and re-fetches the sidecar
  // it just PUT, instead of drifting from its own stale local `edit` state.
  const [photoRev, setPhotoRev] = useState(0);
  // feature-element-editing-robustness Stage C — auto-open the Inspector on the
  // CSS tab when a fresh single selection arrives AND no right panel is already
  // open. Preference-backed (default ON); disable it in the View menu. Refs keep
  // the postMessage selection listener stale-closure-safe.
  const [autoOpenInspector, setAutoOpenInspector] = useState(() => {
    try {
      return localStorage.getItem('maude-auto-open-inspector') !== '0';
    } catch {
      return true;
    }
  });
  const autoOpenInspectorRef = useRef(autoOpenInspector);
  useEffect(() => {
    autoOpenInspectorRef.current = autoOpenInspector;
    try {
      localStorage.setItem('maude-auto-open-inspector', autoOpenInspector ? '1' : '0');
    } catch {
      /* private mode / storage disabled */
    }
  }, [autoOpenInspector]);
  // Whether ANY right-dock panel is open — the auto-open guard reads this ref so
  // it never steals focus from an already-open panel (the user's explicit rule).
  const anyRightPanelOpenRef = useRef(false);
  useEffect(() => {
    anyRightPanelOpenRef.current =
      inspectorOpen || commentsPanelOpen || changesOpen || syncPanelOpen || assistantOpen;
  }, [inspectorOpen, commentsPanelOpen, changesOpen, syncPanelOpen, assistantOpen]);
  // The right dock holds exactly ONE panel (Changes / Inspector / Comments) at
  // a time — opening any panel REPLACES whatever was there. These two helpers
  // are the single source of that invariant; every open/toggle path routes
  // through them. (Before, the three booleans were flipped independently across
  // ~13 call sites and only some closed their siblings, so a panel opened via a
  // path that left a sibling `true` rendered *behind* it under the fixed
  // precedence — looking like the new panel "overlapped" the old one.)
  // feature-configurable-panel-docking — generic, SIDE-AWARE panel management.
  // A slot (left/right) shows one panel at a time, so opening a panel closes any
  // OTHER open panel ON THE SAME SIDE (panels on the other side are independent).
  // A live ref carries the current open + side maps so the callbacks stay stable
  // yet never act on stale state. (The Timeline is a BOTTOM dock, DDR-148, and is
  // NOT part of either slot's mutual-exclusion.)
  const panelStateRef = useRef({ open: {}, side: PANEL_SIDES_DEFAULTS });
  panelStateRef.current = {
    open: {
      tree: sidebarOpen,
      layers: layersOpen,
      inspector: inspectorOpen,
      comments: commentsPanelOpen,
      changes: changesOpen,
      sync: syncPanelOpen,
      assistant: assistantOpen,
    },
    side: panelSide,
  };
  const setPanelOpen = useCallback((id, val) => {
    if (id === 'tree') setSidebarOpen(val);
    else if (id === 'layers') setLayersOpen(val);
    else if (id === 'inspector') setInspectorOpen(val);
    else if (id === 'comments') setCommentsPanelOpen(val);
    else if (id === 'changes') setChangesOpen(val);
    else if (id === 'sync') setSyncPanelOpen(val);
    else if (id === 'assistant') setAssistantOpen(val);
  }, []);
  const sideOf = useCallback(
    (id) => panelStateRef.current.side?.[id] || PANEL_SIDES_DEFAULTS[id],
    []
  );
  const openPanelExclusive = useCallback(
    (id) => {
      const side = sideOf(id);
      setPanelOpen(id, true);
      for (const p of DOCK_PANELS) {
        if (p.id !== id && sideOf(p.id) === side) setPanelOpen(p.id, false);
      }
    },
    [setPanelOpen, sideOf]
  );
  const togglePanel = useCallback(
    (id) => {
      if (panelStateRef.current.open?.[id]) setPanelOpen(id, false);
      else openPanelExclusive(id);
    },
    [openPanelExclusive, setPanelOpen]
  );
  // Legacy name kept for the many call sites; now side-aware (opens `which` and
  // closes only same-side siblings, so a panel moved to the left is unaffected).
  const openRightPanel = openPanelExclusive;
  const toggleRightPanel = togglePanel;
  // feature-element-editing-robustness Stage C (Task C1) — open the Inspector on
  // the CSS tab for a fresh SINGLE selection, but only when nothing is already
  // docked on the right (never override an open Layers/Inspect/Comments panel)
  // and only when the preference is on. Idempotent: once the inspector is open,
  // the `anyRightPanelOpen` guard stops it re-firing on the next selection.
  const maybeAutoOpenInspectorOnSelect = useCallback(
    (sel) => {
      if (!autoOpenInspectorRef.current) return;
      if (viewerMode) return; // Cloud Phase 25 C2 — inspector is edit chrome
      if (!sel || !sel.id) return; // need a stable element id to inspect
      if (anyRightPanelOpenRef.current) return; // don't steal from an open panel
      openRightPanel('inspector');
      setInspectorTab('css');
    },
    [openRightPanel, viewerMode]
  );
  // DDR-148 — the Timeline is a BOTTOM dock, independent of the right rail: it
  // toggles on its own and coexists with Inspector/Changes/Comments/Chat.
  const toggleTimeline = useCallback(() => setTimelineOpen((v) => !v), []);
  const whatsNew = useWhatsNew(MDCC_VERSION);
  // Same tri-state rule as the sign-in bar: hydrating before the shell is
  // known 404s every boot. On desktop (`cloud === null`) the export queue is
  // the LOCAL job runner, always on. In a cloud tab it hydrates only when the
  // cell actually holds a jobs lane (`exportLane === 'remote'`) — a cell
  // without a render service still refuses `/_api/export-jobs` outright
  // (DDR-209 D1 posture, now lane-scoped by feature-cloud-export-render-workers).
  const exportCenter = useExportCenter({
    enabled: cfg.cloud === null || cfg.exportLane === 'remote',
  });
  // Phase 29 (E4) — first-run onboarding wizard. The native shell boots a minimal
  // "welcome" project on first launch; we ask it whether this is a first run and, if
  // so, show the wizard OVER the (empty) canvas browser. Completing any door switches
  // the sidecar to a real project (the webview reloads → first-run is then false).
  const [firstRun, setFirstRun] = useState(false);
  // Offer the collab "rychlý kurz" once, AFTER onboarding (native app, not first run,
  // not yet seen). A returning user who already took it isn't re-nudged.
  const [collabNudge, setCollabNudge] = useState(false);
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let alive = true;
    appIsFirstRun()
      .then((v) => {
        if (!alive) return;
        setFirstRun(!!v);
        if (!v && !readBoolStore(COLLAB_TOUR_STORE, false)) setCollabNudge(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const markCollabSeen = useCallback(() => {
    setCollabNudge(false);
    try {
      localStorage.setItem(COLLAB_TOUR_STORE, '1');
    } catch {}
  }, []);
  // Phase 32 (Task 1) — auto-update. The native shell downloads + stages a newer
  // build in the background and emits `update-ready`; we surface a non-blocking
  // banner. Native-only (the web studio is updated by its own deploy).
  const [updateReady, setUpdateReady] = useState(null);
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let un;
    onUpdateReady((p) => setUpdateReady(p && typeof p === 'object' ? p : {}))
      .then((fn) => {
        un = fn;
      })
      .catch(() => {});
    return () => {
      try {
        un?.();
      } catch {}
    };
  }, []);
  const [tourSteps, setTourSteps] = useState(null);
  const [usageNudge, setUsageNudge] = useState(() => !readBoolStore(USAGE_TOUR_STORE, false));
  const startTour = useCallback((steps) => {
    setTourSteps(Array.isArray(steps) && steps.length ? steps : null);
  }, []);
  // Guided-tour bus — the overlay calls setup() before each step to put the shell
  // into the state the step spotlights: open a canvas, open the Inspector, switch
  // its tab. The canvas iframe is cross-origin (DDR-054) so the tour can't select
  // an element for the user; requireSelection steps instead wait for a real
  // ⌘-click. Plain object (the overlay refs it), so per-render churn is harmless.
  const tourBus = {
    setup: (step) => {
      if (!step) return;
      if ((step.canvas || step.requireSelection) && tabs.length === 0) {
        openPanelExclusive('tree');
        setTimeout(() => {
          try {
            document.querySelector('.st-sidebar [role="treeitem"]')?.click();
          } catch {}
        }, 80);
      }
      if (step.inspector || step.tab || step.requireSelection) openRightPanel('inspector');
      if (step.tab) setInspectorTab(step.tab);
      // Phase 29 (E4) collab tour — open the Changes panel so the Save / Publish /
      // Get-latest controls the action steps spotlight actually exist to anchor on.
      if (step.changes) openRightPanel('changes');
    },
  };
  const markUsageSeen = useCallback(() => {
    setUsageNudge(false);
    try {
      localStorage.setItem(USAGE_TOUR_STORE, '1');
    } catch {}
  }, []);
  const [annotationsVisible, setAnnotationsVisible] = useState(() =>
    readBoolStore(ANNOT_STORE, true)
  );
  // feature-unified-settings-modal — gate the disk-write effect until the boot
  // GET /_api/ui-prefs has reconciled (disk-wins), so we never clobber a stored
  // pref with the localStorage/default value on the first render.
  const [uiPrefsHydrated, setUiPrefsHydrated] = useState(false);
  // Canvas-chrome visibility (View menu). minimap + zoom-controls are
  // persistent prefs broadcast to every open canvas iframe; presentMode is a
  // non-destructive "hide ALL chrome + shell, artboards only" overlay with an
  // Esc / floating-pill escape hatch back to the chrome.
  const [minimapVisible, setMinimapVisible] = useState(() => readBoolStore(MINIMAP_STORE, false));
  const [zoomCtlVisible, setZoomCtlVisible] = useState(() => readBoolStore(ZOOMCTL_STORE, false));
  const [presentMode, setPresentMode] = useState(false);
  // feature-2-print-artboards T3 — "Show print guides". Per-CANVAS persisted
  // (view.json `overlays.print`, via /_api/canvas-meta), not a global
  // localStorage pref like minimap/zoomctl — mirrors the foundation's
  // `overlays.guides` lane. Re-read whenever the active canvas changes (see
  // the activeArtboards effect below); sent only to the active iframe.
  const [printGuidesVisible, setPrintGuidesVisible] = useState(false);
  // P2/P3 (Plan C) — top-bar live state. (Zoom lives in the canvas toolbar pill,
  // so the top bar no longer mirrors it.)
  //   activeArtboards — real artboard count of the open canvas, read from its
  //                   `<canvas>.meta.json` sidecar (shell-side, no iframe dep).
  //   gitUser       — local user (name/initials) for the menubar presence avatar.
  //   agentActive   — transient flag set on `ai-activity`, cleared after idle, so
  //                   the menubar shows a live agent avatar while Claude edits.
  const [activeArtboards, setActiveArtboards] = useState(0);
  const [gitUser, setGitUser] = useState(null);
  const [agentActive, setAgentActive] = useState(false);
  const agentIdleRef = useRef(null);
  const wsRef = useRef(null);
  const iframesRef = useRef(new Map());

  // Phase 5.1 — postMessage bridge from menubar dropdowns to the canvas iframe.
  // The canvas-shell listens for these `dgn:*` messages and dispatches into the
  // matching local provider (annotations visibility / both selection stores /
  // tool mode). Mirrors the existing `force-clear` / `select-clear` channel.
  const postToActiveCanvas = useCallback(
    (payload) => {
      const el = activePath ? iframesRef.current.get(activePath) : null;
      if (!el || !el.contentWindow) return;
      try {
        el.contentWindow.postMessage(payload, '*');
      } catch {}
    },
    [activePath]
  );

  // DDR-231 (hybrid export lanes) — ask the active canvas iframe to capture
  // its own artboards (canvas-lib's useExportCaptureBridge) and hand back the
  // blobs. The shell can't reach the cross-origin canvas DOM, and the sandbox
  // omits allow-downloads, so this is the division of labour: the CANVAS
  // captures (it renders the pixels), the SHELL downloads. Resolves with
  // [{ name, type, blob }]; rejects on canvas error or timeout.
  const browserCaptureSeq = useRef(0);
  const captureFromCanvas = useCallback(
    ({ format, artboardIds = null, scale = 1, onProgress, timeoutMs = 120_000 }) =>
      new Promise((resolve, reject) => {
        const el = activePath ? iframesRef.current.get(activePath) : null;
        if (!el || !el.contentWindow) {
          reject(new Error('no active canvas to capture'));
          return;
        }
        const cw = el.contentWindow;
        browserCaptureSeq.current += 1;
        const id = `cap-${Date.now().toString(36)}-${browserCaptureSeq.current}`;
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMsg);
          clearTimeout(timer);
          fn(arg);
        };
        const onMsg = (e) => {
          // Only answers from the iframe we asked — a message with a matching
          // id from any other window is ignored.
          if (e.source !== cw) return;
          const m = e.data;
          if (!m || m.id !== id) return;
          if (m.dgn === 'export-capture-progress') onProgress?.(m.current, m.total);
          else if (m.dgn === 'export-capture-done')
            finish(resolve, Array.isArray(m.items) ? m.items : []);
          else if (m.dgn === 'export-capture-error')
            finish(reject, new Error(m.message || 'capture failed'));
        };
        const timer = setTimeout(
          () => finish(reject, new Error('capture timed out — the canvas did not answer')),
          timeoutMs
        );
        window.addEventListener('message', onMsg);
        try {
          cw.postMessage({ dgn: 'export-capture', id, format, artboardIds, scale }, '*');
        } catch (err) {
          finish(reject, err);
        }
      }),
    [activePath]
  );

  // ── feature-photo-editor — the Photo tab's three channels ─────────────────
  // (1) live preview: broadcast the edit DOWN to the active canvas iframe, whose
  //     canvas-lib `PhotoPreviewBridge` bakes the composite and swaps it directly
  //     into the matching `<img>`/`<image>` element's src/href (iteration 2 — see
  //     the bridge's own header comment for why it's a direct swap, not an
  //     overlay). (2) undo: a shell-side stack (photo edits are sidecar writes,
  //     not the canvas-side source-edit stack). (3) background removal: the
  //     client-side @imgly ML flow (Task 12).
  const onPhotoEdit = useCallback(
    (asset, edit) => postToActiveCanvas({ dgn: 'photo-preview', asset, edit }),
    [postToActiveCanvas]
  );
  const onPhotoRecordEdit = useCallback((asset, before, after) => {
    photoUndoRef.current.undo.push({ asset, before, after });
    photoUndoRef.current.redo.length = 0;
  }, []);
  // Pops the shell-side photo-undo stack, re-persists the reverted edit through
  // the same PUT route PhotoKnobs itself uses, re-broadcasts it to the live
  // preview, and bumps `photoRev` so the mounted PhotoKnobs (keyed on
  // `asset:photoRev`) remounts and re-fetches instead of drifting from its own
  // stale local state. Returns false (does nothing) when the requested stack is
  // empty, so callers can fall through to the canvas's own undo stack.
  const performPhotoUndo = useCallback(
    (redo) => {
      const stack = redo ? photoUndoRef.current.redo : photoUndoRef.current.undo;
      if (!stack.length) return false;
      const entry = stack.pop();
      (redo ? photoUndoRef.current.undo : photoUndoRef.current.redo).push(entry);
      const edit = (redo ? entry.after : entry.before) || {};
      onPhotoEdit(entry.asset, edit);
      fetch(`/_api/photo-edit?asset=${encodeURIComponent(entry.asset)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      }).catch(() => {});
      setPhotoRev((v) => v + 1);
      return true;
    },
    [onPhotoEdit]
  );
  // Task 12 — magic background removal, entirely client-side (WASM/WebGPU via
  // @imgly/background-removal — NEVER the -node native-addon variant, DDR-070).
  // The lib is DYNAMICALLY imported so a session that never removes a background
  // pays zero bundle cost (the lazy-bundle guarantee). Fetches the source bytes,
  // runs the matte, uploads it content-addressed through the SAME /_api/asset lane
  // drag-drop uses, and returns the new `assets/<sha8>.png` for PhotoEdit.
  const onPhotoRemoveBackground = useCallback(
    async (asset) => {
      // Scan/shimmer reveal on the live photo while the ML pass runs, the same
      // "something is actively happening here" language as the agent-edit
      // artboard rim (artboard-activity-overlay.tsx) — but applied directly to
      // the photo element itself (a `data-photo-busy` attribute + injected CSS
      // mask sweep, inspect.ts) rather than a floating tracked overlay. A
      // floating decoy is exactly the architecture DDR-161's addendum tore out
      // for the live-edit preview (z-index/resize/hit-testing bugs); an
      // attribute toggle on the real element sidesteps that whole class.
      postToActiveCanvas({ dgn: 'photo-busy', asset, busy: true });
      try {
        const srcRes = await fetch(`/${asset.replace(/^\/+/, '')}`);
        if (!srcRes.ok) return null;
        const srcBlob = await srcRes.blob();
        const { removeBackground } = await import('@imgly/background-removal');
        // Inference is 100% CLIENT-SIDE (WASM/WebGPU) — the user's pixels NEVER
        // leave the browser. Only the public model weights (~40 MB, identical for
        // everyone) are fetched from IMG.LY's default host on first use; they're
        // too large to bundle in the npm tarball (`resources.json` ships empty).
        // Self-hosting those weights off the dev server for offline / air-gapped
        // parity is the flagged Task-11 follow-up (a one-time download step) — until
        // then the default host provides them, with no pixel-privacy exposure.
        const matte = await removeBackground(srcBlob);
        const up = await fetch('/_api/asset', {
          method: 'POST',
          headers: { 'content-type': matte.type || 'image/png' },
          body: matte,
        });
        const j = await up.json().catch(() => ({}));
        if (up.ok && j.path) return { maskAsset: j.path };
        return null;
      } catch (err) {
        console.error('[photo] background removal failed', err);
        return null;
      } finally {
        // Always clears, success or failure — an errored pass must not leave
        // the shimmer stuck on the photo forever.
        postToActiveCanvas({ dgn: 'photo-busy', asset, busy: false });
      }
    },
    [postToActiveCanvas]
  );

  // DDR-150 dogfood #7 — a file dragged from Finder and dropped on a shell area
  // with no drop target used to make the browser NAVIGATE AWAY to the file
  // (file:// replaces the app). Document-level guard: always cancel the default
  // for file drags; the TimelinePanel's own onDrop (bubbling before this) still
  // receives the drop first — this only blocks the browser fallback.
  useEffect(() => {
    const isFileDrag = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDocDragOver = (e) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    const onDocDrop = (e) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    document.addEventListener('dragover', onDocDragOver);
    document.addEventListener('drop', onDocDrop);
    return () => {
      document.removeEventListener('dragover', onDocDragOver);
      document.removeEventListener('drop', onDocDrop);
    };
  }, []);

  // DDR-150 P3 Task 9 — timeline keyboard shortcuts. Read live state through a
  // ref so the listener attaches once. Gated on: timeline open + a comp active +
  // focus NOT in a text field. Space doesn't steal the canvas PAN chord because
  // that keydown fires inside the focused canvas iframe, never reaching this
  // top-document listener. Space = play/pause · ←/→ = ±1 frame (Shift = ±1s) ·
  // Home/End = start/end · ,/. = prev/next keyframe boundary.
  const tlKeyRef = useRef({});
  tlKeyRef.current = {
    open: timelineOpen,
    comps: activeComps,
    frame: timelineFrame,
    total: timelineTotal,
    playing: timelinePlaying,
    compId: timelineCompId,
    muted: timelineMuted,
    loop: timelineLoop,
    sequences: timelineSequences,
    post: postToActiveCanvas,
    canvas: activePath,
  };

  // DDR-150 dogfood #1 — Timeline undo/redo. Every successful clip op (move /
  // trim / remove / insert / z-reorder / replace-src) returns a server `seq`
  // registered in the whole-file undo log; Cmd+Z / Shift+Cmd+Z replay it via
  // /_api/reorder-revert (guarded swap — 409s honestly if the canvas diverged).
  const tlUndoRef = useRef({ undo: [], redo: [] });
  const pushTlUndo = useCallback((canvas, seq, label) => {
    if (typeof seq !== 'number') return;
    tlUndoRef.current.undo.push({ canvas, seq, label });
    tlUndoRef.current.redo = []; // a new edit invalidates the redo branch
    if (tlUndoRef.current.undo.length > 50) tlUndoRef.current.undo.shift();
  }, []);
  const tlUndoRedo = useCallback((dir) => {
    const s = tlUndoRef.current;
    const src = dir === 'undo' ? s.undo : s.redo;
    const dst = dir === 'undo' ? s.redo : s.undo;
    const canvas = tlKeyRef.current.canvas;
    // Last entry for THIS canvas (stacks are global; ops are per-canvas).
    let idx = -1;
    for (let i = src.length - 1; i >= 0; i--) {
      if (src[i].canvas === canvas) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      shellToast(dir === 'undo' ? 'Nothing to undo on this timeline.' : 'Nothing to redo.');
      return;
    }
    const entry = src[idx];
    fetch('/_api/reorder-revert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: entry.canvas, seq: entry.seq, dir }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        src.splice(idx, 1);
        if (j?.ok) {
          dst.push(entry);
          shellToast(`${dir === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`, true);
        } else {
          // 409 canvas diverged / 404 server restarted — entry is dead, drop it.
          shellToast(`${dir === 'undo' ? 'Undo' : 'Redo'} skipped: ${j?.error || 'failed'}`);
        }
      })
      .catch(() => shellToast(`${dir === 'undo' ? 'Undo' : 'Redo'} failed: network error`));
  }, []);
  // Task 3 — resolve a `{ stableId, index }` clipRef against a fresh comp-clips
  // response. stableId wins (multi-comp-safe, survives reorder); the row index
  // stays as the legacy fallback for rows the enumerator couldn't identify.
  const resolveClipRef = useCallback((cc, clipRef) => {
    const seqs =
      cc?.ok && Array.isArray(cc.clips) ? cc.clips.filter((c) => c.kind === 'sequence') : [];
    if (clipRef == null) return null;
    if (typeof clipRef === 'object') {
      return (
        (clipRef.stableId ? seqs.find((c) => c.stableId === clipRef.stableId) : null) ||
        (Number.isInteger(clipRef.index) ? seqs[clipRef.index] : null) ||
        null
      );
    }
    if (typeof clipRef === 'string') return seqs.find((c) => c.stableId === clipRef) || null;
    return seqs[clipRef] || null;
  }, []);

  // Task 3 — remove a clip (with server-side ripple for series beats). Shared by
  // the panel's ×/context-menu and the Delete/Backspace key on the selection.
  const timelineRemoveClip = useCallback(
    (clipRef) => {
      const canvas = tlKeyRef.current.canvas;
      if (!canvas || canvas === SYSTEM_TAB) return;
      const artboardId = timelineArtboardIdRef.current || undefined;
      const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
      fetch(ccUrl)
        .then((r) => r.json().catch(() => ({})))
        .then((cc) => {
          const clip = resolveClipRef(cc, clipRef);
          if (!clip?.stableId) return null;
          return fetch('/_api/remove-sequence', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              canvas,
              artboardId,
              stableId: clip.stableId,
              contentHash: clip.contentHash,
            }),
          });
        })
        .then((r) => (r ? r.json() : null))
        .then((j) => {
          if (j && !j.ok) {
            console.warn('[remove-clip]', j.error || 'failed');
            timelineOpFailed('Remove refused', j.error);
          } else if (j?.ok) {
            shellToast('Clip removed.', true);
            if (j.seq != null) pushTlUndo(canvas, j.seq, 'remove clip');
            setTimelineSelectedClip(null);
          }
        })
        .catch(() => shellToast('Remove failed: network error'));
    },
    [resolveClipRef, pushTlUndo]
  );
  // Phase 2/3 — the parametric verb pipe (speed/trim-in/audio/detach-audio/
  // framing/grade/transition/split/insert-transition/remove-transition), shared
  // by the inspector popover, context menu, seam chips, and keyboard (⌘B).
  const timelineClipVerb = useCallback(
    (clipRef, verb, params) => {
      const canvas = tlKeyRef.current.canvas;
      if (!canvas || canvas === SYSTEM_TAB) return;
      const artboardId = timelineArtboardIdRef.current || undefined;
      const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
      fetch(ccUrl)
        .then((r) => r.json().catch(() => ({})))
        .then((cc) => {
          const all = cc?.ok && Array.isArray(cc.clips) ? cc.clips : [];
          const clip = clipRef?.transition
            ? all.find((c) => c.kind === 'transition' && c.stableId === clipRef.stableId) || null
            : resolveClipRef(cc, clipRef);
          if (!clip?.stableId) return null;
          return fetch('/_api/clip-edit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              canvas,
              artboardId,
              stableId: clip.stableId,
              contentHash: clip.contentHash,
              verb,
              ...params,
            }),
          });
        })
        .then((r) => (r ? r.json() : null))
        .then((j) => {
          if (j && !j.ok) {
            console.warn('[clip-edit]', verb, j.error || 'failed');
            timelineOpFailed(`${verb} refused`, j.error);
          } else if (j?.ok) {
            const labels = {
              speed: 'set speed',
              'trim-in': 'trim in-point',
              audio: 'clip audio',
              'detach-audio': 'detach audio',
              framing: 'crop clip',
              grade: 'grade clip',
              transition: 'edit transition',
              split: 'split clip',
              'insert-transition': 'add transition',
              'remove-transition': 'remove transition',
              'set-text': 'edit text',
              'to-overlay': 'move to overlay layer',
              'to-storyline': 'move to storyline',
              'layer-order': 'reorder layers',
            };
            shellToast(`Applied: ${labels[verb] || verb}.`, true);
            if (j.seq != null) pushTlUndo(canvas, j.seq, labels[verb] || verb);
          }
        })
        .catch(() => shellToast(`${verb} failed: network error`));
    },
    [resolveClipRef, pushTlUndo, timelineOpFailed]
  );
  // Tauri's WKWebView does NOT implement window.prompt() (returns null
  // synchronously — the "click does nothing" desktop bug), so every text ask
  // goes through this promise-based shell modal instead.
  const [shellPromptState, setShellPromptState] = useState(null); // { title, value, resolve }
  const askText = useCallback(
    (title, initial = '') =>
      new Promise((resolve) => {
        setShellPromptState({ title, value: initial, resolve });
      }),
    []
  );
  const settleShellPrompt = useCallback((value) => {
    setShellPromptState((s) => {
      s?.resolve?.(value);
      return null;
    });
  }, []);

  // Task 23 — timeline comments ride the EXISTING comment system (same WS
  // channel + `_comments/` store), with a `timeline` anchor:
  // { clipStableId, frameOffset } (survives reorder/ripple) or { frame }.
  const timelineAddComment = useCallback((anchor, text) => {
    const canvas = tlKeyRef.current.canvas;
    if (!canvas || canvas === SYSTEM_TAB || !text || !String(text).trim()) return;
    wsSend({
      type: 'comments-add',
      payload: {
        file: canvas,
        text: String(text).trim(),
        selector: '',
        dom_path: [],
        tag: '',
        classes: '',
        bounds: null,
        html_excerpt: '',
        timeline: anchor,
      },
    });
    shellToast('Comment added.', true);
  }, []);
  tlKeyRef.current.selected = timelineSelectedClip;
  tlKeyRef.current.setSelected = setTimelineSelectedClip;
  tlKeyRef.current.removeClip = timelineRemoveClip;
  tlKeyRef.current.clipVerb = timelineClipVerb;
  tlKeyRef.current.addComment = timelineAddComment;
  tlKeyRef.current.askText = askText;

  useEffect(() => {
    const onKey = (e) => {
      const s = tlKeyRef.current;
      if (!s.open || !s.comps?.length) return;
      const t = e.target;
      const tag = t?.tagName;
      // Range sliders (zoom / volume) keep focus after a drag — Space must
      // still play/pause (the "spacebar stopped working" dogfood bug). Text
      // inputs stay exempt.
      if (tag === 'INPUT' && t?.type !== 'range') return;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      // The timebase of the comp the transport is on, not of whichever comp
      // announced first — Shift+arrow is "±1 second" on THIS artboard (#75).
      const fps = activeComp(s.comps, s.compId)?.fps || 30;
      const total = Math.max(1, s.total);
      const doSeek = (f) => {
        const nf = Math.max(0, Math.min(total - 1, Math.round(f)));
        setTimelineFrame(nf);
        setTimelinePlaying(false);
        s.post({ dgn: 'timeline-seek', frame: nf, id: s.compId });
      };
      const snapFrames = () => {
        const pts = new Set([0, total - 1]);
        for (const seq of s.sequences || []) {
          pts.add(seq.from);
          for (const kf of seq.keyframes || []) {
            pts.add(kf.from);
            pts.add(kf.to);
          }
        }
        return [...pts].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);
      };
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        // Cmd+Z / Shift+Cmd+Z — undo/redo the last timeline clip op. Only when
        // the shell (not the canvas iframe) has focus + the timeline is active,
        // so the canvas's own annotation undo is untouched.
        e.preventDefault();
        tlUndoRedo(e.shiftKey ? 'redo' : 'undo');
        return;
      }
      // Task 3 — the select → act grammar: Esc deselects, Delete/Backspace
      // removes the selection (with ripple on the server for series beats).
      if (e.key === 'Escape') {
        if (s.selected != null) {
          e.preventDefault();
          s.setSelected?.(null);
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected != null) {
        e.preventDefault();
        s.removeClip?.({ stableId: s.selected });
        return;
      }
      // Task 23 + dogfood 2026-07-30 — `C` ARMS the panel's comment tool
      // (click-to-place, like the artboard's C); the panel's own window
      // keydown owns the toggle, so the shell must NOT double-handle it.
      // Task 16 — ⌘B splits the selection at the playhead; with nothing
      // selected, the clip under the playhead (iMovie behavior).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        let ref = s.selected != null ? { stableId: s.selected } : null;
        if (!ref) {
          const rows = s.sequences || [];
          const under =
            rows.find((r2) => r2.series && s.frame >= r2.from && s.frame < r2.from + r2.duration) ||
            rows.find((r2) => s.frame >= r2.from && s.frame < r2.from + r2.duration);
          if (under?.stableId) ref = { stableId: under.stableId };
        }
        if (ref) s.clipVerb?.(ref, 'split', { atFrame: s.frame });
        else shellToast('Nothing under the playhead to split.');
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (s.playing) {
          setTimelinePlaying(false);
          s.post({ dgn: 'timeline-pause', id: s.compId });
        } else {
          setTimelinePlaying(true);
          s.post({ dgn: 'timeline-mute', muted: s.muted, id: s.compId });
          s.post({ dgn: 'timeline-loop', loop: s.loop, id: s.compId });
          s.post({ dgn: 'timeline-play', id: s.compId });
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        doSeek(s.frame + (e.shiftKey ? fps : 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        doSeek(s.frame - (e.shiftKey ? fps : 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        doSeek(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        doSeek(total - 1);
      } else if (e.key === '.') {
        e.preventDefault();
        const next = snapFrames().find((n) => n > s.frame);
        if (next != null) doSeek(next);
      } else if (e.key === ',') {
        e.preventDefault();
        const prev = snapFrames()
          .reverse()
          .find((n) => n < s.frame);
        if (prev != null) doSeek(prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // DDR-148 — reset the Timeline's comp meta when the active canvas changes (a
  // non-comp canvas fires no announce, so stale comps would linger), then ask
  // the (possibly already-mounted) active canvas to re-announce. video-comp.tsx
  // answers `timeline-request-comps` with a fresh `timeline-comps`.
  useEffect(() => {
    setActiveComps([]);
    setTimelineFrame(0);
    setTimelinePlaying(false);
    setTimelineSelectedClip(null);
    // A stale artboard id from the PREVIOUS canvas would mis-scope the first
    // ops on the next one until its parse lands — clear it with the rest.
    setTimelineArtboardId(null);
    const t = setTimeout(() => postToActiveCanvas({ dgn: 'timeline-request-comps' }), 60);
    return () => clearTimeout(t);
  }, [activePath, postToActiveCanvas]);

  // DDR-148 — fetch the active canvas's raw source when the Timeline is open.
  // Re-runs when a comp is (re)announced, so it refreshes after a canvas edit.
  const [timelineSource, setTimelineSource] = useState('');
  // DDR-150 dogfood — authoritative per-clip media from the enumerator (handles
  // wrapper components + array-fed src the regex parser can't see), merged into
  // the rows for the kind badge + replace addressing.
  const [timelineClipMedia, setTimelineClipMedia] = useState([]);
  // Phase 2 — the enumerator's transitions (stableId + contentHash), in seam
  // order, for the ⧓ chip → Transition tab flow.
  const [timelineTransClips, setTimelineTransClips] = useState([]);
  useEffect(() => {
    if (!timelineOpen || activeComps.length === 0 || !activePath || activePath === SYSTEM_TAB) {
      setTimelineSource('');
      setTimelineClipMedia([]);
      return undefined;
    }
    let alive = true;
    fetch(`/_api/canvas-source?file=${encodeURIComponent(activePath)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.ok && typeof j.source === 'string') setTimelineSource(j.source);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [timelineOpen, activeComps, activePath, timelineRefresh]);

  // Authoritative per-clip media (comp-clips) — a SEPARATE effect keyed on the
  // RESOLVED artboard id, which the parser only knows AFTER timelineSource
  // arrives. Fetching it here (not in the source effect) means it re-runs once
  // the parser scopes to the right comp — so a multi-comp canvas (the showreel:
  // Movie + Reel) overlays the CORRECT comp's media, not the enumerator's own
  // fallback pick.
  useEffect(() => {
    if (!timelineOpen || !activePath || activePath === SYSTEM_TAB || !timelineSource) {
      setTimelineClipMedia([]);
      setTimelineTransClips([]);
      return undefined;
    }
    let alive = true;
    const artboardId = timelineArtboardId || undefined;
    const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
    fetch(ccUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((cc) => {
        if (!alive) return;
        const all = cc?.ok && Array.isArray(cc.clips) ? cc.clips : [];
        setTimelineClipMedia(all.filter((c) => c.kind === 'sequence'));
        setTimelineTransClips(all.filter((c) => c.kind === 'transition'));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [timelineOpen, activePath, timelineSource, timelineArtboardId, timelineRefresh]);

  // Parse (cheap) — re-runs on source change AND on selection change, so the
  // Timeline REDRAWS to whichever artboard the user just selected/moved to.
  useEffect(() => {
    if (!timelineSource) {
      setTimelineSequences([]);
      setTimelineAudio([]);
      setTimelineTransitions([]);
      setTimelineTotal(0);
      return;
    }
    const artboard = canvasActiveArtboard ?? selected?.artboardId ?? null;
    // Seed the parser's fallback total from the comp mounted in THIS artboard,
    // not from whichever comp announced first (issue #75).
    const seedComp =
      (artboard && activeComps.find((c) => c.artboardId === artboard || c.id === artboard)) ||
      activeComps[0];
    const total = seedComp?.durationInFrames || 0;
    const parsed = parseCompTimeline(timelineSource, total, artboard);
    setTimelineArtboardId(parsed.artboardId ?? artboard ?? null);
    // Overlay the enumerator's authoritative media (kind badge + replace target)
    // onto each row by sequence index — it sees wrapper-component + array-fed
    // media the row parser can't (the showreel <ClipShot clip={CLIPS[i]}/> case).
    const merged = parsed.sequences.map((s, i) => {
      const cm = timelineClipMedia[i];
      if (!cm) return s;
      return {
        ...s,
        // Task 3 — the enumerator's durable identity rides on every row so the
        // panel can select + address ops by stableId, never by row index.
        stableId: cm.stableId,
        contentHash: cm.contentHash,
        // Phase 2 — authoritative parametric props for the clip inspector.
        mediaProps: cm.mediaProps ?? null,
        // Task 21 — AI placeholder slate (✨ row + Generate flow).
        placeholder: cm.placeholder ?? null,
        mediaTag: cm.mediaTag ?? s.mediaTag,
        mediaSrc: cm.mediaSrc ?? s.mediaSrc,
        // Replaceable when the enumerator found an addressable media target:
        // a literal-src element (mediaCdId) or an array-fed src (mediaArrayRef).
        replaceable: !!(cm.mediaCdId || cm.mediaArrayRef),
        // The clip's stacked layers (mp4 background + title/…) for expandable rows.
        layers: Array.isArray(cm.layers) ? cm.layers : [],
        hidden: !!cm.hidden,
      };
    });
    setTimelineSequences(merged);
    setTimelineAudio(parsed.audio || []);
    setTimelineTransitions(parsed.transitions || []);
    setTimelineTotal(parsed.total);
  }, [timelineSource, timelineClipMedia, selected, activeComps, canvasActiveArtboard]);

  const toggleAnnotations = useCallback(() => {
    setAnnotationsVisible((v) => {
      const next = !v;
      const el = activePath ? iframesRef.current.get(activePath) : null;
      if (el && el.contentWindow) {
        try {
          el.contentWindow.postMessage({ dgn: 'view-annotations', visible: next }, '*');
        } catch {}
      }
      return next;
    });
  }, [activePath]);

  // Chrome visibility (minimap / zoom-controls / Presentation Mode) applies to
  // EVERY open canvas iframe, not just the active one — broadcast to all. A
  // freshly-loaded iframe is seeded from the dgn:'loaded' handler below.
  const broadcastChrome = useCallback((patch) => {
    for (const el of iframesRef.current.values()) {
      try {
        el.contentWindow.postMessage({ dgn: 'view-chrome', ...patch }, '*');
      } catch {}
    }
  }, []);
  const toggleMinimap = useCallback(() => {
    setMinimapVisible((v) => {
      const next = !v;
      broadcastChrome({ minimap: next });
      return next;
    });
  }, [broadcastChrome]);
  const toggleZoomCtl = useCallback(() => {
    setZoomCtlVisible((v) => {
      const next = !v;
      broadcastChrome({ zoom: next });
      return next;
    });
  }, [broadcastChrome]);
  const togglePresent = useCallback(() => {
    setPresentMode((v) => {
      const next = !v;
      broadcastChrome({ present: next });
      return next;
    });
  }, [broadcastChrome]);
  const exitPresent = useCallback(() => {
    setPresentMode(false);
    broadcastChrome({ present: false });
  }, [broadcastChrome]);
  // feature-2-print-artboards T3 — per-canvas persisted, so (unlike
  // broadcastChrome above) this targets ONLY the active iframe and PATCHes
  // view.json's `overlays.print` through the same GET-merge/PATCH-split lane
  // the foundation built for `overlays.guides` (api.ts normalizeOverlays is a
  // flat Record<string, boolean> — no server change needed for a new key).
  const togglePrintGuides = useCallback(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    setPrintGuidesVisible((v) => {
      const next = !v;
      postToActiveCanvas({ dgn: 'view-chrome', print: next });
      fetch('/_api/canvas-meta', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: activePath, patch: { overlays: { print: next } } }),
      }).catch(() => {});
      return next;
    });
  }, [activePath, postToActiveCanvas]);

  // P3 (Plan C) — local git user for the menubar presence avatar. One-shot.
  useEffect(() => {
    let cancelled = false;
    fetch('/_api/git-user')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const n = d && typeof d.name === 'string' ? d.name.trim() : '';
        if (n) setGitUser(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // P2 (Plan C) — when the active canvas changes, read its real artboard count
  // from the `<canvas>.meta.json` sidecar (shell-side, no iframe dep).
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB) {
      setActiveArtboards(0);
      setPrintGuidesVisible(false);
      return;
    }
    let cancelled = false;
    fetch('/_api/canvas-meta?file=' + encodeURIComponent(activePath))
      .then((r) => r.json())
      .then((meta) => {
        if (cancelled) return;
        const n = Array.isArray(meta?.artboards) ? meta.artboards.length : 0;
        setActiveArtboards(n);
        // feature-2-print-artboards T3 — reflect THIS canvas's own persisted
        // print-guides flag in the menu checkbox when switching tabs.
        setPrintGuidesVisible(meta?.overlays?.print === true);
        // feature-4 T7b — seed this canvas's persisted locked-layer keys
        // (view.json `locked`, per-user) into the Layers panel state.
        setLockedKeys(new Set(Array.isArray(meta?.locked) ? meta.locked : []));
      })
      .catch(() => {
        if (!cancelled) {
          setActiveArtboards(0);
          setPrintGuidesVisible(false);
          setLockedKeys(new Set());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  // feature-4 dogfood fix (2026-07-19) — the Layers panel used to stay EMPTY
  // until something was selected (the tree only posted on selection). Request
  // the tree for the viewport-active artboard whenever it (or the canvas)
  // changes, so Layers work in browse mode with no selection at all. Small
  // debounce — the active-artboard signal can flicker during a fast pan.
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB || !canvasActiveArtboard) return;
    const t = setTimeout(() => {
      postToActiveCanvas({ dgn: 'request-layers', artboardId: canvasActiveArtboard });
    }, 250);
    return () => clearTimeout(t);
  }, [activePath, canvasActiveArtboard, postToActiveCanvas]);

  // feature-4 T7b — locked layer keys (`"<cdId>:<index>"`, per-user, per-canvas
  // via view.json). Toggling PATCHes the FULL set (replace semantics) + pushes
  // the live set down to the canvas iframe so select/drag enforcement matches
  // the padlock instantly.
  const [lockedKeys, setLockedKeys] = useState(() => new Set());
  const toggleLockedKey = useCallback(
    (key) => {
      if (!activePath || activePath === SYSTEM_TAB) return;
      setLockedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        const arr = [...next];
        fetch('/_api/canvas-meta', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: activePath, patch: { locked: arr } }),
        }).catch(() => {});
        postToActiveCanvas({ dgn: 'locked-set', locked: arr });
        return next;
      });
    },
    [activePath, postToActiveCanvas]
  );
  // Push the seed to a (re)loaded canvas too — the iframe reads
  // `__canvas_meta__.locked` at boot, but a shell-side toggle after a reload
  // must still reach it; re-broadcast whenever the set or canvas changes.
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    postToActiveCanvas({ dgn: 'locked-set', locked: [...lockedKeys] });
  }, [lockedKeys, activePath, postToActiveCanvas]);

  // Sync theme to <html data-theme> + localStorage on every change.
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(THEME_STORE, theme);
    } catch {}
    // System-review D9 — the canvas-shell chrome (workspace plane, floating
    // toolbar, minimap, zoom HUD, halos) follows the Maude theme. Broadcast to
    // EVERY open canvas iframe (not just activePath — several may be open); the
    // iframe's canvas-shell sets `data-maude-theme` and re-themes its floating
    // chrome via the --maude-chrome-* family. Artboards keep their DS theme.
    // Mirrors the git-lifecycle broadcast-to-all loop below. On the initial
    // mount run iframesRef is empty (no canvas open yet) — a freshly-loaded
    // iframe instead gets the current theme from the `dgn:'loaded'` handler.
    for (const el of iframesRef.current.values()) {
      try {
        el.contentWindow.postMessage({ dgn: 'theme', theme }, '*');
      } catch {}
    }
  }, [theme]);

  // Persist sidebar / hidden-files / DS-body toggles. Mirror theme pattern.
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORE, sidebarOpen ? '1' : '0');
    } catch {}
  }, [sidebarOpen]);
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_HIDDEN_STORE, showHidden ? '1' : '0');
    } catch {}
  }, [showHidden]);
  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_STORE, JSON.stringify(sectionsExpanded));
    } catch {}
  }, [sectionsExpanded]);
  useEffect(() => {
    try {
      localStorage.setItem(MINIMAP_STORE, minimapVisible ? '1' : '0');
    } catch {}
  }, [minimapVisible]);
  useEffect(() => {
    try {
      localStorage.setItem(ZOOMCTL_STORE, zoomCtlVisible ? '1' : '0');
    } catch {}
  }, [zoomCtlVisible]);
  useEffect(() => {
    try {
      localStorage.setItem(ANNOT_STORE, annotationsVisible ? '1' : '0');
    } catch {}
  }, [annotationsVisible]);

  // feature-unified-settings-modal — reconcile view prefs with the on-disk store
  // once on mount (disk wins over the localStorage/default init: it survives a
  // cleared localStorage). Applying a value that already matches is a no-op, so
  // there's no flash in the common case. On failure we still mark hydrated so
  // writes resume best-effort.
  useEffect(() => {
    let cancelled = false;
    fetch('/_api/ui-prefs')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((p) => {
        if (cancelled || !p || typeof p !== 'object') return;
        if (p.theme === 'light' || p.theme === 'dark') setTheme(p.theme);
        if (typeof p.minimap === 'boolean') setMinimapVisible(p.minimap);
        if (typeof p.zoom === 'boolean') setZoomCtlVisible(p.zoom);
        if (typeof p.annotations === 'boolean') setAnnotationsVisible(p.annotations);
        if (typeof p.autoOpenInspector === 'boolean') setAutoOpenInspector(p.autoOpenInspector);
        if (p.panelSides && typeof p.panelSides === 'object')
          setPanelSide({ ...PANEL_SIDES_DEFAULTS, ...p.panelSides });
        if (p.layersMode === 'separate' || p.layersMode === 'in-inspector')
          setLayersMode(p.layersMode);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setUiPrefsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror every view pref to disk once hydrated. The barrier stops the initial
  // render (localStorage/default values) from overwriting the disk store before
  // the boot GET has reconciled.
  useEffect(() => {
    if (!uiPrefsHydrated) return;
    persistUiPrefs({
      theme,
      minimap: minimapVisible,
      zoom: zoomCtlVisible,
      annotations: annotationsVisible,
      autoOpenInspector,
      panelSides: panelSide,
      layersMode,
    });
  }, [
    uiPrefsHydrated,
    theme,
    minimapVisible,
    zoomCtlVisible,
    annotationsVisible,
    autoOpenInspector,
    panelSide,
    layersMode,
  ]);
  // localStorage mirror for panel sides + layers mode (synchronous no-flash init).
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_SIDES_STORE, JSON.stringify(panelSide));
    } catch {}
  }, [panelSide]);
  useEffect(() => {
    try {
      localStorage.setItem(LAYERS_MODE_STORE, layersMode);
    } catch {}
  }, [layersMode]);

  const toggleSection = useCallback((label, defaultOpen) => {
    setSectionsExpanded((prev) => {
      const cur = prev[label];
      const isOpen = cur === undefined ? defaultOpen : cur;
      return { ...prev, [label]: !isOpen };
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  // ----- Tree -----
  const loadTree = useCallback(async () => {
    try {
      const r = await fetch('/_index-data');
      const data = await r.json();
      setProject(data.project || 'Design');
      const built = data.groups.map((g) => ({
        ...g,
        tree: buildTree(g.paths, g.stripPrefix, g.dirs),
      }));
      setGroups(built);
      // DDR-093 — fold the server-resolved per-canvas DS map into cfg so
      // canvasUrl() injects each UI canvas's OWN design-system tokens instead of
      // always designSystems[0]. Functional merge to coexist with the /_config
      // fetch (either may land first). `?? {}` keeps older servers (no map) on
      // the ds0 fallback. Re-runs on every tree reload, so adding/retargeting a
      // canvas refreshes the map.
      setCfg((prev) => ({
        ...prev,
        canvasDesignSystems: data.canvasDesignSystems ?? {},
        // DDR-174 (T15) — per-canvas notable `.meta.json` `kind` values (today:
        // only `reconstructed-experimental`), folded in the same way + for the
        // same reason as canvasDesignSystems above.
        canvasKinds: data.canvasKinds ?? {},
      }));
    } catch (e) {
      console.error('failed to load tree', e);
    }
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // ----- System data (lazy) -----
  // `dsName` scopes to a single design-system entry (DDR-048). The initial
  // call is unscoped — server returns `availableDesignSystems[]` + a default
  // — so the picker can render without a probe round-trip. Subsequent calls
  // (e.g. picker change) pass the chosen DS name and we replace systemData
  // wholesale (tokens + previews + ds metadata all shift together).
  const loadSystemData = useCallback(async (dsName) => {
    try {
      const url = dsName ? `/_system-data?ds=${encodeURIComponent(dsName)}` : '/_system-data';
      const r = await fetch(url);
      if (!r.ok) {
        console.error('failed to load system-data', r.status);
        return;
      }
      const data = await r.json();
      // If the initial unscoped fetch has a defaultDesignSystem but no `ds`
      // attached (multi-DS project), kick off a scoped fetch so the visible
      // tokens + previews match the default DS, not the union root scan.
      if (!dsName && data?.defaultDesignSystem && !data.ds) {
        setSystemData(data);
        const r2 = await fetch(`/_system-data?ds=${encodeURIComponent(data.defaultDesignSystem)}`);
        if (r2.ok) setSystemData(await r2.json());
        return;
      }
      setSystemData(data);
    } catch (e) {
      console.error('failed to load system-data', e);
    }
  }, []);

  // ----- Comments — initial load of all files -----
  const loadAllComments = useCallback(async () => {
    try {
      const r = await fetch('/_comments-all');
      const data = await r.json();
      setCommentsByFile(data || {});
    } catch (e) {
      console.error('failed to load comments', e);
    }
  }, []);

  useEffect(() => {
    loadAllComments();
  }, [loadAllComments]);

  // ----- WebSocket -----
  useEffect(() => {
    // KEEPALIVE. The inspector feed only pushes on events (a comment, a
    // selection, sync:status), so an idle designer's socket exchanges nothing
    // for minutes — and Bun.serve closes a WebSocket after `idleTimeout` (120s
    // default) with no message in EITHER direction. The client then reconnected
    // in a 1 s loop, so the status bar read `reconnecting` every couple of
    // minutes on a perfectly healthy link ("porad reconnecting" while HUB SYNC
    // said synced — the two are different sockets). A cheap app-level ping every
    // 25 s keeps the socket active (Bun resets the idle timer on any frame,
    // inbound OR outbound); the server ignores an unknown message type.
    let pingTimer = null;
    // A RECONNECT MEANS THE PEER MAY BE A DIFFERENT PROCESS — issue #115.
    // The desktop supervisor respawns the sidecar when it dies (DDR-235's Bun
    // fault is a recurring one), and everything this page cached from `/_config`
    // was published by the process that just went away. `canvasOrigin` is the
    // one that bites: it is an OS-assigned ephemeral port (server.ts's
    // `startCanvasServer(0)`), so it is DIFFERENT in every process, while the
    // main origin walks a deterministic ladder from 4399 and usually reclaims
    // its old port. The result was a half-live page — socket back up, status bar
    // `live`, tree and panels fine — whose every canvas iframe navigated to a
    // dead port. Since a canvas switch mounts a FRESH iframe (single-canvas
    // model, keyed by path), the already-open canvas kept rendering and only
    // switching went white, silently and permanently.
    //
    // So: re-derive the config from whoever is answering now. Only on a
    // RE-connect — the boot effect above already did the first fetch.
    let everConnected = false;
    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(proto + '//' + location.host + '/_ws');
      wsRef.current = ws;
      ws.addEventListener('open', () => {
        setWsConnected(true);
        if (everConnected) loadServerConfig();
        everConnected = true;
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
        }, 25000);
      });
      ws.addEventListener('close', () => {
        setWsConnected(false);
        clearInterval(pingTimer);
        setTimeout(connect, 1000);
      });
      ws.addEventListener('error', () => {});
      ws.addEventListener('message', (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'snapshot' && m.state) {
            setSelected((prev) => mergeSelClientFields(m.state.selected, prev));
          } else if (m.type === 'selected') {
            // feature-acp-context-hardening — a canvas switch RESTORES the
            // per-canvas selection server-side and broadcasts it here. The
            // dgn:'loaded' re-select (Phase 12.3 path below) only works when
            // this frame lands BEFORE the new iframe loads; on a fast cached
            // mount it lands after, so re-apply the halo from THIS edge too.
            // Guarded to restore-transitions (prev missing / different id or
            // file) so the select-set echo of our own re-select can't loop.
            //
            // feature-4 dogfood fix (2026-07-19) — the frame is ALSO the echo
            // of our OWN wsSend('select'): it round-trips the server and lands
            // hundreds of ms later, by which time the user may have drilled
            // deeper (dblclick) or multi-selected — the echo then OVERWROTE the
            // fresh state with the stale head and the halo-restore ladder
            // re-imposed it on the canvas ("multiselect snaps back to one",
            // "drill snaps back to the parent"). Suppress the restore path
            // entirely within a short window of any LOCAL selection send — a
            // genuine cross-canvas restore never follows a local select that
            // closely (it follows a canvas switch).
            if (Date.now() - lastLocalSelectAtRef.current < 2000) return;
            const incoming = m.selected;
            const one = Array.isArray(incoming) ? incoming[0] : incoming;
            const prevSel = selectedRef.current;
            const prevOne = Array.isArray(prevSel) ? prevSel[0] : prevSel;
            setSelected((prev) => mergeSelClientFields(incoming, prev));
            if (
              one?.id &&
              one.file &&
              (!prevOne || prevOne.id !== one.id || prevOne.file !== one.file)
            ) {
              scheduleHaloRestore(one);
            }
          } else if (m.type === 'comments' && typeof m.file === 'string') {
            setCommentsByFile((prev) => ({ ...prev, [m.file]: m.comments || [] }));
          } else if (m.type === 'ai-activity' && typeof m.file === 'string') {
            // P3 (Plan C) — surface live agent activity as a menubar presence
            // avatar. Set the flag and (re)arm an idle timer so the avatar
            // fades once Claude stops editing.
            setAgentActive(true);
            if (agentIdleRef.current) clearTimeout(agentIdleRef.current);
            agentIdleRef.current = setTimeout(() => setAgentActive(false), 8000);
            // Phase 8 Task 4 — relay to every open iframe; each canvas's
            // AiBanner filters by its own file path. Lightweight broadcast
            // (one envelope per change, not per iframe count).
            for (const el of iframesRef.current.values()) {
              try {
                el.contentWindow.postMessage(
                  { dgn: 'ai-activity', file: m.file, entry: m.entry },
                  '*'
                );
              } catch {}
            }
          } else if (m.type === 'export:job' && m.payload) {
            // feature-background-export-notification-center — full-snapshot
            // job state on every queued/running/progress/done/failed change.
            exportCenter.upsert(m.payload);
          } else if (m.type === 'sync:status' && m.payload) {
            // Phase 9 Task 8 — hub connection state for the offline banner.
            setSyncStatus(m.payload);
          } else if (m.type === 'canvas-list-update') {
            // Phase 30 — a canvas was created/deleted on THIS dev-server; re-read
            // the branch-scoped tree so other open tabs reflect it without a
            // reload. Cross-machine peers get a new canvas via git "Get latest".
            loadTree();
            // feature-file-tree-drag-drop-folders (Task 10) — a canvas moved.
            // moveCanvasReq already retargets the INITIATING tab locally (no
            // need to wait for this broadcast to round-trip); this branch is
            // for every OTHER open tab on the same dev-server, so a canvas
            // that was open there doesn't go dead pointing at a path that no
            // longer exists.
            if (m.payload?.action === 'moved' && m.payload.fromRel && m.payload.rel) {
              const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(
                /^\/+|\/+$/g,
                ''
              );
              const fromFile = `${designRel}/${m.payload.fromRel}`;
              const toFile = `${designRel}/${m.payload.rel}`;
              setTabs((prev) => prev.map((t) => (t.path === fromFile ? { path: toFile } : t)));
              setActivePath((prev) => (prev === fromFile ? toFile : prev));
            }
          } else if (m.type === 'config-updated') {
            // Server hot-reloaded .design/config.json (/design:setup-ds rewrote
            // it) — refetch /_config so designSystems / tokensCssRel / groups
            // match. The tree refresh arrives separately via canvas-list-update.
            loadServerConfig();
          } else if (m.type === 'acp-focus') {
            // Phase 31 (DDR-123) — `/design:chat` from the terminal asked us to
            // surface the native ACP chat sidepanel. Native-only (the panel
            // doesn't exist on the web surface).
            if (isNativeApp()) openRightPanel('assistant');
          } else if (m.type === 'git-status' && m.payload) {
            // Phase 27 (E2) Task 5 — live dirty-state. Updates the Changes-panel
            // count + tree M/A/D badges reactively, no polling.
            //
            // The server PUSHES this, so gating the fetches alone would not be
            // enough: the broadcast would quietly re-populate everything the
            // polls stopped asking for. Read through a ref because this handler
            // is installed once, by an effect that must not re-subscribe the
            // socket every time the posture flips.
            if (!savingIsManagedRef.current) setGitStatus(m.payload);
          } else if (m.type === 'git-lifecycle' && m.payload) {
            // Phase 8 Task 7 — branch switch / pull mid-session. Server has
            // already flushed every dirty Y.Doc to JSON; just prompt the user.
            // Single confirm covers all open iframes — reload reseeds them all.
            setGitLifecycle(m.payload);
            // Also relay to iframes so canvas-level "Reload?" UI (if any)
            // can react. Outer banner is the primary prompt.
            for (const el of iframesRef.current.values()) {
              try {
                el.contentWindow.postMessage({ dgn: 'git-lifecycle', payload: m.payload }, '*');
              } catch {}
            }
          }
        } catch {}
      });
    }
    connect();
    return () => {
      clearInterval(pingTimer);
      if (wsRef.current) wsRef.current.close();
    };
    // loadTree + loadServerConfig are stable useCallback([])s; listed so the
    // canvas-list-update / config-updated handlers always call the live refs.
  }, [loadTree, loadServerConfig]);

  function wsSend(obj) {
    const ws = wsRef.current;
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch {}
  }

  // ----- Phase 27 (E2) — git actions -----
  // All write actions POST same-origin (the dev-server's sameOriginWrite + the
  // dual-allowlist gate them main-origin only). After a mutation we refresh
  // status optimistically; the `git-status` WS broadcast also lands shortly.
  const refreshGitStatus = useCallback(async () => {
    if (savingIsManagedRef.current) return; // cloud-managed — nobody polls a repo they don't commit to
    try {
      const r = await fetch('/_api/git/status');
      if (r.ok) setGitStatus(await r.json());
    } catch {}
  }, []);

  // Phase 28 (E3) — probe the tracking remote so the Changes panel can surface
  // the "Get latest" nudge (GitPanel reads `status.remoteAhead` / `status.behind`).
  // `?remote=1` is what makes the server do the `git fetch` + ahead/behind count;
  // without it the status is local-only and the nudge never fires. Network call —
  // call sparingly (mount / interval / post-action), never on the WS hot path.
  const refreshRemoteSync = useCallback(async () => {
    // The ahead/behind probe is a real network `git fetch` against the LOCAL
    // repo's remote — the one remote a cloud-managed project has nothing to do
    // with. Gated here as well as at the interval, so a post-action call site
    // cannot reintroduce it.
    if (savingIsManagedRef.current) return;
    try {
      const r = await fetch('/_api/git/status?remote=1');
      if (!r.ok) return;
      const data = await r.json();
      if (data && data.repo !== false)
        setRemoteSync({ remoteAhead: !!data.remoteAhead, behind: data.behind || 0 });
    } catch {}
  }, []);

  const gitPostJson = useCallback(async (path, body) => {
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, ...data };
    } catch (e) {
      return { ok: false, error: 'Network error — is the project still open?' };
    }
  }, []);

  const gitCommit = useCallback(
    async (message, files) => {
      const res = await gitPostJson('/_api/git/commit', { message, files });
      if (res.ok) await refreshGitStatus();
      return res;
    },
    [gitPostJson, refreshGitStatus]
  );

  const gitDiscard = useCallback(
    async (files) => {
      const res = await gitPostJson('/_api/git/discard', { files });
      if (res.ok) await refreshGitStatus();
      return res;
    },
    [gitPostJson, refreshGitStatus]
  );

  const gitPublish = useCallback(async () => {
    const res = await gitPostJson('/_api/git/push', {});
    // Refresh so the "N versions ready to publish" count clears to 0 after a
    // successful push (the server advanced the local remote-tracking ref), and
    // re-probe the remote so a stale "Get latest" nudge clears.
    if (res.ok) {
      await refreshGitStatus();
      refreshRemoteSync();
    }
    return res;
  }, [gitPostJson, refreshGitStatus, refreshRemoteSync]);

  const gitGetLatest = useCallback(async () => {
    const res = await gitPostJson('/_api/git/pull', {});
    // On success the remote is merged in — clear the nudge by re-probing.
    if (res.ok) {
      await refreshGitStatus();
      refreshRemoteSync();
    }
    // A true content conflict → open the visual resolver on the first file.
    if (res.conflict && Array.isArray(res.files) && res.files.length) {
      setDiffTarget({ file: res.files[0], conflict: true });
    }
    return res;
  }, [gitPostJson, refreshGitStatus, refreshRemoteSync]);

  // Phase 28 (E3) — finish a Get-latest conflict from the DiffView resolver.
  // `choice` is 'mine' | 'theirs' | 'both'; the server completes the two-parent
  // merge commit (and, for 'both', writes our version as a "(mine)" copy).
  const gitResolveConflict = useCallback(
    async (choice) => {
      const res = await gitPostJson('/_api/git/resolve', { choice });
      if (res.ok) {
        await refreshGitStatus();
        refreshRemoteSync();
      }
      return res;
    },
    [gitPostJson, refreshGitStatus, refreshRemoteSync]
  );

  // `path` (optional) scopes History to one canvas — the per-file version list
  // behind the History click-to-preview + DiffView "Saved version" picker
  // (phase-27.1). Omit for the repo-wide log.
  const gitLoadLog = useCallback(async (path) => {
    try {
      const qs = '/_api/git/log?limit=40' + (path ? `&path=${encodeURIComponent(path)}` : '');
      const r = await fetch(qs);
      if (!r.ok) return [];
      const data = await r.json();
      return data.entries || [];
    } catch {
      return [];
    }
  }, []);

  // THE HISTORY THAT IS ACTUALLY BEING WRITTEN (feature-cloud-managed-git-
  // posture). Same signature and same row shape as `gitLoadLog` — the two are
  // interchangeable at the call site precisely because the format, the argv and
  // the parser behind them are ONE module (`git/log-format.ts`), imported by
  // both the local service and the cell.
  //
  // Failure is REPORTED, never mistaken for emptiness: `null` means "we could
  // not reach the cloud" (the panel shows a Retry callout), `[]` means "the
  // cloud has no versions yet" (the panel shows the empty state). Collapsing
  // the two is what produced the original bug in the first place.
  const [cloudHistory, setCloudHistory] = useState(null); // { branch, project, hubHost } | null
  const gitLoadCloudLog = useCallback(async (path) => {
    try {
      const qs =
        '/_api/cloud/history?limit=40' + (path ? `&path=${encodeURIComponent(path)}` : '');
      const r = await fetch(qs);
      if (!r.ok) return null;
      const data = await r.json();
      if (!data?.ok) return null;
      setCloudHistory({
        branch: data.branch ?? null,
        project: data.project ?? null,
        hubHost: data.hubHost ?? null,
      });
      return data.entries || [];
    } catch {
      return null;
    }
  }, []);

  // Repo-relative path → M/A/D/U badge for the tree (paths match: both the tree
  // and gitStatus use `.design/ui/Foo.tsx`). Keyed off gitStatus so it updates
  // live with the WS broadcast.
  const dirtyByPath = useMemo(() => {
    const KIND = { modified: 'M', added: 'A', deleted: 'D', untracked: 'U' };
    const m = new Map();
    // A tree badge is the SAME claim as the withdrawn count, drawn one row at a
    // time: "this file is unsaved". In cloud-managed posture it is not — the
    // cell committed it seconds ago. Empty, so the tree simply says nothing.
    if (savingIsManaged) return m;
    for (const f of gitStatus?.files || []) m.set(f.path, KIND[f.status]);
    return m;
  }, [gitStatus, savingIsManaged]);

  // Phase 28 (E3) — keep remote ahead/behind fresh so the "Get latest" nudge
  // surfaces on its own: probe once a repo is known, again whenever the Changes
  // panel opens, and on a slow 60 s tick WHILE the panel is open (a teammate's
  // publish then shows up without the user first attempting their own publish).
  // Declared after `refreshRemoteSync` to avoid a temporal-dead-zone on the dep.
  useEffect(() => {
    if (savingIsManaged) {
      // Nothing to nudge about: Publish is withdrawn in this posture, so a
      // probe could only produce a count nobody may act on. Clear the last
      // answer as well — a stale ahead/behind would outlive the link.
      setRemoteSync(null);
      return undefined;
    }
    if (gitStatus?.repo === false) return; // solo / non-git project — no remote
    refreshRemoteSync();
    // Poll in the background too — not only while Changes is open — so the dock's
    // "Get latest" nudge surfaces a teammate's publish proactively. Slower cadence
    // when the panel is closed to stay network-polite (the ahead/behind probe is
    // TTL-cached server-side, so a missed tick is cheap to re-issue).
    const id = setInterval(refreshRemoteSync, changesOpen ? 60000 : 120000);
    return () => clearInterval(id);
  }, [savingIsManaged, gitStatus?.repo, changesOpen, refreshRemoteSync]);

  // ----- Tab management (single-canvas) -----
  // Single-canvas model: opening a file REPLACES the active one (no tab strip).
  // The `tabs` state stays as a 0-or-1 array so the rest of the plumbing
  // (iframesRef, comments push, WS `tabs` message) doesn't need refactoring.
  // ARTBOARDS slot in the menubar reads `tabs.length` and reports 0 or 1.
  const openTab = useCallback((path) => {
    setTabs((prev) => {
      // Drop the previously-open iframe so we don't leak DOM nodes.
      for (const t of prev) if (t.path !== path) iframesRef.current.delete(t.path);
      return [{ path }];
    });
    setActivePath(path);
    setFocusedCommentId(null);
    setPreviewPath(null);
    setCanvasError(null);
    setLoadedPath(null);
    // Canvas-compile skeleton — cleared by the iframe's dgn:'loaded' message,
    // the onLoad fallback timer (legacy .html), or a hard 15s cap.
    if (path !== SYSTEM_TAB) setLoadingPath(path);
  }, []);

  // Retry from the #115 error panel: re-read /_config FIRST (the stale
  // `canvasOrigin` is the likeliest reason we are here at all), then remount the
  // iframe via the nonce so it navigates against the corrected origin.
  const retryCanvasLoad = useCallback(
    (path) => {
      setCanvasError(null);
      setLoadedPath(null);
      loadServerConfig();
      setCanvasReloadNonce((n) => n + 1);
      if (path && path !== SYSTEM_TAB) setLoadingPath(path);
    },
    [loadServerConfig]
  );

  /**
   * First open lands on a rendered canvas — Cloud Phase 27 C3.
   *
   * A desktop user chose this project, installed the app and knows what is in
   * it; the empty state is a helpful "pick a screen". A teammate following a
   * link has done none of that, and an empty pane with an arrow pointing at a
   * list is the browser saying "the thing you came for is somewhere else".
   *
   * CLOUD ONLY, and once. The desktop's empty state is deliberately unchanged —
   * it earns its keep there (the ⌘-hover lesson, quick setup) — and re-opening
   * a canvas the person deliberately closed would be a UI arguing with them.
   */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    if (!cfg.cloud) return; // desktop / unknown-yet
    if (tabs.length > 0) return;
    if (!groups.length) return; // tree not loaded
    // The first canvas that is somebody's WORK — a design-system specimen is a
    // rendered canvas too, and not what a teammate followed a link to see.
    let first = null;
    for (const g of groups) {
      for (const p of g.paths || []) {
        if (!CANVAS_EXT_RE.test(p)) continue;
        if (/(^|\/)system\//.test(p)) continue;
        first = p;
        break;
      }
      if (first) break;
    }
    if (!first) return;
    autoOpened.current = true;
    openTab(first);
  }, [cfg.cloud, groups, tabs.length, openTab]);

  const openSystem = useCallback(
    (dsName) => {
      // DsFolderRow passes the clicked DS name → scope the System view to it so
      // each folder shows its own tokens + previews. The no-arg callers (menubar,
      // keyboard reopen) only load default data on first open.
      const ds = typeof dsName === 'string' ? dsName : undefined;
      if (ds) loadSystemData(ds);
      else if (!systemData) loadSystemData();
      openTab(SYSTEM_TAB);
    },
    [systemData, loadSystemData, openTab]
  );

  useEffect(() => {
    wsSend({ type: 'tabs', tabs: tabs.map((t) => t.path).filter((p) => p !== SYSTEM_TAB) });
  }, [tabs]);

  useEffect(() => {
    if (activePath && activePath !== SYSTEM_TAB) wsSend({ type: 'active', file: activePath });
    else if (activePath === SYSTEM_TAB) wsSend({ type: 'active', file: '' });
    else wsSend({ type: 'active', file: '' });
  }, [activePath]);

  const closeTab = useCallback(
    (path) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === path);
        if (idx < 0) return prev;
        const next = prev.filter((t) => t.path !== path);
        if (path === activePath) {
          if (next.length === 0) setActivePath(null);
          else setActivePath(next[Math.max(0, idx - 1)].path);
        }
        return next;
      });
      iframesRef.current.delete(path);
      setLoadingPath((p) => (p === path ? null : p));
    },
    [activePath]
  );

  const reloadActive = useCallback(() => {
    if (!activePath || activePath === SYSTEM_TAB) {
      if (activePath === SYSTEM_TAB) loadSystemData();
      return;
    }
    const el = iframesRef.current.get(activePath);
    if (el) el.src = el.src;
  }, [activePath, loadSystemData]);

  const reloadTree = useCallback(() => loadTree(), [loadTree]);

  // User-facing tree refresh with a visible spin. The header button and ⌘⇧R call
  // this so the reload icon spins for at least one beat — even when /_index-data
  // returns instantly — so the action registers visually ("something is
  // happening"). The min-duration race keeps the spin from flashing for one
  // frame on a fast read; the ref guard ignores re-entrant clicks. The passive
  // focus backstop below uses the plain reloadTree (no icon to animate).
  const [treeRefreshing, setTreeRefreshing] = useState(false);
  const treeRefreshingRef = useRef(false);
  const refreshTree = useCallback(async () => {
    if (treeRefreshingRef.current) return;
    treeRefreshingRef.current = true;
    setTreeRefreshing(true);
    try {
      await Promise.all([loadTree(), new Promise((r) => setTimeout(r, 550))]);
    } finally {
      treeRefreshingRef.current = false;
      setTreeRefreshing(false);
    }
  }, [loadTree]);

  // Backstop for the desktop sidecar: re-list the tree whenever the window
  // regains focus. The fs-watch → canvas-list-update auto-refresh can drop
  // events in a `bun --compile` standalone binary (recursive fs.watch is
  // unreliable there) and across a sidecar respawn / WS reconnect, leaving a
  // stale tree after a canvas was created from the ACP chat or a terminal.
  // `/_index-data` is a cheap read and people tab away to the agent and back, so
  // this turns "switch projects to force a refresh" into "just come back to the
  // window". Debounced so a rapid blur/focus burst coalesces to one re-read.
  useEffect(() => {
    let t = null;
    const onFocus = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        reloadTree();
      }, 150);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      if (t) clearTimeout(t);
    };
  }, [reloadTree]);

  // Phase 22 — create a blank brief board from the tree header. POSTs to the
  // main-origin-only /_api/canvas (the untrusted canvas iframe can't reach it),
  // then refreshes the tree and opens the new board so it's immediately the
  // active canvas to annotate. Returns {ok} | {ok:false,error} so the Sidebar
  // can surface a validation/duplicate message inline.
  const createBoard = useCallback(
    async (name) => {
      try {
        const r = await fetch('/_api/canvas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, kind: 'brief-board' }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) return { ok: false, error: j.error || `create failed (${r.status})` };
        await loadTree();
        openTab(j.file);
        return { ok: true, file: j.file };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'network error' };
      }
    },
    [loadTree, openTab]
  );

  // Task 20 (enhanced-video-editing) — greenfield "New video": an EMPTY
  // video-comp canvas (drop-first cut building). Dimensions/fps are
  // user-settable (presets 1920×1080 / 1080×1920 / 1080×1080 or custom WxH).
  const createVideo = useCallback(async () => {
    const name = await askText('New video name');
    if (!name) return;
    const dims =
      (await askText(
        'Size — 1920x1080 (landscape), 1080x1920 (portrait), 1080x1080 (square), or custom WxH',
        '1920x1080'
      )) || '1920x1080';
    const m = dims.toLowerCase().match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/);
    const width = m ? Number(m[1]) : 1920;
    const height = m ? Number(m[2]) : 1080;
    const fps = Math.max(1, Math.min(60, Number(await askText('Frames per second', '30')) || 30));
    try {
      const r = await fetch('/_api/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind: 'video-comp', clips: [], fps, width, height }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        shellToast(`New video failed: ${j.error || `error ${r.status}`}`);
        return;
      }
      await loadTree();
      openTab(j.file);
      setTimelineOpen(true);
      shellToast('New video created — drop clips on the timeline to start the cut.', true);
    } catch (e) {
      shellToast(`New video failed: ${e instanceof Error ? e.message : 'network error'}`);
    }
  }, [loadTree, openTab, askText]);

  // DDR-150 P4 Task 12 — one-click "udělej z toho video". Reads the ACTIVE
  // canvas's annotation sidecar (main-origin — no cross-origin round-trip),
  // gathers every dropped media-reference chip's src in document order, and POSTs
  // an assembled video-comp (kind: 'video-comp') → opens the new, immediately
  // hand-editable comp. Durations default server-side to fps*3 (the user trims on
  // the Timeline); client-side <video>.duration probing is a documented tightening.
  const assembleVideo = useCallback(async () => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    try {
      const ar = await fetch(`/_api/annotations?file=${encodeURIComponent(activePath)}`);
      const svg = ar.ok ? await ar.text() : '';
      const clips = [];
      if (svg) {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        for (const g of doc.querySelectorAll('[data-tool="mediaref"]')) {
          const src = g.getAttribute('data-src');
          if (!src) continue;
          clips.push({ src, mediaKind: g.getAttribute('data-media-kind') === 'audio' ? 'audio' : 'video' });
        }
      }
      if (clips.length === 0) {
        window.alert('Drop video/audio clips on the canvas first, then assemble them into a video.');
        return;
      }
      const baseName = displayName(basename(activePath)).replace(/\.tsx$/i, '');
      const name = `${baseName} Video`;
      const r = await fetch('/_api/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind: 'video-comp', clips }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        window.alert(`Assemble failed: ${j.error || `error ${r.status}`}`);
        return;
      }
      await loadTree();
      openTab(j.file);
    } catch (e) {
      window.alert(`Assemble failed: ${e instanceof Error ? e.message : 'network error'}`);
    }
  }, [activePath, loadTree, openTab]);

  // DDR-150 dogfood #5 — shared replace-media flow, PICKER-FIRST. The <input
  // type=file> is created + clicked SYNCHRONOUSLY inside the caller's click
  // gesture (browsers revoke transient user-activation after any await, which is
  // why the old fetch-then-click never opened the dialog). The comp-clips lookup
  // + upload + src patch all happen in the change handler, where no activation
  // is needed. `resolveCdId(cc)` maps the fresh enumerator payload to the target
  // media target (sequence clip via cd-id, audio bed via cd-id, or a showreel
  // array-fed src via mediaArrayRef → /_api/edit-array-src). `resolveTarget(cc)`
  // returns { cdId } | { arrayRef } | null.
  const replaceMediaViaPicker = useCallback(
    ({ accept, resolveTarget }) => {
      const canvas = activePath;
      const artboardId = timelineArtboardId || undefined;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      // OFF-SCREEN, not display:none — the native desktop app (Tauri WKWebView)
      // will NOT present the file panel for a `display:none` input (it must be
      // laid out). Off-screen + transparent works in both WKWebView and browsers
      // (dogfood: "replace ... nefunguje ale v desktop app"). Guard against a
      // cancelled dialog leaking the node with a one-shot focus cleanup.
      input.style.cssText =
        'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(input);
      const cleanup = () => {
        if (input.isConnected) input.remove();
      };
      // If the user cancels the panel, `change` never fires — reclaim the node
      // when focus returns to the window (fires on both pick and cancel).
      window.addEventListener('focus', () => setTimeout(cleanup, 300), { once: true });
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        cleanup();
        if (!file) return;
        const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
        fetch(ccUrl)
          .then((r) => r.json().catch(() => ({})))
          .then((cc) => {
            const target = resolveTarget(cc);
            if (!target) {
              shellToast('No replaceable media here (its src is computed) — edit via chat.');
              return null;
            }
            return fetch('/_api/asset', {
              method: 'POST',
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
              body: file,
            })
              .then((r) => r.json().catch(() => ({})))
              .then((up) => {
                if (!up?.path) {
                  shellToast(`Upload failed: ${up?.error || 'unknown error'}`);
                  return null;
                }
                if (target.arrayRef) {
                  // Showreel pattern: the src lives in an array literal.
                  return fetch('/_api/edit-array-src', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      canvas,
                      arrayName: target.arrayRef.arrayName,
                      index: target.arrayRef.index,
                      field: target.arrayRef.field,
                      value: up.path,
                    }),
                  });
                }
                return fetch('/_api/edit-attr', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ canvas, id: target.cdId, attr: 'src', value: up.path }),
                });
              });
          })
          .then((r) => (r ? r.json() : null))
          .then((j) => {
            if (j && !j.ok) shellToast(`Replace refused: ${j.error || 'failed'}`);
            else if (j && j.ok) {
              shellToast('Media replaced.', true);
              if (j.seq != null) pushTlUndo(canvas, j.seq, 'replace media');
            }
          })
          .catch(() => shellToast('Replace failed: network error'));
      });
      input.click();
    },
    [activePath, timelineArtboardId, pushTlUndo]
  );

  // Phase 22 — soft-delete a canvas from the file tree. Confirms (destructive),
  // DELETEs to the main-origin-only endpoint, refreshes the tree, and resets the
  // active tab if the deleted canvas was open. The server moves the whole sidecar
  // set to .design/_trash/ — recoverable locally.
  const deleteBoard = useCallback(
    async (filePath, label) => {
      const ok = window.confirm(
        `Move “${label}” to trash?\n\nIts annotations, history and comments move with it. ` +
          `You can restore it from .design/_trash/.`
      );
      if (!ok) return;
      try {
        const r = await fetch(`/_api/canvas?file=${encodeURIComponent(filePath)}`, {
          method: 'DELETE',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          window.alert(`Could not delete: ${j.error || `error ${r.status}`}`);
          return;
        }
        await loadTree();
        if (activePath === filePath) {
          setTabs([]);
          setActivePath(null);
        }
      } catch (e) {
        window.alert(`Delete failed: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [loadTree, activePath]
  );

  // feature-file-tree-drag-drop-folders (Task 8/10) — drag-drop AND the
  // context-menu "Move to…" both funnel through this one function. POSTs the
  // main-origin-only /_api/fs-move, then (only AFTER the server ack — no
  // optimistic UI, per rca/issue-canvas-hmr-optimistic-update-consistency)
  // reloads the tree and retargets any open tab / the active path so a
  // dragged-and-open canvas doesn't go dead. Toasts with an inverse-move
  // Undo. Named function expression so the Undo click can call itself.
  const moveCanvasReq = useCallback(
    async function moveCanvasReq(fromPath, toDir) {
      try {
        const r = await fetch('/_api/fs-move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: fromPath, toDir }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          shellToast(`Could not move: ${j.error || `error ${r.status}`}`);
          return { ok: false, error: j.error };
        }
        const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(
          /^\/+|\/+$/g,
          ''
        );
        const fromFile = `${designRel}/${j.fromRel}`;
        const toFile = `${designRel}/${j.toRel}`;
        await loadTree();
        setTabs((prev) => prev.map((t) => (t.path === fromFile ? { path: toFile } : t)));
        setActivePath((prev) => (prev === fromFile ? toFile : prev));
        const fromDir = fromFile.split('/').slice(0, -1).join('/');
        shellToast(`Moved to ${j.toRel.split('/').slice(0, -1).join('/') || '.'}`, true, {
          label: 'Undo',
          onClick: () => {
            moveCanvasReq(toFile, fromDir);
          },
        });
        return { ok: true };
      } catch (e) {
        shellToast(`Move failed: ${e instanceof Error ? e.message : 'network error'}`);
        return { ok: false, error: 'network error' };
      }
    },
    [loadTree, cfg]
  );

  // feature-file-tree-drag-drop-folders (Task 4/9/12) — create a folder under
  // `parentDir`. Two callers: the sidebar header composer (name from its own
  // input state) and the tree-row context menu's "New folder here" (name via
  // `window.prompt` — a native, fully keyboard/screen-reader-operable input,
  // so that path doesn't need its own inline composer instance).
  const newFolderReq = useCallback(
    async (parentDir, name) => {
      try {
        const r = await fetch('/_api/fs-mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parent: parentDir, name }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          const error = j.error || `error ${r.status}`;
          shellToast(`Could not create folder: ${error}`);
          return { ok: false, error };
        }
        await loadTree();
        return { ok: true, dir: j.dir };
      } catch (e) {
        const error = e instanceof Error ? e.message : 'network error';
        shellToast(`Create folder failed: ${error}`);
        return { ok: false, error };
      }
    },
    [loadTree]
  );

  // feature-file-tree-drag-drop-folders (dogfood follow-up) — delete a
  // folder from the tree-row context menu. Reuses DELETE /_api/canvas (the
  // route now auto-detects a non-.tsx target as a folder delete); every
  // canvas inside is trashed the same recoverable way as a single-canvas
  // delete (`.design/_trash/<stamp>__<slug>/`).
  const deleteFolderReq = useCallback(
    async (dirPath, label) => {
      const ok = window.confirm(
        `Delete folder "${label}"?\n\nEvery canvas inside moves to trash (recoverable from .design/_trash/); ` +
          `any empty subfolders are removed.`
      );
      if (!ok) return;
      try {
        const r = await fetch(`/_api/canvas?file=${encodeURIComponent(dirPath)}`, {
          method: 'DELETE',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          shellToast(`Could not delete folder: ${j.error || `error ${r.status}`}`);
          return;
        }
        await loadTree();
      } catch (e) {
        shellToast(`Delete folder failed: ${e instanceof Error ? e.message : 'network error'}`);
      }
    },
    [loadTree]
  );

  const clearSelected = useCallback(() => {
    wsSend({ type: 'clear-select' });
    setSelected(null);
    if (activePath && activePath !== SYSTEM_TAB) {
      const el = iframesRef.current.get(activePath);
      if (el && el.contentWindow) {
        try {
          el.contentWindow.postMessage({ dgn: 'force-clear' }, '*');
        } catch {}
      }
    }
  }, [activePath]);

  // ----- Push comments to iframe whenever they change for active file -----
  // Presentation Mode hides comment pins: post an empty list while present
  // (re-posting the real list on exit, since this effect re-runs on the flag).
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    const el = iframesRef.current.get(activePath);
    if (!el || !el.contentWindow) return;
    const list = presentMode ? [] : commentsByFile[activePath] || [];
    try {
      el.contentWindow.postMessage({ dgn: 'comments-set', comments: list }, '*');
    } catch {}
  }, [activePath, commentsByFile, presentMode]);

  // ----- Inbound messages from iframes -----
  useEffect(() => {
    // Does this comment id belong to the canvas the user is actually looking
    // at? Scopes the patch/delete relays below — see the SECURITY note there.
    //
    // The leading `!!activePath` is load-bearing, not defensive noise: with no
    // active canvas the branches' `activeWin` is `null`, and `e.source` is also
    // `null` for a message whose source context was discarded before dispatch —
    // so `e.source === activeWin` can pass as `null === null`. This is the
    // second conjunct that closes that path. Don't "simplify" it away.
    const ownsActiveComment = (id) =>
      !!activePath && (commentsByFile[activePath] || []).some((c) => c && c.id === id);
    function onMessage(e) {
      // Cross-origin hardening (DDR-054): only accept dgn control messages from
      // the canvas-content origin — the split origin when on, else our own origin
      // for the same-origin iframe. Drops spoofed messages from any other window.
      // Every canvas iframe shares that origin, so the check below proves only
      // "a canvas said this", NOT "the canvas the user is looking at said it" —
      // each mutating branch additionally gates on `e.source === activeWin`.
      const expectedOrigin = cfg?.canvasOrigin || window.location.origin;
      if (e.origin !== expectedOrigin) return;
      const m = e.data;
      if (!m || typeof m !== 'object' || !m.dgn) return;
      if (m.dgn === 'canvas-notice') {
        const activeWin = activePath && activePath !== SYSTEM_TAB
          ? iframesRef.current.get(activePath)?.contentWindow : null;
        const notice = acceptCanvasNotice(e, expectedOrigin, activeWin);
        if (notice) notifyCanvasText(notice.title, notice.kind);
        return;
      }
      if (m.dgn === 'tool-cursor') {
        // Phase 24 — show the active canvas tool's cursor across the WHOLE app
        // shell (sidebar, top bar, everything) so the custom cursor is visible
        // everywhere in maude, not just inside the canvas iframe. The canvas
        // sends only a tool TOKEN; we resolve it to a cursor string from our own
        // trusted map (resolveToolCursor) and apply THAT — never a raw
        // canvas-supplied value. A malicious synced canvas (DDR-054) can thus
        // only pick a known, always-visible glyph; it cannot inject an
        // invisible/displaced SVG cursor as a clickjacking aid over the un-CSP'd
        // shell (phase-24 ethical-hacker Finding 2; DDR-067).
        // feature-4 — the browse tool is a pure pass-through: don't force a
        // global shell cursor, so the shell chrome keeps its own affordance
        // cursors (pointer over buttons). Also fire the one-time "press V" hint
        // — a live canvas booting in browse is exactly when it's teachable.
        if (m.tool === 'browse') {
          document.body.style.cursor = '';
          const el = document.getElementById('dc-app-cursor');
          if (el) el.textContent = '';
          browseFirstRunHint(viewerMode);
          return;
        }
        const cursor = resolveToolCursor(m.tool);
        if (cursor) {
          document.body.style.cursor = cursor;
          let el = document.getElementById('dc-app-cursor');
          if (!el) {
            el = document.createElement('style');
            el.id = 'dc-app-cursor';
            document.head.appendChild(el);
          }
          el.textContent = `* { cursor: ${cursor} !important; }`;
        }
        return;
      }
      // SECURITY (attacker Finding 2, mirrors the phase-28 F-2 reorder/present
      // gate at the handlers below): selection posts are honored ONLY from the
      // ACTIVE canvas's window. Every open canvas iframe shares one
      // `canvasOrigin`, so the origin check above can't tell the foreground
      // canvas from a background/synced one — and a selection carries an
      // attacker-chosen `file` that the server trusts verbatim and write-throughs
      // into the persistent per-canvas `selections` map, then rides into the
      // auto-approving ACP agent's frozen context. A background (untrusted, DDR-054)
      // canvas must not be able to plant a selection with no user gesture. The
      // user can only click the visible active canvas, so a non-active source is
      // never a legitimate selection.
      //
      // The SAME gate now covers the privileged SOURCE-WRITE relays — `edit-text`
      // (inline text commit) and `apply-edit` (undo/redo re-application). Both
      // ride into a main-origin `.tsx` rewrite; a write path is strictly more
      // dangerous than a selection, yet was previously ungated (ethical-hacker
      // F-B, DDR-160 follow-up). A background/synced untrusted canvas (DDR-054)
      // must not drive a gestureless write into another canvas — and inline edits
      // + Cmd+Z always originate in the ACTIVE canvas the user is looking at, so
      // a non-active source is never legitimate here either.
      if (
        m.dgn === 'select' ||
        m.dgn === 'select-set' ||
        m.dgn === 'clear-select' ||
        m.dgn === 'edit-text' ||
        m.dgn === 'apply-edit'
      ) {
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
      }
      if (m.dgn === 'select' && m.selection) {
        setPhotoSel(null); // a DOM selection supersedes an annotation-image Photo target
        lastLocalSelectAtRef.current = Date.now();
        wsSend({ type: 'select', selection: m.selection });
        setSelected(m.selection);
        maybeAutoOpenInspectorOnSelect(m.selection); // Stage C
      } else if (m.dgn === 'select-set') {
        setPhotoSel(null);
        lastLocalSelectAtRef.current = Date.now();
        // Canvas multi-select. Payload shape:
        //   null              → empty selection
        //   Selection         → length-1 (back-compat with legacy single-element shape)
        //   Selection[]       → N > 1
        // For shell purposes we track the focused entry (head of array, or
        // the bare object) — comments + halo only act on one element at a
        // time today. Multi-target editing is an explicit Phase-4.1 non-goal.
        const payload = m.selection;
        if (payload == null) {
          wsSend({ type: 'clear-select' });
          setSelected(null);
        } else if (Array.isArray(payload)) {
          const head = payload[0] ?? null;
          if (head) wsSend({ type: 'select', selection: head });
          setSelected(head);
          // Stage C — auto-open only for a genuine SINGLE selection, never multi.
          if (payload.length === 1) maybeAutoOpenInspectorOnSelect(head);
        } else {
          wsSend({ type: 'select', selection: payload });
          setSelected(payload);
          maybeAutoOpenInspectorOnSelect(payload); // Stage C
        }
      } else if (m.dgn === 'clear-select') {
        setPhotoSel(null);
        lastLocalSelectAtRef.current = Date.now();
        wsSend({ type: 'clear-select' });
        setSelected(null);
      } else if (m.dgn === 'edit-text' && m.id) {
        // Phase 12 (DDR-103) — inline text edit committed in the canvas. POST to
        // the main-origin-only /_api/edit-text → editText writes the escaped
        // JSXText to source; the file-watcher HMR reload then shows the new text.
        // DDR-150 P1: a refusal is NO LONGER silent — post `edit-reverted` back
        // to the canvas, which reverts the optimistic contenteditable text AND
        // toasts the reason, so a failed edit can't silently vanish on the next
        // reload ("my text edit didn't stick"). The user-facing toast lives
        // canvas-side (showCanvasToast) because App has no in-scope status
        // surface — `setStatus` belongs to ExportDialog, not App.
        const editSource = e.source;
        const revert = (reason) => {
          try {
            editSource?.postMessage({ dgn: 'edit-reverted', op: 'text', id: m.id, reason }, '*');
          } catch {}
        };
        fetch('/_api/edit-text', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            canvas: m.file,
            id: m.id,
            text: m.text ?? '',
            // Context for editing `{variable}` text — which rendered instance +
            // its pre-edit text, so the engine targets the right source string.
            ...(typeof m.occurrence === 'number' ? { occurrence: m.occurrence } : {}),
            ...(typeof m.before === 'string' ? { before: m.before } : {}),
          }),
        })
          .then((r) => r.json().catch(() => ({})))
          .then((j) => {
            if (!j.ok) revert(j.error || "this element can't be edited inline");
          })
          .catch(() => revert('network error'));
      } else if (m.dgn === 'apply-edit' && m.id && (m.op === 'css' || m.op === 'text' || m.op === 'attr')) {
        // Inline-edit undo/redo (DDR-103/104 follow-up). The canvas iframe's
        // `edit-source` command can't call the main-origin-only `/_api/edit-*`
        // routes (DDR-054), so it asks us to re-apply the before/after value.
        // `value` null = reset (remove the inline prop / attr). For CSS we also
        // optimistically repaint so the revert shows before the HMR reload.
        const op = m.op;
        const value = typeof m.value === 'string' ? m.value : null;
        let url;
        let body;
        if (op === 'css') {
          url = '/_api/edit-css';
          body =
            value == null
              ? { canvas: m.canvas, id: m.id, property: m.key, reset: true }
              : { canvas: m.canvas, id: m.id, property: m.key, value };
          applyOptimisticStyle({ id: m.id, prop: m.key, value });
        } else if (op === 'attr') {
          url = '/_api/edit-attr';
          body =
            value == null
              ? { canvas: m.canvas, id: m.id, attr: m.key, reset: true }
              : { canvas: m.canvas, id: m.id, attr: m.key, value };
        } else {
          url = '/_api/edit-text';
          body = { canvas: m.canvas, id: m.id, text: value ?? '' };
          // Undo/redo of a `{variable}` text edit needs to re-target the source
          // string: the occurrence + the value currently on disk (`from` — the
          // side we're replacing FROM). Harmless for literal text.
          if (typeof m.occurrence === 'number') body.occurrence = m.occurrence;
          if (typeof m.from === 'string') body.before = m.from;
        }
        editApplyChainRef.current = editApplyChainRef.current
          .catch(() => {})
          .then(() =>
            fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
              .then((r) => r.json().catch(() => ({})))
              .then((j) => {
                // Undo/redo lane (Cmd+Z/Cmd+Shift+Z re-application). The primary
                // edit-text lane above owns the user-facing revert + toast; a
                // refusal here is logged. (DDR-150 P1 kept this a warn after the
                // setStatus-scope fix — setStatus is not in App's scope.)
                if (!j.ok) console.warn('[apply-edit]', op, j.error || 'failed');
              })
              .catch(() => {})
          );
      } else if (m.dgn === 'layers-tree') {
        // Phase 12 Task 4 — browsable layers tree for the active artboard.
        setLayersTree({ artboardId: m.artboardId, nodes: Array.isArray(m.tree) ? m.tree : [] });
        // fresh tree (correct ids) landed — drags OK again
        layersBusyRef.current = false;
        if (layersBusyTimerRef.current) {
          clearTimeout(layersBusyTimerRef.current);
          layersBusyTimerRef.current = null;
        }
        // Phase 12.1 — a reorder writes source → SOFT HMR (no dgn:'loaded' fires,
        // so the loaded-handler re-select never runs). The live observer's fresh
        // tree is our signal instead: re-select the moved element by its NEW
        // positional id (movedId) so the selection halo + the keyboard cursor
        // follow it. Without this the next Alt+arrow acts on the STALE id, which
        // positionally now points at a different element. Only act once the tree
        // actually CONTAINS movedId — an in-canvas drag posts a PREVIEW tree
        // first (old ids, pre-write); consuming then would re-select nothing and
        // burn the pending ref before the real post-HMR tree lands.
        const pend = pendingReorderRef.current;
        if (pend && pend.movedId) {
          const has = (function find(nodes) {
            return (nodes || []).some((n) => n.id === pend.movedId || find(n.children));
          })(m.tree);
          if (has) {
            pendingReorderRef.current = null;
            const win = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
            if (win) {
              try {
                win.postMessage(
                  { dgn: 'select-by-id', id: pend.movedId, artboardId: m.artboardId ?? null, index: 0 },
                  '*'
                );
              } catch {}
            }
          }
        }
      } else if (m.dgn === 'reorder-revert') {
        // Phase 12.1 follow-up — Cmd+Z/Cmd+Shift+Z on a reorder. The canvas undo
        // stack (untrusted iframe) can't reach the main-origin-only
        // /_api/reorder-revert, so it REQUESTS; the shell writes. Active canvas
        // only. SECURITY (adversarial F4): pin the target to `activePath` — do NOT
        // forward m.canvas (an untrusted iframe could name a different canvas); the
        // undo stack is per active canvas anyway, and the server's seq→entry.abs +
        // 409 content-match are the backstop.
        const rvWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const rvShape = typeof m.seq === 'number' && (m.dir === 'undo' || m.dir === 'redo');
        if (e.source === rvWin && rvShape && activePath) {
          layersBusyRef.current = true;
          if (layersBusyTimerRef.current) clearTimeout(layersBusyTimerRef.current);
          layersBusyTimerRef.current = setTimeout(() => {
            layersBusyRef.current = false;
            layersBusyTimerRef.current = null;
          }, 700);
          fetch('/_api/reorder-revert', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ canvas: activePath, seq: m.seq, dir: m.dir }),
          })
            .then((r) => r.json().catch(() => ({})))
            .then((j) => {
              if (!j.ok) console.warn('[reorder-revert]', j.error || 'failed');
            })
            .catch(() => {});
        }
      } else if (m.dgn === 'reorder-request') {
        // Phase 12.1 (DDR-138) — the in-canvas ReorderGrip (untrusted canvas
        // iframe) can't reach the main-origin-only /_api/reorder (DDR-054), so it
        // REQUESTS a move; the shell performs the privileged write via reorderLayer
        // (same lane as edit-text → /_api/edit-text). Honor it ONLY from the ACTIVE
        // canvas (a background tab's untrusted canvas must not mutate source), and
        // only for well-formed ids/position (reorderLayer + the server re-validate).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.id === 'string' &&
          typeof m.refId === 'string' &&
          (m.position === 'before' ||
            m.position === 'after' ||
            m.position === 'inside-start' ||
            m.position === 'inside-end');
        if (e.source === activeWin && okShape) {
          reorderLayerRef.current?.(m.id, m.refId, m.position, {
            idIndex: Number.isInteger(m.idIndex) ? m.idIndex : undefined,
            refIndex: Number.isInteger(m.refIndex) ? m.refIndex : undefined,
          });
        }
      } else if (m.dgn === 'reposition-request') {
        // Free-XY reposition for out-of-flow elements (position:absolute/
        // fixed) — the in-canvas drag switches from reorder-mode to
        // coordinate-mode when the dragged element is out of flow, because
        // reordering an absolute/fixed element's JSX siblings never changes
        // where it paints (the "moves then snaps back" RCA). Same trust
        // model + confused-deputy guard as reorder-request: untrusted canvas
        // REQUESTS, shell WRITES, pinned to the ACTIVE canvas (never
        // `m.canvas`, which an untrusted iframe could spoof).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.id === 'string' &&
          Number.isFinite(m.left) &&
          Number.isFinite(m.top) &&
          Number.isFinite(m.beforeLeft) &&
          Number.isFinite(m.beforeTop);
        if (e.source === activeWin && okShape) {
          repositionElementRef.current?.(
            m.id,
            m.left,
            m.top,
            m.beforeLeft,
            m.beforeTop,
            Number.isInteger(m.idIndex) ? m.idIndex : undefined
          );
        }
      } else if (m.dgn === 'resize-request') {
        // feature-element-editing-robustness Stage D — in-canvas drag-resize
        // commit. Same trust model + confused-deputy guard as reposition-request:
        // untrusted canvas REQUESTS, shell WRITES, pinned to the ACTIVE canvas
        // (never `m.canvas`). Payload: { id, patch:{width,height,left?,top?},
        // before:{width,height,left,top} } — px strings, before values null when
        // the prop was unset (reset on undo).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.id === 'string' && m.patch && typeof m.patch === 'object';
        if (e.source === activeWin && okShape) {
          resizeElementRef.current?.(
            m.id,
            m.patch,
            m.before,
            Number.isInteger(m.idIndex) ? m.idIndex : undefined
          );
        }
      } else if (m.dgn === 'delete-request') {
        // feature-element-editing-robustness Stage I — delete an element (Del key
        // / context menu / toolbar in the canvas). Same confused-deputy guard as
        // reorder/reposition/resize: untrusted canvas REQUESTS, shell WRITES,
        // pinned to the ACTIVE canvas (never `m.canvas`).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') {
          deleteElementShellRef.current?.(m.id, Number.isInteger(m.idIndex) ? m.idIndex : undefined);
        }
      } else if (m.dgn === 'duplicate-request') {
        // Cmd+D (Task L3) — duplicate the selected element. Confused-deputy gated
        // + pinned to the active canvas, like the other structural verbs.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') {
          duplicateElementShellRef.current?.(
            m.id,
            Number.isInteger(m.idIndex) ? m.idIndex : undefined
          );
        }
      } else if (m.dgn === 'copy-style') {
        // Task L4 — capture the current selection's authored style (shell-side).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) copyStyleRef.current?.();
      } else if (m.dgn === 'paste-style') {
        // Task L4 — apply the copied style to the target element.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') pasteStyleRef.current?.(m.id);
      } else if (m.dgn === 'insert-request') {
        // Stage I3 — insert a synthesized div/text/image relative to `refId`,
        // OR — empty-artboard fallback (tool-palette "+ Element" on a fresh
        // artboard with no elements yet) — as a child of `artboardId`. Exactly
        // one of the two must be present; the artboardId variant only makes
        // sense inside-start/inside-end (no sibling to be before/after).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const hasRefId = typeof m.refId === 'string';
        const hasArtboardId = typeof m.artboardId === 'string';
        const okPosition =
          m.position === 'before' ||
          m.position === 'after' ||
          m.position === 'inside-start' ||
          m.position === 'inside-end';
        const okShape =
          hasRefId !== hasArtboardId &&
          (m.kind === 'div' || m.kind === 'text' || m.kind === 'image') &&
          okPosition &&
          (!hasArtboardId || m.position === 'inside-start' || m.position === 'inside-end');
        if (e.source === activeWin && okShape) {
          insertElementShellRef.current?.(m.refId, m.position, m.kind, {
            artboardId: hasArtboardId ? m.artboardId : undefined,
            src: typeof m.src === 'string' ? m.src : undefined,
            refIndex: Number.isInteger(m.refIndex) ? m.refIndex : undefined,
          });
        }
      } else if (m.dgn === 'insert-image-request') {
        // Stage F/I3 — "Insert ▸ Image" from the canvas context menu, or the
        // tool-palette's Image tool (`artboardId` in place of `refId` for its
        // empty-artboard fallback, or NEITHER when the canvas has no artboard
        // at all — feature-bulk-media-insert). An image needs a contained
        // asset src, so the shell opens the AssetPicker in bulk mode; the
        // confirm then drives insertElementShell(kind:'image') per path (Task
        // 10) or a single batched annotation insert. Confused-deputy gated +
        // pinned to the active canvas like the other request verbs.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const hasRefId = typeof m.refId === 'string';
        const hasArtboardId = typeof m.artboardId === 'string';
        const noAnchor = !hasRefId && !hasArtboardId;
        const okShape =
          (hasRefId !== hasArtboardId || noAnchor) &&
          (noAnchor ||
            m.position === 'before' ||
            m.position === 'after' ||
            m.position === 'inside-start' ||
            m.position === 'inside-end') &&
          (!hasArtboardId || m.position === 'inside-start' || m.position === 'inside-end');
        if (e.source === activeWin && okShape) {
          openAssetPickerRef.current?.({
            purpose: 'insert-image',
            canvas: activePath,
            refId: m.refId,
            artboardId: hasArtboardId ? m.artboardId : undefined,
            position: noAnchor ? undefined : m.position,
            refIndex: Number.isInteger(m.refIndex) ? m.refIndex : undefined,
            multiple: true,
            // Artboard destination is possible whenever there's ANY resolvable
            // anchor — a refId (context-menu, or the tool-palette's normal
            // last-element case) inserts inside the SAME artboard that
            // element already lives in, not just the artboardId fallback.
            hasArtboardAnchor: !noAnchor,
          });
        }
      } else if (m.dgn === 'replace-media-request') {
        // Stage F2 — "Replace image…" from the canvas context menu. Opens the
        // AssetPicker in replace mode; the pick re-points src via edit-attr. The
        // context menu supplies the current src as the undo before-value.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') {
          openAssetPickerRef.current?.({
            purpose: 'replace-src',
            canvas: activePath,
            id: m.id,
            before: typeof m.before === 'string' ? m.before : null,
          });
        }
      } else if (m.dgn === 'convert-to-absolute-request') {
        // feature-4 T8 (convert-to-absolute, DDR-188) — the canvas measured the
        // frozen child boxes; perform the main-origin batch write (ONE undo
        // seq via structuralWrite). The server re-validates every field; here we
        // just confused-deputy-guard the source (DDR-054) + a light shape check.
        // Two shapes: single-container (element context menu) or `containers`
        // batch (the artboard-level "Convert layout to absolute").
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const isBatch = Array.isArray(m.containers) && m.containers.length > 0;
        const isSingle =
          typeof m.containerId === 'string' && Array.isArray(m.children) && m.children.length > 0;
        if (e.source === activeWin && (isBatch || isSingle)) {
          const count = isBatch
            ? m.containers.reduce(
                (n, c) => n + (Array.isArray(c?.children) ? c.children.length : 0),
                0
              )
            : m.children.length;
          structuralWriteRef.current?.(
            '/_api/convert-to-absolute',
            isBatch
              ? {
                  allowShared: m.allowShared === true,
                  containers: m.containers,
                  // feature-4 TRUE FLATTEN — unstyled layout wrappers to remove.
                  ...(Array.isArray(m.dissolve) && m.dissolve.length > 0
                    ? { dissolve: m.dissolve }
                    : {}),
                }
              : {
                  containerId: m.containerId,
                  containerSetRelative: m.containerSetRelative === true,
                  // feature-4 T8b — the canvas asked the user's confirm already;
                  // the server still refuses `.map` children regardless.
                  allowShared: m.allowShared === true,
                  children: m.children,
                },
            {
              label: 'convert to absolute',
              // Dogfood 2026-07-19 — the conversion is zero-visual-delta by
              // design, which LOOKED like "nic nedělá". Say what happened, and
              // surface server refusals (.map children etc.) as a toast
              // instead of a console.warn nobody sees.
              onOk: () => {
                postToActiveCanvas({ dgn: 'selection-clear' });
                postToActiveCanvas({
                  dgn: 'op-toast',
                  message: `Converted ${count} element${count === 1 ? '' : 's'} to absolute — press V and drag them freely (⌘Z to undo).`,
                });
              },
              onFail: (j) =>
                postToActiveCanvas({
                  dgn: 'op-toast',
                  message: `Convert failed: ${j?.error || 'unknown error'}`,
                }),
            }
          );
        }
      } else if (m.dgn === 'replace-annotation-media-request') {
        // Stage F3 — "Replace…" on an annotation ImageStroke/MediaRefStroke.
        // Opens the SAME AssetPicker; unlike F2 the pick is posted BACK DOWN to
        // the canvas (no data-cd-id to ride edit-attr — the annotation model owns
        // its own strokes, so the canvas iframe performs the write itself).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') {
          openAssetPickerRef.current?.({
            purpose: 'replace-annotation-media',
            canvas: activePath,
            id: m.id,
            before: typeof m.before === 'string' ? m.before : null,
          });
        }
      } else if (m.dgn === 'edit-annotation-photo-request') {
        // feature-photo-editor (Task 17) — "Edit Photo…" on an annotation
        // ImageStroke. The annotation model has no data-cd-id / DOM selection, so
        // it can't ride the normal select path; instead the canvas posts its
        // `assets/<sha8>.<ext>` href up and the shell opens the Photo-only tab on
        // it. Same confused-deputy gate (DDR-054) + active-canvas pin as F3.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const asset = PHOTO_ASSET_RE.exec(typeof m.asset === 'string' ? m.asset : '')?.[0] || null;
        if (e.source === activeWin && typeof m.id === 'string' && asset) {
          setPhotoSel({ asset, strokeId: m.id });
          openRightPanel('inspector');
          setInspectorTab('photo');
        }
      } else if (m.dgn === 'open-sticker-picker') {
        // Phase 4 (whiteboard-improvements) — the toolbar's Stickers button.
        // Confused-deputy gated + pinned to the active canvas like the other
        // request verbs above.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) {
          openStickerPickerRef.current?.({ canvas: activePath });
        }
      } else if (m.dgn === 'insert-artboard-request') {
        // Stage I4 — insert a new empty artboard from a screen-size preset.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.id === 'string' &&
          Number.isFinite(m.width) &&
          Number.isFinite(m.height);
        if (e.source === activeWin && okShape) {
          insertArtboardShellRef.current?.({
            id: m.id,
            label: typeof m.label === 'string' ? m.label : m.id,
            width: m.width,
            height: m.height,
          });
        }
      } else if (m.dgn === 'resize-artboard-request') {
        // Stage D4 — free-hand artboard resize (numeric width/height props).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.artboardId === 'string' &&
          (Number.isFinite(m.width) || Number.isFinite(m.height));
        if (e.source === activeWin && okShape) {
          resizeArtboardShellRef.current?.(
            m.artboardId,
            Number.isFinite(m.width) ? m.width : undefined,
            Number.isFinite(m.height) ? m.height : undefined
          );
        }
      } else if (m.dgn === 'delete-artboard-request') {
        // Backspace / context-menu delete of a whole artboard (by its id prop).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.artboardId === 'string') {
          deleteArtboardShellRef.current?.(m.artboardId);
        }
      } else if (m.dgn === 'set-artboard-kind-request') {
        // feature-1-artboard-kinds-foundation, T8 — context-menu "Artboard
        // kind" submenu (inside the untrusted iframe). `kind: null` clears
        // back to the implicit default.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okKind = m.kind === null || typeof m.kind === 'string';
        if (e.source === activeWin && typeof m.artboardId === 'string' && okKind) {
          // Dogfood round 6 — DIRECT write, never back into the ask flow (the
          // ask lives shell-side in setArtboardKindShell; re-entering it from
          // this canvas round-trip looped the confirm dialog forever).
          directArtboardKindWriteRef.current?.(m.artboardId, m.kind);
        }
      } else if (m.dgn === 'duplicate-artboard-request') {
        // feature-3-web-artboards T3 — context-menu "Duplicate at width…"
        // submenu (inside the untrusted iframe).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.artboardId === 'string' && Number.isFinite(m.width)) {
          duplicateArtboardShellRef.current?.(m.artboardId, m.width);
        }
      } else if (m.dgn === 'open-inspector') {
        // Phase 12 — context-menu "Inspect" / tool-palette Inspect opens the right panel.
        // feature-photo-editor (Task 16) — an optional `tab` lands the panel on a
        // specific tab (the element "Edit Photo…" entry passes `tab: 'photo'`; the
        // img is already selected via select-set, so the Photo tab derives its
        // target from that selection's `photoAsset`).
        openRightPanel('inspector');
        if (typeof m.tab === 'string') setInspectorTab(m.tab);
      } else if (m.dgn === 'present-enter') {
        // Canvas tool-palette "Presentation mode" button — Present Mode is a
        // shell-level state (hides the menubar / sidebar / panels), so the
        // canvas requests it here and the shell flips it on + broadcasts
        // dgn:'view-chrome' back to every iframe. Enter-only (the palette is
        // hidden while presenting); exit is Esc or the floating pill. The
        // inbound origin gate above (DDR-054) already authenticates the canvas.
        // Hardening (phase-28 audit F-2): honor it ONLY from the ACTIVE canvas
        // (a background tab's untrusted canvas must not flip the foreground),
        // and NEVER while a modal dialog is open — present mode hides Sidebar-
        // descendant modals (OAuth device-code / Share-invite), so an untrusted
        // canvas could otherwise blank an in-flight confirmation.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const modalOpen = !!document.querySelector('[role="dialog"][aria-modal="true"]');
        if (e.source === activeWin && !modalOpen && !presentMode) {
          setPresentMode(true);
          broadcastChrome({ present: true });
        }
      } else if (m.dgn === 'comment-compose' && m.selection) {
        // Phase 6 — the iframe overlay owns the composer surface now. The
        // shell just mirrors `selected` so the StatusBar / sidebar still
        // reflect the target, and skips the legacy `startDraftFor` path that
        // opened the shell-side composer. Legacy `.html` mocks (no
        // canvas-shell mount) fall through to the same path; they lose the
        // shell composer in this phase. Acceptable per Phase 6 scope.
        setSelected(m.selection);
      } else if (m.dgn === 'comment-submit' && m.payload && typeof m.payload.text === 'string') {
        // Phase 6 — iframe overlay finished composing. Relay through the
        // existing WS `comments-add` channel; server-side persistence +
        // broadcast back are identical to the legacy shell-composer flow.
        //
        // SECURITY — gated on `activeWin` and PINNED to `activePath`, the same
        // shape as every other mutating branch in this handler. The origin
        // check at the top passes for EVERY canvas iframe (they all share
        // `canvasOrigin`), so without this a canvas sitting in a BACKGROUND
        // tab could post comments onto any file it cared to name, with no user
        // gesture. This handler's preamble waived that on the grounds that
        // comments are an "inert store" — the ACP panel's one-click
        // "Implement N comments" action retires that premise, because open
        // comments are now a feed the agent acts on. `p.file` is ignored
        // rather than validated: the active canvas is the only file the user
        // can actually see themselves commenting on.
        const p = m.payload;
        const txt = String(p.text).trim();
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && txt && activePath && activePath !== SYSTEM_TAB) {
          wsSend({
            type: 'comments-add',
            payload: {
              file: activePath,
              selector: p.selector,
              index: p.index,
              dom_path: p.dom_path,
              tag: p.tag,
              classes: p.classes,
              bounds: p.bounds,
              html_excerpt: p.html_excerpt,
              text: txt,
            },
          });
        }
      } else if (m.dgn === 'comment-patch' && m.id && m.patch && typeof m.patch === 'object') {
        // Phase 6 — thread popover routes resolve / reopen through here.
        // SECURITY — same gate as comment-submit, plus an ownership check: a
        // bare id would otherwise reach ANY comment in the project. Patch and
        // delete change or remove somebody else's note, which is exactly why
        // ws.ts refuses both for a viewer session; the iframe lane needs the
        // matching restriction.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && ownsActiveComment(m.id)) {
          wsSend({ type: 'comments-patch', id: m.id, patch: m.patch });
        }
      } else if (m.dgn === 'comment-delete' && m.id) {
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && ownsActiveComment(m.id)) {
          wsSend({ type: 'comments-delete', id: m.id });
          setFocusedCommentId((prev) => (prev === m.id ? null : prev));
        }
      } else if (m.dgn === 'comment-click' && m.id) {
        setFocusedCommentId(m.id);
      } else if (m.dgn === 'artboards' && typeof m.count === 'number') {
        // P2 (Plan C) — optional iframe-reported artboard count; overrides the
        // meta.json-derived seed when the canvas knows better. Clamp.
        const n = Math.round(m.count);
        if (Number.isFinite(n) && n >= 0 && n <= 999) setActiveArtboards(n);
      } else if (m.dgn === 'active-artboard') {
        // DDR-148 — canvas-lib reports the viewport-active artboard on pan. Gate
        // to the ACTIVE canvas window (a background canvas must not hijack the
        // Timeline's target). The Timeline re-parses to this artboard's comp.
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
        // Neutralize + cap exactly like the sibling timeline-comps handler —
        // this id is matched AGAINST that one, so both sides must go through
        // the same normalization or an odd-but-legal id would never match.
        setCanvasActiveArtboard(sanitizeArtboardText(m.id));
      } else if (m.dgn === 'timeline-comps' && Array.isArray(m.comps)) {
        // DDR-148 — a video-comp announces its comp meta (from video-comp.tsx).
        // Gate to the ACTIVE canvas window (phase-28 F-2 pattern): a background
        // canvas must not plant comps into the Timeline panel, which shows the
        // active canvas's comps. Inert display, but keep the seam closed.
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
        const safe = m.comps
          .filter((c) => c && typeof c.id === 'string')
          .slice(0, 32)
          .map((c) => ({
            id: String(c.id).slice(0, 120),
            fps: Math.max(1, Math.min(120, Math.round(Number(c.fps) || 30))),
            durationInFrames: Math.max(1, Math.min(1_000_000, Math.round(Number(c.durationInFrames) || 1))),
            width: Math.max(1, Math.round(Number(c.width) || 0)),
            height: Math.max(1, Math.round(Number(c.height) || 0)),
            // The enclosing artboard (issue #75) — the key the transport target
            // is resolved on, and (the label) shell chrome the user reads. This
            // is untrusted canvas-origin text, so neutralize the bidi/zero-width
            // class HERE, at the boundary, and every downstream consumer
            // inherits a clean value (security-review 2026-08-12).
            artboardId: sanitizeArtboardText(c.artboardId),
            artboardLabel: sanitizeArtboardText(c.artboardLabel),
          }));
        setActiveComps(safe);
        // rca/issue-video-artboard-frame-reset-on-edit — the SAME comp
        // re-announcing means its Player just remounted (an edit-triggered
        // HMR remount, or a ⌘R hard iframe reload that wiped video-comp.tsx's
        // own module-scope frame mirror too). The shell's `timelineFrame`
        // survives either way (this component doesn't remount) — push it back
        // down so the fresh Player opens where the Timeline left off, instead
        // of the poster-frame default. Skip on a genuinely new comp/canvas
        // (no prior id, or frame still at its post-switch 0).
        const prevCompId = timelineCompIdRef.current;
        const stillPresent = prevCompId && safe.some((c) => c.id === prevCompId);
        if (stillPresent && timelineFrameRef.current > 0) {
          postToActiveCanvas({
            dgn: 'timeline-seek',
            frame: timelineFrameRef.current,
            id: prevCompId,
          });
        }
      } else if (m.dgn === 'timeline-frame' && typeof m.frame === 'number') {
        // Live playhead mirror from the Player (preview scrub/playback).
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
        // Only the Timeline's target comp drives the playhead — a sibling
        // artboard's Player must not fight it for the readout (multi-comp canvas).
        if (m.id && timelineCompIdRef.current && m.id !== timelineCompIdRef.current) return;
        if (Number.isFinite(m.frame)) setTimelineFrame(Math.max(0, Math.round(m.frame)));
      } else if (m.dgn === 'timeline-ended') {
        // The Player stopped itself at the last frame (loop off) — resync the
        // shell's Play/Pause button, which otherwise has no way to learn
        // playback ended on its own (rca/issue-video-artboard-loop-defaults-on).
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
        if (m.id && timelineCompIdRef.current && m.id !== timelineCompIdRef.current) return;
        setTimelinePlaying(false);
      } else if (m.dgn === 'toggle-palette') {
        // ⌘K pressed while focus was inside the canvas iframe — the injected
        // inspector forwards the chord here since the iframe's keydown never
        // reaches the shell's window listener. Mirror that handler's toggle.
        setPaletteOpen((v) => !v);
      } else if (m.dgn === 'shell-shortcut') {
        // Same forwarding lane for the other shell chords (inspect.ts) — so
        // ⌘R / ⌘⇧I / ⌘⇧M / ⌘⇧E / ⌘⇧H behave identically wherever focus is.
        //
        // SECURITY — every one of these is a chord the user pressed INSIDE the
        // canvas they are looking at, so it gets the same `activeWin` gate as
        // its siblings. Ungated, a background canvas could reload the active
        // file out from under an edit or pop the Export/Handoff dialog on
        // demand — a modal-timing primitive, and the mirror image of the
        // present-enter branch that was already hardened against modal HIDING.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) {
          if (m.id === 'reload') reloadActive();
          else if (m.id === 'inspector') toggleRightPanel('inspector');
          else if (m.id === 'assistant' && isNativeApp()) toggleRightPanel('assistant');
          else if (m.id === 'comments') toggleRightPanel('comments');
          else if (m.id === 'changes') toggleRightPanel('changes');
          else if (m.id === 'timeline') toggleTimeline();
          else if (m.id === 'export') setExportDialog({ mode: 'export' });
          else if (m.id === 'handoff') setExportDialog({ mode: 'handoff' });
        }
      } else if (m.dgn === 'open-export') {
        // Plan C — the in-canvas toolbar / context menu route here so they open
        // the SAME shell Export dialog as the menubar (one look, all settings).
        // Carry the context-menu's scope hint (e.g. "Export selection").
        //
        // SECURITY — gated with `shell-shortcut` above rather than separately:
        // both reach the same `setExportDialog`, so leaving this one open would
        // hand back the capability the other now refuses.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) {
          setExportDialog({
            mode: 'export',
            scope: m.detail && typeof m.detail.scope === 'string' ? m.detail.scope : undefined,
          });
        }
      } else if (m.dgn === 'open-timeline-request') {
        // Artboard-chrome context menu's "Open Timeline" (video-comp artboards
        // only). Scope the Timeline to the right-clicked artboard, then open it.
        // SECURITY — same class: a context-menu action from the canvas in view.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) {
          if (typeof m.artboardId === 'string') setCanvasActiveArtboard(m.artboardId.slice(0, 120));
          setTimelineOpen(true);
        }
      } else if (m.dgn === 'loaded' && m.file) {
        // iframe finished loading — drop the compile skeleton, push current
        // comments + carry over focused pin if any
        setLoadingPath((p) => (p === m.file ? null : p));
        setLoadedPath(m.file);
        // …and retire any #115 error panel for this canvas: it just proved it
        // can load (a late load, or a successful Retry).
        setCanvasError((e) => (e && e.path === m.file ? null : e));
        // Presentation Mode suppresses comment pins (same gate as the push
        // effect above), so a canvas opened while presenting starts pin-free.
        const list = presentMode ? [] : commentsByFile[m.file] || [];
        const el = [...iframesRef.current.entries()].find(([k]) => k === m.file)?.[1];
        if (el && el.contentWindow) {
          try {
            el.contentWindow.postMessage({ dgn: 'comments-set', comments: list }, '*');
          } catch {}
          // System-review D9 — seed the just-loaded canvas with the current
          // chrome theme so a canvas opened AFTER a theme toggle starts
          // correct (no flash from the dark default).
          try {
            el.contentWindow.postMessage({ dgn: 'theme', theme }, '*');
          } catch {}
          // Seed the just-loaded canvas with the current chrome-visibility
          // state (minimap / zoom-controls toggles + Presentation Mode) so a
          // canvas opened after a toggle starts in the right state.
          try {
            el.contentWindow.postMessage(
              { dgn: 'view-chrome', minimap: minimapVisible, zoom: zoomCtlVisible, present: presentMode },
              '*'
            );
          } catch {}
          if (focusedCommentId && list.some((c) => c.id === focusedCommentId)) {
            try {
              el.contentWindow.postMessage({ dgn: 'comment-focus', id: focusedCommentId }, '*');
            } catch {}
          }
          // Phase 12.1 (DDR-138) — a reorder just wrote source: the moved
          // element's positional data-cd-id renumbered, so re-selecting by the
          // PRE-move id would land on the wrong node. Re-select by the recomputed
          // movedId instead (null ⇒ leave selection to the user, never guess), and
          // rebuild the layers tree so the panel reflects the new order.
          const pend = pendingReorderRef.current;
          if (pend && pend.file === m.file) {
            pendingReorderRef.current = null;
            try {
              el.contentWindow.postMessage(
                { dgn: 'request-layers', artboardId: pend.artboardId ?? null },
                '*'
              );
            } catch {}
            if (pend.movedId) {
              try {
                el.contentWindow.postMessage(
                  {
                    dgn: 'select-by-id',
                    id: pend.movedId,
                    artboardId: pend.artboardId ?? null,
                    index: 0,
                  },
                  '*'
                );
              } catch {}
            }
          } else {
            // Phase 12.3 (W1.1) — an edit-css/edit-attr commit triggers the file
            // watcher's HMR reload, which remounts the canvas and drops the
            // in-canvas selection halo. Re-select the same element by its stable
            // data-cd-id so the user keeps focus on what they're editing. The
            // canvas-shell `select-by-id` handler re-emits select-set, which keeps
            // the Inspector panel + halo in sync. Guarded to the active file.
            // Retry-laddered: dgn:'loaded' fires from the inline inspector script
            // BEFORE the React canvas-shell mounts its listener, so a one-shot
            // post is lost on fresh iframes (canvas-switch restore case).
            const sel0 = selectedRef.current;
            const sel = Array.isArray(sel0) ? sel0[0] : sel0;
            if (sel && sel.id && sel.file === m.file) {
              scheduleHaloRestore(sel);
            }
          }
        }
      } else if (m.dgn === 'export-request' && m.id && m.payload) {
        // The export dialog renders inside the canvas iframe (canvas origin),
        // but /_api/export is a privileged MAIN-origin endpoint deliberately
        // kept off the canvas allowlist (DDR-060). A direct in-iframe fetch
        // therefore 403s ("Forbidden (canvas origin)"). Bridge it: run the
        // export here on the trusted main origin, stream the download, and
        // report status back to the iframe. Origin is already validated
        // (e.origin === expectedOrigin) above, so only the real canvas iframe
        // can ask — this is NOT a generic fetch proxy.
        //
        // DDR-231 security (M1): additionally require the request come from the
        // ACTIVE canvas — captureFromCanvas + the browser-lane branch capture
        // and auto-download `activePath`'s pixels regardless of who asked, so
        // WITHOUT this gate a background (untrusted, DDR-054) same-origin canvas
        // could `postMessage({dgn:'export-request'})` with no user gesture and
        // force a silent download of whatever the user is currently looking at.
        // Same one-liner every sibling mutating branch already uses.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source !== activeWin) return;
        void runBridgedExport(e.source, m.id, m.payload);
      } else if (m.dgn === 'export-history-request' && m.id) {
        // Same bridge for the dialog's Recent tab (/_api/export-history is
        // also main-origin-only).
        void runBridgedHistory(e.source, m.id);
      }
    }
    // Reply target for the export bridge: the canvas iframe's own origin.
    const replyOrigin = cfg?.canvasOrigin || window.location.origin;
    async function runBridgedExport(source, id, payload) {
      // The in-canvas dialog exports the canvas it LIVES IN — which the M1
      // gate above just proved is `activePath`. Stamp it so scope resolution
      // never falls back to the server's (asynchronously written, possibly
      // stale) `_active.json` — same rule as the shell dialog's canvasFile.
      // OVERWRITE, not fill-if-absent: the M1 gate above proved the sender IS
      // the active canvas iframe (untrusted, DDR-054), so a canvasFile IT
      // supplied must not survive — the bridged export renders the canvas it
      // lives in, full stop (security review W2).
      if (payload?.options && activePath && activePath !== SYSTEM_TAB) {
        payload.options.canvasFile = activePath;
      }
      const reply = (msg) => {
        try {
          if (source) source.postMessage({ dgn: 'export-result', id, ...msg }, replyOrigin);
        } catch {}
      };
      // DDR-231 — the browser lane, mirrored for the IN-CANVAS dialog: png/svg
      // of a known artboard is captured by the asking canvas itself (the shell
      // relays the request back over the export-capture bridge and downloads
      // the blobs — the sandboxed iframe can't download, the shell can).
      const opts = payload?.options || {};
      const bridgedBrowserEligible = browserCaptureEligible({
        exportLane: cfg.exportLane || 'local',
        format: payload?.format,
        scope: payload?.scope,
        artboardId: opts.artboardId,
      });
      if (bridgedBrowserEligible) {
        try {
          if (payload.format === 'pptx') {
            const { filename, blob } = await captureDeckViaBrowser({
              capture: captureFromCanvas,
              name: activePath ? activePath.replace(/^.*\//, '').replace(/\.[^.]+$/, '') : 'export',
            });
            downloadCapturedBlob(filename, blob);
          } else {
            const capScale = captureScale(opts);
            const items = await captureFromCanvas({
              format: payload.format,
              artboardIds: [opts.artboardId],
              scale: capScale,
            });
            const safeItems = await sanitizeCapturedItems(items, payload.format);
            for (const it of safeItems) downloadCapturedBlob(it.name, it.blob);
          }
          reply({ ok: true, browser: true });
          return;
        } catch {
          if (cfg.exportLane !== 'remote') {
            reply({
              ok: false,
              error:
                'Capturing in the browser failed and this workspace has no render service to fall back to — try again, or ask your admin to add maude-render.',
            });
            return;
          }
          // Render service available — degrade to the jobs lane below.
        }
      }
      // feature-cloud-export-render-workers — a workspace with no render
      // service can't produce browser-rendered formats; answer the in-canvas
      // dialog with the reason instead of relaying a request the proxy 404s.
      // ZIP (and any browser-free format) still goes through.
      if (cfg.exportLane === 'none' && payload?.format !== 'zip') {
        reply({
          ok: false,
          error:
            'This format needs the render service, which this workspace doesn’t have configured. PNG/SVG of the active artboard and the PPTX deck export straight from the browser; ZIP works too. For the rest use the desktop app or ask your admin to add maude-render.',
        });
        return;
      }
      try {
        // feature-background-export-notification-center — enqueue and reply
        // with the job id immediately; the notification center (which
        // already owns the WS connection) is the single place status/
        // progress/completion live from here, regardless of which dialog
        // created the job.
        const r = await fetch('/_api/export-jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          reply({ ok: false, error: (await r.text()) || String(r.status) });
          return;
        }
        const { jobId } = await r.json();
        reply({ ok: true, jobId });
      } catch (err) {
        reply({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    }
    async function runBridgedHistory(source, id) {
      let history = [];
      try {
        const r = await fetch('/_api/export-history');
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data.history)) history = data.history;
        }
      } catch {
        /* best-effort — empty list */
      }
      try {
        if (source) source.postMessage({ dgn: 'export-history-result', id, history }, replyOrigin);
      } catch {}
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    commentsByFile,
    focusedCommentId,
    cfg,
    theme,
    reloadActive,
    presentMode,
    minimapVisible,
    zoomCtlVisible,
    broadcastChrome,
    activePath,
    postToActiveCanvas,
    captureFromCanvas,
  ]);

  // Tell the active canvas iframe to drop any persistent selection (canvas
  // SelectionSet) — used when the comment composer closes via submit /
  // cancel / Esc. canvas-shell listens for `force-clear` on the window
  // message channel and calls selSet.clear().
  const clearActiveCanvasSelection = useCallback(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    const el = iframesRef.current.get(activePath);
    if (el && el.contentWindow) {
      try {
        el.contentWindow.postMessage({ dgn: 'force-clear' }, '*');
      } catch {}
    }
  }, [activePath]);

  // Phase 12.3 (W1.1) — optimistic inline-style preview. The CSS panel calls this
  // on commit so the selected element updates instantly in the canvas before the
  // edit-css → HMR reload lands. `value` null = the reset path (remove the prop).
  const applyOptimisticStyle = useCallback(
    (payload) => {
      if (!activePath || activePath === SYSTEM_TAB) return;
      const el = iframesRef.current.get(activePath);
      if (el && el.contentWindow) {
        try {
          el.contentWindow.postMessage({ dgn: 'apply-style', ...payload }, '*');
        } catch {}
      }
    },
    [activePath]
  );

  // Inline-edit undo (DDR-103/104 follow-up). The inspector calls this after it
  // POSTs `/_api/edit-css` / `/_api/edit-attr`, so the canvas iframe records the
  // edit on its undo stack and Cmd+Z can invert it. The iframe gates this to
  // parent-origin posts (DDR-054). See `commands/edit-source-command.ts`.
  const recordSourceEdit = useCallback(
    (payload) => {
      if (!activePath || activePath === SYSTEM_TAB || !payload) return;
      const el = iframesRef.current.get(activePath);
      if (el && el.contentWindow) {
        try {
          el.contentWindow.postMessage({ dgn: 'record-edit', payload }, '*');
        } catch {}
      }
    },
    [activePath]
  );

  // Serializes `apply-edit` source writes from canvas undo/redo so a rapid
  // multi-Cmd+Z on the same property lands on disk in dispatch order (the
  // iframe sink is fire-and-forget, so without this the POSTs could race).
  const editApplyChainRef = useRef(Promise.resolve());

  // Phase 12.1 (DDR-138) — commit a Layers-panel drag/keyboard reorder. The shell
  // is main-origin, so it calls the privileged /_api/reorder directly (the CSS/
  // text edits go the other way — canvas requests, shell writes; here the gesture
  // originates in the shell). Serialized on the same chain as apply-edit so a
  // reorder can't race an in-flight edit write to the same file.
  const reorderLayer = useCallback(
    (draggedId, refId, position, occ) => {
      const idIndex = Number.isInteger(occ?.idIndex) ? occ.idIndex : undefined;
      const refIndex = Number.isInteger(occ?.refIndex) ? occ.refIndex : undefined;
      // A same-id move is valid for two INSTANCES of a reused component (distinct
      // occurrence indices → distinct usages); only a true self-move is a no-op.
      if (!draggedId || !refId) return;
      if (draggedId === refId && (idIndex ?? 0) === (refIndex ?? 0)) return;
      const sel = selectedRef.current;
      const one = Array.isArray(sel) ? sel[0] : sel;
      // SECURITY (DDR-139 / adversarial F1): a reorder ALWAYS applies to the
      // ACTIVE canvas — both the in-canvas drag and the Layers panel operate on
      // what the user is viewing. Pin the target to `activePath`; never derive it
      // from `selection.canvas`, which an untrusted iframe can spoof (an ungated
      // dgn:'select' followed by dgn:'reorder-request') to retarget the write to
      // a DIFFERENT canvas (confused deputy, breaks DDR-054/DDR-138 containment).
      const canvas = activePath;
      if (!canvas) return;
      const file = activePath;
      const artboardId = layersTree?.artboardId ?? one?.artboardId ?? null;
      // Optimistically reorder the layers tree so the panel reflects the move
      // instantly; the HMR rebuild (request-layers, dgn:'loaded') confirms it a
      // beat later. Ids here are distinct (repeated/list nodes are non-draggable).
      setLayersTree((prev) =>
        prev ? { ...prev, nodes: moveLayerNode(prev.nodes, draggedId, refId, position) } : prev
      );
      // Gate the next layers-panel drag until the rebuilt tree lands — the write
      // churns positional ids, so a rapid 2nd drag on the optimistic tree would
      // carry stale ids. Cleared by the incoming layers-tree message, with a
      // hard timeout fallback so the list can NEVER stay frozen if that message
      // doesn't arrive (a no-op reorder, no HMR, etc.).
      layersBusyRef.current = true;
      if (layersBusyTimerRef.current) clearTimeout(layersBusyTimerRef.current);
      layersBusyTimerRef.current = setTimeout(() => {
        layersBusyRef.current = false;
        layersBusyTimerRef.current = null;
      }, 700);
      editApplyChainRef.current = editApplyChainRef.current
        .catch(() => {})
        .then(() =>
          fetch('/_api/reorder', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ canvas, id: draggedId, refId, position, idIndex, refIndex }),
          })
            .then((r) => r.json().catch(() => ({})))
            .then((j) => {
              if (!j.ok) {
                console.warn('[reorder]', j.error || 'failed');
                // The move was REJECTED (e.g. a .map()ed/looped element, or a
                // reparent that would break the JSX) — but the canvas already
                // applied it optimistically (applyDrop) and the layers panel via
                // moveLayerNode. Nothing was written, so without a revert the user
                // sees a phantom change that vanishes on the next canvas switch
                // ("it didn't save") and Cmd+Z has no entry to undo. Tell the
                // canvas to put the node back; its observer re-posts the tree, so
                // the panel reverts too. For a LAYERS-panel reorder (no canvas DOM
                // move to observe) also re-request the tree to drop the optimistic
                // moveLayerNode.
                postToActiveCanvas({ dgn: 'reorder-failed' });
                postToActiveCanvas({ dgn: 'request-layers', artboardId });
                layersBusyRef.current = false;
                if (layersBusyTimerRef.current) {
                  clearTimeout(layersBusyTimerRef.current);
                  layersBusyTimerRef.current = null;
                }
                return;
              }
              // The write triggers an HMR reload; the dgn:'loaded' handler
              // re-selects the moved element by its recomputed id + rebuilds the
              // tree. movedId is best-effort — null means "leave selection to the
              // user" (never re-select by the stale pre-move id).
              pendingReorderRef.current = { file, movedId: j.movedId || null, artboardId };
              // Record onto the canvas undo stack so Cmd+Z reverts the move via
              // the server's reorder log (id-churn-proof whole-file swap).
              if (typeof j.seq === 'number') {
                postToActiveCanvas({
                  dgn: 'record-edit',
                  payload: { op: 'reorder', canvas, seq: j.seq, label: 'move element' },
                });
              }
            })
            .catch(() => {})
        );
    },
    [activePath, layersTree, postToActiveCanvas]
  );
  // Keep the ref the (stale-closure) onMessage reorder-request handler reads
  // pointed at the latest reorderLayer.
  useEffect(() => {
    reorderLayerRef.current = reorderLayer;
  }, [reorderLayer]);

  // Commit an in-canvas coordinate-mode drag (out-of-flow element: absolute/
  // fixed) as two sequential single-property writes through the SAME
  // main-origin endpoint the CSS panel already uses (`/_api/edit-css`, Phase
  // 12 / DDR-103) — no new write surface. `editStyleProp` upserts into the
  // existing `style={{}}` object, so the second call (top) lands next to the
  // first (left) rather than clobbering it. Serialized on the shared
  // apply-edit chain so it can't race an in-flight write to the same file.
  const repositionElement = useCallback(
    (id, left, top, beforeLeft, beforeTop, idIndex) => {
      if (!id || !activePath) return;
      const canvas = activePath;
      // Stage H3 — when the dragged target is a whole component INSTANCE the canvas
      // passes its DOM-occurrence index; the server routes the left/top write to
      // that instance's own `<Component/>` usage so moving one instance stays local.
      const occ = Number.isInteger(idIndex) ? idIndex : undefined;
      // INV-2 (DDR-105) — arm the reload-suppression window BEFORE the edit-css
      // writes so the HMR reload is skipped and the canvas doesn't remount + drop
      // the selection (dogfood: "když pohnu elementem myší, ztratím focus"). Same
      // fix as resizeElement; also covers the keyboard nudge (L1) which reuses this.
      applyOptimisticStyle({ id, prop: 'left', value: `${left}px` });
      applyOptimisticStyle({ id, prop: 'top', value: `${top}px` });
      const writeProp = (property, value) =>
        fetch('/_api/edit-css', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canvas, id, property, value: `${value}px`, idIndex: occ }),
        }).then((r) => r.json().catch(() => ({})));
      editApplyChainRef.current = editApplyChainRef.current
        .catch(() => {})
        .then(() => writeProp('left', left))
        .then((j1) => {
          if (!j1.ok) throw new Error(j1.error || 'left write failed');
          return writeProp('top', top);
        })
        .then((j2) => {
          if (!j2.ok) throw new Error(j2.error || 'top write failed');
          // Record BOTH properties onto the canvas undo stack — two Cmd+Z
          // steps (top, then left), same as committing two CSS knobs by hand.
          recordSourceEdit({
            op: 'css',
            canvas,
            id,
            key: 'left',
            before: `${beforeLeft}px`,
            after: `${left}px`,
          });
          recordSourceEdit({
            op: 'css',
            canvas,
            id,
            key: 'top',
            before: `${beforeTop}px`,
            after: `${top}px`,
          });
        })
        .catch((err) => {
          console.warn('[reposition]', err?.message || err);
          // Nothing (or only `left`) persisted — tell the canvas to restore
          // the pre-drag inline style so a phantom move doesn't linger.
          postToActiveCanvas({ dgn: 'reposition-failed' });
        });
    },
    [activePath, postToActiveCanvas, recordSourceEdit, applyOptimisticStyle]
  );
  useEffect(() => {
    repositionElementRef.current = repositionElement;
  }, [repositionElement]);

  // feature-element-editing-robustness Stage D (Task D3) — commit an in-canvas
  // drag-resize. `patch` = { width, height, left?, top? } (px strings); left/top
  // are present only for a top/left-edge drag on an out-of-flow element. Writes
  // each present property through the SAME main-origin `/_api/edit-css` endpoint
  // the CSS panel + reposition use (no new write surface), serialized on the
  // shared apply-edit chain, and records one undo entry per property (as
  // reposition records left+top). Pinned to `activePath` (never `m.canvas`) —
  // the confused-deputy guard DDR-138/DDR-054 established for reorder/reposition.
  const resizeElement = useCallback(
    (id, patch, before, idIndex) => {
      if (!id || !activePath || !patch || typeof patch !== 'object') return;
      const canvas = activePath;
      const b = before && typeof before === 'object' ? before : {};
      // Stage H3 — a whole-instance resize carries its DOM-occurrence index so the
      // width/height/left/top write lands on that instance's own `<Component/>`
      // usage (local), not the shared inner definition. undefined for a plain element.
      const occ = Number.isInteger(idIndex) ? idIndex : undefined;
      // `transform` rides the same lane for the rotate handle (Task L8);
      // `padding-*`/`gap` ride it for the on-canvas spacing drag (Stage J);
      // `grid-template-columns`/`grid-template-rows` ride it for the on-canvas
      // grid gutter drag (feature-3-web-artboards T5) — same single-prop
      // /_api/edit-css write + per-prop undo record, no new lane.
      const props = [
        'width',
        'height',
        'left',
        'top',
        'transform',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'gap',
        'grid-template-columns',
        'grid-template-rows',
      ].filter((p) => typeof patch[p] === 'string' && patch[p]);
      if (!props.length) return;
      // Dogfood 2026-07-07 — "resize paddingu nebo gap" was still deselecting on
      // completion. `applyOptimisticStyle` was posting {id, prop, value} only —
      // missing artboardId/index — so the canvas-side `apply-style` handler
      // resolved the UNSCOPED `[data-cd-id]` selector (dom-selection.ts
      // `resolveSelectionEl`/`scopedCdSelector`), which is a latent multi-
      // artboard/reused-component miss. Pull the current selection's own
      // artboardId/index (when it matches `id`) so every optimistic apply +
      // the belt-and-suspenders reselect below target the SAME instance.
      const curSel = selectedRef.current;
      const curOne = Array.isArray(curSel)
        ? curSel.length === 1
          ? curSel[0]
          : null
        : curSel;
      const selArtboardId = curOne && curOne.id === id ? (curOne.artboardId ?? null) : null;
      const selIndex = curOne && curOne.id === id ? (curOne.index ?? 0) : 0;
      // INV-2 (DDR-105) — arm the reload-suppression window BEFORE the edit-css
      // writes so the follow-up HMR is skipped. Without this the canvas remounts
      // and drops the selection (the "resize deselects the element" dogfood bug).
      for (const p of props) {
        applyOptimisticStyle({
          id,
          artboardId: selArtboardId,
          index: selIndex,
          prop: p,
          value: patch[p],
        });
      }
      const writeProp = (property, value) =>
        fetch('/_api/edit-css', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canvas, id, property, value, idIndex: occ }),
        }).then((r) => r.json().catch(() => ({})));
      let chain = editApplyChainRef.current.catch(() => {});
      for (const p of props) {
        chain = chain.then((prev) => {
          if (prev && prev.ok === false) throw new Error(prev.error || `${p} write failed`);
          return writeProp(p, patch[p]);
        });
      }
      editApplyChainRef.current = chain
        .then((last) => {
          if (last && last.ok === false) throw new Error(last.error || 'resize write failed');
          // Record one undo entry per written property (each Cmd+Z reverts one).
          for (const p of props) {
            recordSourceEdit({ op: 'css', canvas, id, key: p, before: b[p] ?? null, after: patch[p] });
          }
          // Dogfood 2026-07-07 — belt-and-suspenders reselect, mirroring the
          // structural ops' `pendingReorderRef` re-settle. The DDR-105 suppression
          // window should make this a no-op (no reload → the selection was never
          // lost) — idempotent per `scheduleHaloRestore`'s own doc comment, so it's
          // safe to always fire, and it's the backstop if suppression ever misses
          // (a slow FS-watcher round trip past the 1.5s window, for example).
          scheduleHaloRestore({ id, file: canvas, artboardId: selArtboardId, index: selIndex });
        })
        .catch((err) => {
          console.warn('[resize]', err?.message || err);
          // Nothing (or only a prefix) persisted — tell the canvas to restore the
          // pre-drag inline style so a phantom resize doesn't linger.
          postToActiveCanvas({ dgn: 'resize-failed' });
        });
    },
    [activePath, postToActiveCanvas, recordSourceEdit, applyOptimisticStyle, scheduleHaloRestore]
  );
  useEffect(() => {
    resizeElementRef.current = resizeElement;
  }, [resizeElement]);

  // feature-element-editing-robustness Stage I — general element structural edits
  // (delete / insert element / insert artboard) + Stage D4 (artboard resize).
  // Each is a main-origin-only write the untrusted canvas can only REQUEST over
  // the dgn:* bus; the shell performs it, pinned to `activePath` (confused-deputy
  // guard, DDR-054/138). Undo reuses the reorder command's whole-file seq revert
  // (record-edit op:'reorder') — a structural edit renumbers positional ids, so an
  // inverse descriptor goes stale (same reason reorder uses the server seq log).
  const structuralWriteRef = useRef(null);
  const structuralWrite = useCallback(
    (route, body, { label, onOk, onFail } = {}) => {
      if (!activePath) return;
      const canvas = activePath;
      editApplyChainRef.current = editApplyChainRef.current
        .catch(() => {})
        .then(() =>
          fetch(route, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, canvas }),
          })
            .then((r) => r.json().catch(() => ({})))
            .then((j) => {
              if (!j.ok) {
                console.warn(`[${route}]`, j.error || 'failed');
                onFail?.(j);
                return;
              }
              if (typeof j.seq === 'number') {
                postToActiveCanvas({
                  dgn: 'record-edit',
                  payload: { op: 'reorder', canvas, seq: j.seq, label: label || 'edit' },
                });
              }
              onOk?.(j, canvas);
            })
            .catch((err) => onFail?.({ error: err?.message }))
        );
    },
    [activePath, postToActiveCanvas]
  );
  useEffect(() => {
    structuralWriteRef.current = structuralWrite;
  }, [structuralWrite]);

  const deleteElementShell = useCallback(
    (id, idIndex) => {
      // After the delete lands + HMR reloads, clear the (now-gone) selection.
      structuralWrite(
        '/_api/delete-element',
        { id, idIndex: Number.isInteger(idIndex) ? idIndex : undefined },
        { label: 'delete element', onOk: () => postToActiveCanvas({ dgn: 'selection-clear' }) }
      );
    },
    [structuralWrite, postToActiveCanvas]
  );

  const insertElementShell = useCallback(
    (refId, position, kind, opts = {}) => {
      structuralWrite(
        '/_api/insert-element',
        {
          refId,
          artboardId: typeof opts.artboardId === 'string' ? opts.artboardId : undefined,
          position,
          kind,
          src: typeof opts.src === 'string' ? opts.src : undefined,
          refIndex: Number.isInteger(opts.refIndex) ? opts.refIndex : undefined,
        },
        {
          label: `insert ${kind}`,
          // Select the new element once the HMR reload lands (its id is stamped
          // on transpile — best-effort, like reorder's pendingReorderRef).
          onOk: (j, canvas) => {
            if (j.newId) pendingReorderRef.current = { file: canvas, movedId: j.newId, artboardId: null };
          },
        }
      );
    },
    [structuralWrite]
  );

  // feature-ai-media-generation Phase 1 (Task 1.1) — auto-insert a generated
  // image onto the canvas where the user is looking, so generation is never a
  // dead-end modal. The image landed in the content-addressed asset store
  // (assets/<sha8>.png) via the privileged /_api/generate-jobs route; splice it
  // into the active artboard through the SAME main-origin source-write lane the
  // AssetPicker uses (insertElementShell → /_api/insert-element). Returns true
  // when it placed the image, false when there's no target artboard (no canvas
  // open / no active artboard) so the caller can fall back to a manual affordance.
  const insertGeneratedImage = useCallback(
    (assetPath) => {
      if (typeof assetPath !== 'string' || !assetPath) return false;
      if (!activePath) return false;
      // Respect the active-canvas + selected-artboard signals (_active.json): an
      // explicit selection wins, else the viewport-active artboard canvas-lib
      // reports on pan. Without a target artboard we can't source-write.
      const artboardId = selectedRef.current?.artboardId ?? canvasActiveArtboard ?? null;
      if (!artboardId) return false;
      // Insert as the last child of the artboard (empty or not — the engine's
      // insertElementIntoArtboard handles both). Content-addressed src only; the
      // route contains an `image` src to assets/ (no remote hotlink / scheme).
      insertElementShell(undefined, 'inside-end', 'image', { artboardId, src: assetPath });
      return true;
    },
    [activePath, canvasActiveArtboard, insertElementShell]
  );

  // feature-4 detach-component (2026-07-19) — clone the definition + repoint
  // this usage so edits stay local to this instance. Rides structuralWrite
  // (one undo seq); the id churn after HMR invalidates the selection → clear.
  const detachInstanceShell = useCallback(
    (id, idIndex) => {
      structuralWrite(
        '/_api/detach-component',
        { id, idIndex: Number.isInteger(idIndex) ? idIndex : undefined },
        {
          label: 'detach instance',
          onOk: (j) => {
            postToActiveCanvas({ dgn: 'selection-clear' });
            postToActiveCanvas({
              dgn: 'op-toast',
              message: `Detached — this instance is now ${j.detachedName || 'its own component'}; edits stay local (⌘Z to undo).`,
            });
          },
          onFail: (j) =>
            postToActiveCanvas({
              dgn: 'op-toast',
              message: `Detach failed: ${j?.error || 'unknown error'}`,
            }),
        }
      );
    },
    [structuralWrite, postToActiveCanvas]
  );

  const duplicateElementShell = useCallback(
    (id, idIndex) => {
      structuralWrite(
        '/_api/duplicate-element',
        { id, idIndex: Number.isInteger(idIndex) ? idIndex : undefined },
        {
          label: 'duplicate element',
          // Select the copy once the HMR reload lands (best-effort, like insert).
          onOk: (j, canvas) => {
            if (j.newId) pendingReorderRef.current = { file: canvas, movedId: j.newId, artboardId: null };
          },
        }
      );
    },
    [structuralWrite]
  );

  // Task L4 — copy-style / paste-style. Captures a selection's AUTHORED inline
  // styles (not resolved/computed, so DS-token + inherited values aren't baked in)
  // minus layout/geometry props, then applies them to another element via chained
  // edit-css writes (one per prop, like resize — N-step undo). Clipboard lives in
  // the shell so it survives selection + canvas changes.
  const copiedStyleRef = useRef(null);
  // Appearance-only: exclude position/size/margin so paste-style copies the LOOK,
  // not the layout (Figma parity — padding/color/border/shadow/font/… carry over).
  const PASTE_STYLE_EXCLUDE = useMemo(
    () =>
      new Set([
        'position',
        'top',
        'right',
        'bottom',
        'left',
        'inset',
        'width',
        'height',
        'min-width',
        'max-width',
        'min-height',
        'max-height',
        'margin',
        'margin-top',
        'margin-right',
        'margin-bottom',
        'margin-left',
      ]),
    []
  );
  const copyStyle = useCallback(() => {
    const sel = selectedRef.current;
    const one = Array.isArray(sel) ? (sel.length === 1 ? sel[0] : null) : sel;
    if (!one) return;
    const map = {};
    for (const [k, v] of Object.entries(one.authored || {})) {
      if (!PASTE_STYLE_EXCLUDE.has(k)) map[k] = v;
    }
    for (const [k, v] of Object.entries(one.customStyles || {})) {
      if (!PASTE_STYLE_EXCLUDE.has(k)) map[k] = v;
    }
    copiedStyleRef.current = Object.keys(map).length ? map : null;
  }, [PASTE_STYLE_EXCLUDE]);
  const pasteStyle = useCallback(
    (id) => {
      const canvas = activePath;
      const map = copiedStyleRef.current;
      if (!canvas || !id || !map) return;
      const entries = Object.entries(map);
      let chain = editApplyChainRef.current.catch(() => {});
      for (const [property, value] of entries) {
        applyOptimisticStyle({ id, prop: property, value }); // preview + arm no-flicker
        chain = chain.then(() =>
          fetch('/_api/edit-css', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ canvas, id, property, value }),
          })
            .then((r) => r.json().catch(() => ({})))
            .then((j) => {
              if (j.ok)
                recordSourceEdit({ op: 'css', canvas, id, key: property, before: null, after: value });
            })
            .catch(() => {})
        );
      }
      editApplyChainRef.current = chain;
    },
    [activePath, applyOptimisticStyle, recordSourceEdit]
  );

  const insertArtboardShell = useCallback(
    ({ id, label, width, height }) => {
      structuralWrite(
        '/_api/insert-artboard',
        { id, label, width, height },
        { label: 'insert artboard' }
      );
    },
    [structuralWrite]
  );

  const resizeArtboardShell = useCallback(
    (artboardId, width, height) => {
      structuralWrite(
        '/_api/resize-artboard',
        { artboardId, width, height },
        {
          label: 'resize artboard',
          // Stage D4 — the resize overlay applies a live inline-style preview
          // during the drag (no HMR yet); on a rejected/failed write, tell it to
          // restore the pre-drag box so a phantom resize doesn't linger.
          onFail: () => postToActiveCanvas({ dgn: 'resize-artboard-failed' }),
          // Dogfood follow-up — resync the Inspector's own W/H (and any other
          // attrs) once the HMR reload lands, so a paper-preset pick doesn't
          // leave the fields showing the pre-resize size.
          onOk: () => scheduleArtboardResync(artboardId, activePath),
        }
      );
    },
    [structuralWrite, postToActiveCanvas, scheduleArtboardResync, activePath]
  );

  const deleteArtboardShell = useCallback(
    (artboardId) => {
      structuralWrite('/_api/delete-artboard', { artboardId }, { label: 'delete artboard' });
    },
    [structuralWrite]
  );

  // feature-3-web-artboards T3 — "Duplicate at width…". No onOk auto-select
  // (matches insertArtboardShell's own precedent above — the new frame lands
  // selectable, not auto-selected).
  const duplicateArtboardShell = useCallback(
    (artboardId, width) => {
      structuralWrite(
        '/_api/duplicate-artboard',
        { artboardId, width },
        { label: 'duplicate artboard at width' }
      );
    },
    [structuralWrite]
  );

  // Artboard "hug height" default — Hug ⇄ Fixed toggle from ArtboardKnobs
  // (CSS panel). Direct shell-side action (no canvas postMessage round trip,
  // unlike resizeArtboardShell's drag-overlay caller), so no *ShellRef needed.
  const setArtboardHugShell = useCallback(
    (artboardId, fixed, freezeHeight) => {
      structuralWrite(
        '/_api/set-artboard-hug',
        { artboardId, fixed, freezeHeight },
        {
          label: fixed ? 'pin artboard height' : 'hug artboard height',
          onOk: () => scheduleArtboardResync(artboardId, activePath),
        }
      );
    },
    [structuralWrite, scheduleArtboardResync, activePath]
  );

  // Artboard "more settings" (background/padding/layout/gap) from ArtboardKnobs.
  const setArtboardStyleShell = useCallback(
    (artboardId, patch) => {
      structuralWrite('/_api/set-artboard-style', { artboardId, ...patch }, {
        label: 'artboard style',
        onOk: () => scheduleArtboardResync(artboardId, activePath),
      });
    },
    [structuralWrite, scheduleArtboardResync, activePath]
  );
  // feature-1-artboard-kinds-foundation, T8 — kind-switch surfaces. Direct
  // callable from ArtboardKnobs (Inspector); the context-menu submenu (inside
  // the iframe) reaches the SAME endpoint via the postMessage ref below.
  //
  // Dogfood follow-up — every one of these ArtboardKnobs writers now resyncs
  // the Inspector's OWN selection snapshot once the HMR reload lands
  // (scheduleArtboardResync's retry ladder). Before this fix the ARTBOARD
  // re-rendered correctly (new kind, new paper size) but the Inspector kept
  // showing PRE-edit attrs (e.g. "Digital" right after picking "Print",
  // "Preset size…" still listing screen presets) until the user manually
  // re-clicked the artboard — structuralWrite's onOk never refreshed
  // `selected`, only recorded undo history.
  // feature-4 dogfood round 6 — the DIRECT kind write (+ the Inspector's
  // print-seed, sequenced AFTER it on the same structuralWrite chain, so a
  // freeze-convert enqueued just before lands FIRST and the A4 resize can't
  // move anything pre-freeze). This is what the canvas's
  // `set-artboard-kind-request` calls — it must NEVER re-enter the ask flow
  // below (that round-trip was an infinite confirm loop: every "Switch +
  // freeze" click spawned the next dialog).
  const pendingPrintSeedRef = useRef(null);
  const directArtboardKindWrite = useCallback(
    (artboardId, kind) => {
      structuralWrite('/_api/set-artboard-kind', { artboardId, kind }, {
        label: 'artboard kind',
        onOk: () => scheduleArtboardResync(artboardId, activePath),
      });
      const seed = pendingPrintSeedRef.current;
      if (kind === 'print' && seed && seed.artboardId === artboardId) {
        pendingPrintSeedRef.current = null;
        // Same chain → serialized after the kind write (and after any freeze
        // convert the canvas enqueued before it).
        structuralWrite(
          '/_api/resize-artboard',
          { artboardId, width: seed.widthPx, height: seed.heightPx },
          { label: 'artboard size' }
        );
        structuralWrite(
          '/_api/set-artboard-print',
          { artboardId, print: seed.defaults },
          { label: 'artboard print' }
        );
      }
    },
    [structuralWrite, scheduleArtboardResync, activePath]
  );
  const directArtboardKindWriteRef = useRef(null);
  useEffect(() => {
    directArtboardKindWriteRef.current = directArtboardKindWrite;
  }, [directArtboardKindWrite]);

  const setArtboardKindShell = useCallback(
    (artboardId, kind, seedPrint) => {
      // feature-4 (user steer 2026-07-20) — Digital & Print are the freely-
      // composed marketing kinds: switching TO them from the Inspector offers
      // the freeze-and-flatten convert first. The confirm runs IN THE CANVAS
      // (canvasConfirm — the shell's window.confirm is a silent no-op in the
      // Tauri WKWebView); the canvas then re-posts `set-artboard-kind-request`,
      // which lands on the DIRECT writer above (no re-entry → no dialog loop).
      if (kind === 'print' || kind == null || kind === 'digital') {
        if (seedPrint) pendingPrintSeedRef.current = { artboardId, ...seedPrint };
        postToActiveCanvas({
          dgn: 'freeze-and-set-kind',
          artboardId,
          kind: kind === 'digital' ? null : kind,
          ask: true,
        });
        return;
      }
      directArtboardKindWrite(artboardId, kind);
    },
    [directArtboardKindWrite, postToActiveCanvas]
  );
  // feature-2-print-artboards T2 — paper/orientation/bleed/margins. Direct
  // Inspector-only callable (no canvas-origin postMessage path — same shape
  // as setArtboardStyleShell, unlike setArtboardKindShell which also has a
  // context-menu caller inside the iframe).
  const setArtboardPrintShell = useCallback(
    (artboardId, print) => {
      structuralWrite('/_api/set-artboard-print', { artboardId, print }, {
        label: 'artboard print',
        onOk: () => scheduleArtboardResync(artboardId, activePath),
      });
    },
    [structuralWrite, scheduleArtboardResync, activePath]
  );

  // Stage I4 — "New artboard: <preset>" from the Edit menu. Generates a unique
  // id (server 422s a dup, negligible with a random suffix) + a preset label/dims
  // and inserts an empty <DCArtboard> after the last one (runtime default-grid
  // places it; DDR-027). The new frame is then selectable + resizable.
  const onInsertArtboard = useCallback(
    (presetKey) => {
      const id = `s${Math.random().toString(36).slice(2, 8)}`;
      // feature-2-print-artboards T2 — kind="print" + the print prop must
      // land together, so the created artboard is never a plain digital
      // board sized to paper by coincidence. structuralWrite serializes
      // calls in submission order (editApplyChainRef), so these three
      // sequential POSTs land as insert → kind → print, in order.
      if (presetKey.startsWith('print-')) {
        const paper = presetKey.slice('print-'.length);
        let resolved;
        try {
          resolved = resolvePrintArtboard({ paper });
        } catch {
          return;
        }
        const preset = PAPER_PRESETS.find((p) => p.id === paper);
        insertArtboardShell({
          id,
          label: preset ? preset.label : paper.toUpperCase(),
          width: resolved.widthPx,
          height: resolved.heightPx,
        });
        setArtboardKindShell(id, 'print');
        setArtboardPrintShell(id, { paper });
        return;
      }
      const p = SCREEN_PRESETS[presetKey];
      if (!p) return;
      insertArtboardShell({ id, label: p.label, width: p.width, height: p.height });
    },
    [insertArtboardShell, setArtboardKindShell, setArtboardPrintShell]
  );
  // Refs the (stale-closure) onMessage handlers below read.
  const deleteElementShellRef = useRef(null);
  const insertElementShellRef = useRef(null);
  const insertArtboardShellRef = useRef(null);
  const resizeArtboardShellRef = useRef(null);
  const deleteArtboardShellRef = useRef(null);
  const setArtboardKindShellRef = useRef(null);
  const duplicateElementShellRef = useRef(null);
  const duplicateArtboardShellRef = useRef(null);
  const copyStyleRef = useRef(null);
  const pasteStyleRef = useRef(null);
  useEffect(() => {
    deleteElementShellRef.current = deleteElementShell;
    insertElementShellRef.current = insertElementShell;
    insertArtboardShellRef.current = insertArtboardShell;
    resizeArtboardShellRef.current = resizeArtboardShell;
    deleteArtboardShellRef.current = deleteArtboardShell;
    setArtboardKindShellRef.current = setArtboardKindShell;
    duplicateElementShellRef.current = duplicateElementShell;
    duplicateArtboardShellRef.current = duplicateArtboardShell;
    copyStyleRef.current = copyStyle;
    pasteStyleRef.current = pasteStyle;
  }, [
    deleteElementShell,
    insertElementShell,
    insertArtboardShell,
    resizeArtboardShell,
    deleteArtboardShell,
    setArtboardKindShell,
    duplicateElementShell,
    duplicateArtboardShell,
    copyStyle,
    pasteStyle,
  ]);

  // Shell-level Backspace/Delete guard. CRITICAL: in the Tauri desktop app, an
  // unhandled Backspace triggers WKWebView back-navigation, which reloads the
  // WHOLE app to "Starting…" (dogfood crash). When an artboard is selected, focus
  // sits on the shell (not the canvas iframe), so the in-canvas key handler never
  // sees the keydown — the shell must catch it. Preventing the default here stops
  // the back-nav universally; if a single artboard is the selection, also delete
  // it (Backspace parity with the context menu). Element delete stays in the
  // canvas iframe (which has focus when an element is selected; its keydown never
  // reaches this window, so there's no double-handling).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const editable =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable);
      if (editable) return;
      // Suppress the WKWebView back-nav unconditionally once focus isn't editable —
      // the activePath/SYSTEM_TAB check below is app logic, not default-action gating,
      // so it must not gate preventDefault (that gap caused the desktop "Starting…" hang).
      e.preventDefault();
      if (!activePath || activePath === SYSTEM_TAB) return;
      const one = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
      if (one?.artboardId && !one.id) deleteArtboardShell(one.artboardId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePath, selected, deleteArtboardShell]);

  // feature-element-editing-robustness Stage F — AssetPicker request. `req` is
  // { purpose:'insert-image', refId, position, refIndex } (Insert ▸ Image) or
  // { purpose:'replace-src', id, before } (Media-section "Replace…"). null = closed.
  const [assetPickerReq, setAssetPickerReq] = useState(null);
  const openAssetPickerRef = useRef(null);
  useEffect(() => {
    openAssetPickerRef.current = (req) => setAssetPickerReq(req);
  }, []);

  // Phase 4 (whiteboard-improvements) — { canvas: activePath } when open, null
  // when closed. Mirrors assetPickerReq's ref-indirection (the message
  // listener below is set up with a minimal dep array, so it reaches a FRESH
  // opener via a ref rather than needing setStickerPickerReq in its own deps).
  const [stickerPickerReq, setStickerPickerReq] = useState(null);
  const openStickerPickerRef = useRef(null);
  useEffect(() => {
    openStickerPickerRef.current = (req) => setStickerPickerReq(req);
  }, []);
  const onAssetPicked = useCallback(
    (pickedPath) => {
      const req = assetPickerReq;
      setAssetPickerReq(null);
      if (!req || !pickedPath) return;
      // G3 security (DDR-152) — the request captured refId/id against the canvas
      // that was active when the picker opened; if the user switched canvases
      // while the modal was up, those ids are meaningless (or worse, collide) on
      // the now-active canvas. Abort rather than write to the wrong file.
      if (req.canvas && req.canvas !== activePath) {
        console.warn('[asset-picker] active canvas changed since request — aborting');
        return;
      }
      if (req.purpose === 'insert-image') {
        insertElementShell(req.refId, req.position || 'after', 'image', {
          artboardId: req.artboardId,
          src: pickedPath,
          refIndex: req.refIndex,
        });
        return;
      }
      if (req.purpose === 'replace-src') {
        // Re-point an authored <img>/<video> src via /_api/edit-attr (+ undo).
        const canvas = activePath;
        if (!canvas || !req.id) return;
        editApplyChainRef.current = editApplyChainRef.current
          .catch(() => {})
          .then(() =>
            fetch('/_api/edit-attr', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ canvas, id: req.id, attr: 'src', value: pickedPath }),
            })
              .then((r) => r.json().catch(() => ({})))
              .then((j) => {
                if (j.ok) {
                  recordSourceEdit({
                    op: 'attr',
                    canvas,
                    id: req.id,
                    key: 'src',
                    before: req.before ?? null,
                    after: pickedPath,
                  });
                } else {
                  console.warn('[replace-src]', j.error || 'failed');
                }
              })
              .catch(() => {})
          );
        return;
      }
      if (req.purpose === 'replace-annotation-media') {
        // Stage F3 — relay the picked path DOWN to the canvas; the annotation
        // model owns its own strokes + persistence + undo (`commitStrokes`), so
        // unlike `replace-src` the shell performs no write of its own here.
        postToActiveCanvas({ dgn: 'replace-annotation-media', id: req.id, path: pickedPath });
      }
    },
    [assetPickerReq, insertElementShell, activePath, recordSourceEdit, postToActiveCanvas]
  );

  // feature-bulk-media-insert Task 10 — the picker's multi-select confirm.
  // `destination === 'artboard'`: loop insertElementShell once per path
  // (already race-safe via editApplyChainRef, no new serialization needed);
  // always appended `inside-end` of whichever artboard is currently active —
  // NOT the single-pick request's own refId/position, which only made sense
  // for inserting exactly one image relative to one anchor. `destination ===
  // 'annotation'`: one batched message so the canvas-side handler (Task 11)
  // performs a single atomic commit instead of N racing ones.
  const onPickMany = useCallback(
    (paths, destination) => {
      const req = assetPickerReq;
      setAssetPickerReq(null);
      if (!req || !Array.isArray(paths) || !paths.length) return;
      if (req.canvas && req.canvas !== activePath) {
        console.warn('[asset-picker] active canvas changed since request — aborting');
        return;
      }
      if (destination === 'artboard') {
        const artboardId = selectedRef.current?.artboardId ?? canvasActiveArtboard ?? null;
        if (!artboardId) return;
        for (const src of paths) {
          insertElementShell(undefined, 'inside-end', 'image', { artboardId, src });
        }
        return;
      }
      postToActiveCanvas({ dgn: 'insert-annotation-media', paths });
    },
    [assetPickerReq, activePath, insertElementShell, canvasActiveArtboard, postToActiveCanvas]
  );

  // Phase 4 (whiteboard-improvements) — a bundled sticker has no project asset
  // path yet (it lives in MAUDE's own STICKERS_DIR, main-origin-only per
  // DDR-054), so re-upload its bytes through the SAME /_api/asset lane every
  // other image source uses (content-addressed, canvas-origin-allowlisted) —
  // then relay the resulting project-relative path down to the canvas exactly
  // like replace-annotation-media above (the annotation model owns its own
  // strokes; the shell performs no stroke write of its own).
  const onStickerPicked = useCallback(
    async (sticker) => {
      const req = stickerPickerReq;
      setStickerPickerReq(null);
      if (!req || !sticker?.url) return;
      // G3 security (DDR-152) — same re-check as onAssetPicked: the request
      // captured the active canvas when the picker opened; abort rather than
      // insert into whatever canvas happens to be active now.
      if (req.canvas && req.canvas !== activePath) {
        console.warn('[sticker-picker] active canvas changed since request — aborting');
        return;
      }
      try {
        const blob = await fetch(sticker.url).then((r) =>
          r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))
        );
        const res = await fetch('/_api/asset', {
          method: 'POST',
          headers: { 'content-type': blob.type || 'image/png' },
          body: blob,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.path) {
          console.warn('[sticker-picker]', j.error || `upload failed (HTTP ${res.status})`);
          return;
        }
        postToActiveCanvas({ dgn: 'insert-sticker', path: j.path });
      } catch {
        console.warn('[sticker-picker] could not load or upload that sticker');
      }
    },
    [stickerPickerReq, activePath, postToActiveCanvas]
  );
  // Media-section "Replace…" (CssKnobs) → open the picker in replace mode with
  // the element's current src as the undo before-value (captured from the
  // Selection's `attrs.src`, not the resolved URL).
  const onReplaceMedia = useCallback(
    (elSel) => {
      if (!elSel?.id) return;
      setAssetPickerReq({
        purpose: 'replace-src',
        canvas: activePath,
        id: elSel.id,
        before: elSel.attrs?.src ?? null,
      });
    },
    [activePath]
  );

  const resolveComment = useCallback((id) => {
    wsSend({ type: 'comments-patch', id, patch: { status: 'resolved' } });
  }, []);
  const reopenComment = useCallback((id) => {
    wsSend({ type: 'comments-patch', id, patch: { status: 'open' } });
  }, []);
  const deleteComment = useCallback((id) => {
    wsSend({ type: 'comments-delete', id });
    setFocusedCommentId((prev) => (prev === id ? null : prev));
  }, []);

  // Jump from right-sidebar list to a comment: open file tab if needed, focus pin.
  // The iframe may be freshly mounted; the loaded handler also re-sends focus if focusedCommentId matches.
  const jumpToComment = useCallback(
    (file, id) => {
      if (file && file !== activePath) {
        setTabs((prev) => (prev.find((t) => t.path === file) ? prev : [...prev, { path: file }]));
        setActivePath(file);
      }
      if (id == null) {
        setFocusedCommentId(null);
        return;
      }
      setFocusedCommentId(id);
      // Try sending focus immediately (existing iframe) and again after a short delay (newly opened tab).
      const send = () => {
        const el = iframesRef.current.get(file);
        if (el && el.contentWindow) {
          try {
            el.contentWindow.postMessage({ dgn: 'comment-focus', id }, '*');
          } catch {}
        }
      };
      send();
      setTimeout(send, 200);
    },
    [activePath]
  );

  // ----- Keyboard shortcuts (no Cmd+W — let browser close the tab) -----
  useEffect(() => {
    function onKey(e) {
      const meta = e.metaKey || e.ctrlKey;
      const inEditable =
        ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) ||
        document.activeElement?.isContentEditable;
      // Phase 4.1: shell-side letter shortcuts (H/T/S) must not double-fire
      // inside a focused canvas iframe — the canvas input router owns those
      // letters as tool-mode keys (V/H/C). Cmd-modified shortcuts (⌘R, ⌘⇧M,
      // ⌘F) still fire regardless of focus, mirroring browser convention.
      const inCanvasIframe = document.activeElement?.tagName === 'IFRAME';

      // Esc exits Presentation Mode first — it's the primary way back to the
      // chrome (the menubar is hidden while presenting). Highest priority so it
      // wins over the focused-pin / deselect Esc handlers below, and fires even
      // when focus is inside the canvas iframe.
      if (presentMode && e.key === 'Escape') {
        e.preventDefault();
        exitPresent();
        return;
      }

      // Cmd+K / Ctrl+K — toggle the command palette (works even in inputs).
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // Cmd+Z / Cmd+Shift+Z / Cmd+Y — forward to the active canvas's undo stack
      // when focus is in the shell chrome (not a text field, not the canvas
      // iframe). Inside the canvas iframe the canvas owns Cmd+Z; inside an editable
      // field native undo wins (the inspector's CssKnobs forwards on its own). This
      // makes inspector CSS / inline text / attr edits undoable from anywhere.
      if (meta && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        if (!inEditable && !inCanvasIframe && activePath && activePath !== SYSTEM_TAB) {
          // DDR-150 dogfood #1 (team finding) — SINGLE OWNER per keypress. With
          // the Timeline open on a video-comp canvas, the timeline undo stack
          // owns Cmd+Z/Shift+Cmd+Z (the timeline keydown effect performs it).
          // Without this skip, BOTH handlers fired on one keypress — undoing a
          // clip op AND popping the canvas's annotation undo simultaneously.
          if (
            (e.key === 'z' || e.key === 'Z') &&
            tlKeyRef.current.open &&
            tlKeyRef.current.comps?.length
          ) {
            return; // the timeline shortcuts effect claims it
          }
          const redo = e.key === 'y' || e.key === 'Y' || e.shiftKey;
          // feature-photo-editor — photo edits are sidecar writes (`/_api/photo-edit`),
          // invisible to the canvas's own source-edit undo stack, so they need
          // their own owner here. Claims the keypress only while the Photo tab
          // is the one on screen AND it actually has something to undo/redo —
          // otherwise falls through to the canvas stack as before. (Focus still
          // inside a Photo-tab slider is handled separately by
          // `onPhotoKnobKeyDown`, mirroring `onKnobKeyDown` for CSS knobs.)
          if (inspectorTab === 'photo' && performPhotoUndo(redo)) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          postToActiveCanvas({ dgn: redo ? 'redo' : 'undo' });
          return;
        }
      }
      // Cmd+Shift+R — refresh the FILES tree (re-read /_index-data). The fs-watch
      // → canvas-list-update auto-refresh can miss events in the compiled desktop
      // sidecar (recursive fs.watch is unreliable in a bun --compile binary), and
      // ⌘R is taken by canvas-iframe reload, so this is the manual escape hatch.
      if (meta && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        refreshTree();
        return;
      }
      // Cmd+R — reload active iframe (override browser reload)
      if (meta && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        reloadActive();
        return;
      }
      // Cmd+Shift+M / Ctrl+Shift+M — toggle right "Comments" panel
      if (meta && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        toggleRightPanel('comments');
        return;
      }
      // Cmd+Shift+G — toggle the Changes (git) panel. Opening it closes the
      // other right-dock panels (one panel at a time).
      if (meta && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        toggleRightPanel('changes');
        return;
      }
      // Cmd+Shift+I — toggle Inspector. Was bare "I", which collided with the
      // canvas highlighter tool (same letter, different action by focus).
      //
      // Cloud Phase 27 C1 — a VIEWER GETS THIS TOO, and the line above used to
      // say the opposite ("the panel is edit chrome"). C1 reversed that on
      // purpose: read-only means cannot CHANGE, not cannot SEE, and a reviewer
      // needs structure and measured values as much as anyone. The View menu
      // already offers it (`viewerHiddenPanels` no longer hides it); the
      // shortcut had been left behind, so the menu said yes and the keyboard
      // said no. Found by writing the parity spec that runs in both shells.
      if (meta && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        toggleRightPanel('inspector');
        return;
      }
      // Phase 31 (DDR-123) — Cmd+Shift+A opens the native ACP chat sidepanel.
      // Cloud Phase 25 C2 — the agent edits; absent for a viewer.
      if (meta && e.shiftKey && (e.key === 'a' || e.key === 'A') && isNativeApp()) {
        e.preventDefault();
        if (!viewerMode) toggleRightPanel('assistant');
        return;
      }
      // Cmd+Shift+E / Cmd+Shift+H — the File-menu chords, previously
      // advertised but never bound.
      if (meta && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setExportDialog({ mode: 'export' });
        return;
      }
      if (meta && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setExportDialog({ mode: 'handoff' });
        return;
      }
      // Cmd+, — open Settings (AI generation keys). The platform convention for
      // a settings/preferences surface (feature-ai-media-generation, DDR-16x).
      // Cloud Phase 25 C2 — settings mutate project config; absent for a viewer.
      if (meta && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault();
        if (!viewerMode) setSettingsOpen(true);
        return;
      }
      // Cmd+Shift+T — toggle the Timeline (video-comp scrub) dock.
      if (meta && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        toggleTimeline();
        return;
      }
      // Cmd+C / Ctrl+C — Phase 4.1 removed the shell-side comment-drop chord.
      // Canvas comment-drop is the `C` tool letter (press C in the canvas,
      // then click the element) or right-click "Add comment". Cmd+C now
      // reverts to native browser copy.
      if (meta && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        if (
          selected &&
          selected.selector &&
          activePath &&
          activePath !== SYSTEM_TAB &&
          !inEditable &&
          console &&
          console.warn
        ) {
          console.warn(
            'Cmd+C comment-drop deprecated — press C inside the canvas to enter Comment tool, then click the element.'
          );
        }
        // Fall through to native copy.
      }
      if (inEditable) return;
      // / — focus search (or ⌘F per CV-08 placeholder hint)
      if (e.key === '/') {
        e.preventDefault();
        const inp = document.querySelector('.st-search input');
        if (inp) inp.focus();
        return;
      }
      if (meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (!sidebarOpen) openPanelExclusive('tree');
        setTimeout(() => {
          const inp = document.querySelector('.st-search input');
          if (inp) inp.focus();
        }, 0);
        return;
      }
      // T / H / S are bare-letter shell shortcuts. When focus is inside a
      // canvas iframe, the canvas input router claims V/H/C — bail out
      // here so the canvas owns the key and the sidebar/system view don't
      // double-fire on focused-canvas keypresses.
      if (inCanvasIframe) {
        // Esc still bubbles below (composer / focused-pin clear).
        if (e.key !== 'Escape') return;
      }
      // T — toggle Project Tree (sidebar)
      if (e.key === 't' || e.key === 'T') {
        if (e.shiftKey || meta) return;
        e.preventDefault();
        togglePanel('tree');
        return;
      }
      // H — toggle show-hidden (sidecars + project/runtime orphans)
      if (e.key === 'h' || e.key === 'H') {
        if (e.shiftKey || meta) return;
        e.preventDefault();
        setShowHidden((v) => !v);
        return;
      }
      // S — toggle Design system view
      if ((e.key === 's' || e.key === 'S') && !meta && !e.shiftKey) {
        e.preventDefault();
        if (activePath === SYSTEM_TAB) {
          closeTab(SYSTEM_TAB);
        } else {
          openSystem();
        }
        return;
      }
      // N — open the new-brief-board composer (replaces the advertised ⌘N,
      // which the browser reserves for New Window and never delivers).
      if ((e.key === 'n' || e.key === 'N') && !meta && !e.shiftKey) {
        e.preventDefault();
        openPanelExclusive('tree');
        setTimeout(
          () => document.querySelector('[aria-label="New blank brief board"]')?.click(),
          60
        );
        return;
      }
      // ? — keyboard-shortcuts cheat sheet (DS shortcuts overlay)
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      // F1 — the full Help modal (commands & flows)
      if (e.key === 'F1') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      // Esc — clear focused pin. The in-place composer (Phase 6) and thread
      // popover handle their own Esc inside the iframe.
      if (e.key === 'Escape') {
        if (focusedCommentId) {
          setFocusedCommentId(null);
          return;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    reloadActive,
    refreshTree,
    selected,
    activePath,
    focusedCommentId,
    sidebarOpen,
    openSystem,
    closeTab,
    clearActiveCanvasSelection,
    presentMode,
    exitPresent,
    toggleTimeline,
    inspectorTab,
    performPhotoUndo,
    viewerMode,
  ]);

  const registerIframe = useCallback((path, el) => {
    if (el) iframesRef.current.set(path, el);
  }, []);

  const totalOpen = totalCounts(commentsByFile).open;

  // Suppress the native browser context menu across the shell — the canvas
  // input-router already handles right-click inside the canvas host, but
  // sidebar / menubar / statusbar / floating chrome would otherwise leak the
  // native menu on top of our `.dc-context-menu` (or alone, outside canvas).
  // Editable fields (search box, future text inputs) keep the native menu so
  // copy/paste still works.
  const onShellContextMenu = useCallback((e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }
    e.preventDefault();
  }, []);

  // ⌘K palette actions — shell-doable only (in-canvas export lives in the iframe).
  // T4 (Plan C) — grouped command set per `.design/ui/Studio.tsx` AB-D.
  // `group` drives the section headers; the list stays a flat array so keyboard
  // nav indexes straight across groups.
  const paletteActions = useMemo(
    () => [
      // ── Canvas ──────────────────────────────────────────────────────────
      {
        id: 'new',
        group: 'Canvas',
        label: 'New canvas…',
        icon: 'plus',
        kbd: 'N',
        run: () => {
          openPanelExclusive('tree');
          setTimeout(
            () => document.querySelector('[aria-label="New blank brief board"]')?.click(),
            60
          );
        },
      },
      {
        id: 'new-video',
        group: 'Canvas',
        label: 'New video…',
        icon: 'plus',
        run: () => createVideo(),
      },
      {
        id: 'export',
        group: 'Canvas',
        label: 'Export…',
        icon: 'download',
        kbd: '⇧⌘E',
        run: () => setExportDialog({ mode: 'export' }),
      },
      {
        id: 'handoff',
        group: 'Canvas',
        label: 'Handoff to production',
        icon: 'share',
        kbd: '⇧⌘H',
        run: () => setExportDialog({ mode: 'handoff' }),
      },
      {
        id: 'generate',
        group: 'Canvas',
        label: 'Generate with AI…',
        icon: 'sparkle',
        run: () => setGenerateOpen(true),
      },
      {
        id: 'settings',
        group: 'Canvas',
        label: 'Settings…',
        icon: 'sliders',
        kbd: '⌘,',
        run: () => setSettingsOpen(true),
      },
      // ── View ────────────────────────────────────────────────────────────
      {
        id: 'system',
        group: 'View',
        label: 'Open design system view',
        icon: 'sliders',
        kbd: 'S',
        run: () => openSystem(),
      },
      {
        id: 'comments',
        group: 'View',
        label: 'Toggle comments panel',
        icon: 'resolve',
        kbd: '⌘⇧M',
        run: () => toggleRightPanel('comments'),
      },
      {
        id: 'inspector',
        group: 'View',
        label: 'Open inspector',
        icon: 'sliders',
        kbd: '⌘⇧I',
        run: () => openRightPanel('inspector'),
      },
      {
        id: 'reload',
        group: 'View',
        label: 'Reload active canvas',
        icon: 'reload',
        kbd: '⌘R',
        run: () => reloadActive(),
      },
      // ── Tools ───────────────────────────────────────────────────────────
      {
        id: 'draw',
        group: 'Tools',
        label: 'Draw a mark with the SVG agent',
        icon: 'pen',
        run: () => {
          // The shell can't invoke Claude — surface the command for the user to
          // paste into Claude Code (clipboard is the honest, useful affordance).
          try {
            navigator.clipboard?.writeText('/design:draw ');
          } catch {}
        },
      },
      {
        id: 'theme',
        group: 'Tools',
        label: 'Toggle light / dark theme',
        icon: 'sun',
        run: () => toggleTheme(),
      },
      // ── Help ────────────────────────────────────────────────────────────
      {
        id: 'whatsnew',
        group: 'Help',
        label: "What's new in maude",
        icon: 'sparkle',
        run: () => whatsNew.openPanel(),
      },
      {
        id: 'shortcuts',
        group: 'Help',
        label: 'Keyboard shortcuts',
        icon: 'help',
        kbd: '?',
        run: () => setShortcutsOpen(true),
      },
      {
        id: 'help',
        group: 'Help',
        label: 'Help · commands & flows',
        icon: 'help',
        kbd: 'F1',
        run: () => setHelpOpen(true),
      },
      {
        id: 'report-bug',
        group: 'Help',
        label: 'Report a bug…',
        icon: 'help',
        run: () => setReportBugOpen(true),
      },
    ],
    [openSystem, toggleTheme, reloadActive, whatsNew, createVideo]
  );

  // feature-configurable-panel-docking — resolve, for each slot, the panels
  // assigned to it and which one is active (the open one). Layers is only a
  // dockable panel in `separate` mode; Assistant is native-only.
  const panelAvailable = (id) => {
    // The AGENT is genuinely absent for a viewer (it edits; Phase 25 C2).
    //
    // Inspector and Layers are NOT — Cloud Phase 27 C1 reversed that, and this
    // line had been left behind: `viewerHiddenPanels` stopped hiding them in
    // the View menu while this still refused to give them a dock slot, so the
    // menu offered a panel that could never appear. Read-only means cannot
    // CHANGE, not cannot SEE: a reviewer needs structure and measured values,
    // which is the whole reason C1 exists.
    if (viewerMode && id === 'assistant') return false;
    // feature-sync-progress-modal — the Sync panel only exists for a linked
    // project (solo has no hub, so the tab would open onto nothing).
    if (id === 'sync') return !!syncStatus;
    return id === 'assistant' ? isNativeApp() : id === 'layers' ? layersMode === 'separate' : true;
  };
  const idsForSide = (side) =>
    DOCK_PANELS.filter(
      (p) => panelAvailable(p.id) && (panelSide[p.id] || PANEL_SIDES_DEFAULTS[p.id]) === side
    ).map((p) => p.id);
  const panelIsOpen = {
    tree: sidebarOpen,
    layers: layersOpen,
    inspector: inspectorOpen,
    comments: commentsPanelOpen,
    changes: changesOpen,
    sync: syncPanelOpen,
    assistant: assistantOpen,
  };
  // Per-shell overrides for the dock tab strip. In a cell the `changes` panel
  // IS the history (the hub commits server-side), so its tab must say so —
  // otherwise the one visible word still promises a working-tree surface that
  // panel no longer has.
  const dockLabels = cfg.cloud ? { changes: 'History' } : null;
  const leftIds = idsForSide('left');
  const rightIds = idsForSide('right');
  const leftActive = leftIds.find((id) => panelIsOpen[id]) || null;
  const rightActive = rightIds.find((id) => panelIsOpen[id]) || null;
  // Cloud Phase 25 C2 — the Assistant edits; a viewer's session never mounts it.
  const leftHostsAssistant =
    isNativeApp() && !viewerMode && (panelSide.assistant || 'right') === 'left';
  const rightHostsAssistant =
    isNativeApp() && !viewerMode && (panelSide.assistant || 'right') === 'right';
  const resizingFor = (id) =>
    (panelSide[id] || PANEL_SIDES_DEFAULTS[id]) === 'left' ? dragSide === 'sb' : dragSide === 'rp';
  const activeCanvasFile =
    activePath && activePath !== SYSTEM_TAB && /\.(tsx|html)$/i.test(activePath) ? activePath : null;
  // Issue #74 — drives the chat panel's "Implement N comments" quick action.
  // Canvas-wide on purpose: the verb operates on every open comment of the
  // active canvas, so it is deliberately NOT scoped to the current selection.
  const activeOpenComments = activeCanvasFile
    ? openCount(commentsByFile[activeCanvasFile])
    : 0;

  // Render a panel body by id (width undefined ⇒ fills the .st-dockslot wrapper,
  // which owns the resizable width). Assistant is handled separately below as an
  // always-mounted ChatPanel so its stream survives a tab switch.
  const renderPanelBody = (id) => {
    // C1 again, the second half of the same gate. The panels MOUNT for a
    // viewer; what they must not do is offer an edit, and that is already
    // handled inside them (`readOnly` is threaded through every control).
    // Refusing to mount was a blunter instrument than the role model asks for.
    
    if (id === 'tree')
      return (
        <Sidebar
          cloud={cfg.cloud}
          readOnly={viewerMode}
          groups={groups}
          activePath={activePath}
          previewPath={previewPath}
          activeDsName={activePath === SYSTEM_TAB ? (systemData?.ds?.name ?? null) : null}
          onOpen={openTab}
          onPreview={onPreview}
          onOpenSystem={openSystem}
          wsConnected={wsConnected}
          search={search}
          setSearch={setSearch}
          commentsByFile={commentsByFile}
          showHidden={showHidden}
          sectionsExpanded={sectionsExpanded}
          onToggleSection={toggleSection}
          onNewBoard={createBoard}
          onDeleteBoard={deleteBoard}
          onMoveCanvas={moveCanvasReq}
          onNewFolder={newFolderReq}
          onDeleteFolder={deleteFolderReq}
          onRefresh={refreshTree}
          refreshing={treeRefreshing}
          collapsed={false}
          onCollapse={() => togglePanel('tree')}
          resizing={resizingFor('tree')}
          dirtyByPath={dirtyByPath}
          project={project}
          gitBranch={gitStatus?.branch}
          remoteSync={remoteSync}
          onGetLatest={gitGetLatest}
          canvasKinds={cfg?.canvasKinds}
          syncStatus={syncStatus}
          onLinkedHub={setCloudLinkedHub}
          savingIsManaged={savingIsManaged}
        />
      );
    if (id === 'changes')
      return (
        <GitPanel
          status={gitStatus && remoteSync ? { ...gitStatus, ...remoteSync } : gitStatus}
          project={project}
          readOnly={!isNativeApp() || viewerMode}
          // A cloud cell commits every edit server-side as it lands, so the
          // working-tree half of this panel describes work that is already
          // saved. `cfg.cloud` is present exactly when the hub runs the
          // workspace agent that owns this project's history, which is the
          // same condition.
          //
          // PRESENTATION, NOT A CONTROL — nothing may come to depend on this.
          // `/_api/git/commit` and `/_api/git/discard` are classified `edit` in
          // the cell's route manifest and stay reachable by any member with a
          // session; withdrawing the buttons removes an offer that would
          // mislead, it does not remove a capability. The real gates are
          // server-side (`projectReadOnly`, the manifest's role matrix), and
          // they are unchanged by this flag.
          historyOnly={cellManaged}
          // DDR-218 (fix 8) — the DESKTOP half of the same withdrawal: a repo
          // linked+credentialed to Maude Cloud is cloud-managed (the cell
          // commits every edit as it lands), so the local Changes surface is
          // the second save mechanism the sync RCA's user was confused by.
          // Live: CloudBar lifts every link change (resolve/attach/detach)
          // into `cloudLinkedHub`. Same presentation-not-a-control rule as
          // `historyOnly` above; Disconnect restores the panel in place.
          cloudManaged={cloudManaged}
          resizing={resizingFor('changes')}
          onClose={() => setChangesOpen(false)}
          onCommit={gitCommit}
          onDiscard={gitDiscard}
          onPublish={gitPublish}
          onGetLatest={gitGetLatest}
          // WHICH HISTORY, decided at the ONE place the posture is named — not
          // inside the panel, which would be a second derivation of the rule
          // `cloud-managed-save-surfaces.test.ts` exists to keep singular.
          loadLog={cloudManaged ? gitLoadCloudLog : gitLoadLog}
          historySource={cloudManaged ? 'cloud' : 'local'}
          // What the cloud half of the header names. The cell reports its own
          // project and branch with the log; the hub host is the fallback,
          // because a header that names the LOCAL folder while listing the
          // CLOUD's commits is the confusion this feature exists to end.
          cloudHistory={cloudHistory}
          onOpenCanvas={(p) => openTab(p)}
          onOpenDiff={(file) => setDiffTarget({ file, beforeSha: 'HEAD', conflict: false })}
          activeCanvas={activeCanvasFile}
          onPreviewVersion={(sha) => setDiffTarget({ file: activePath, beforeSha: sha, conflict: false })}
          designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
        />
      );
    if (id === 'sync')
      return (
        <SyncPanel
          status={syncStatus}
          project={cfg?.cloud?.projectName || project}
          cloud={cfg?.cloud ?? null}
          groupPaths={(groups || []).map((g) => g.path).filter(Boolean)}
          resizing={resizingFor('sync')}
          onClose={() => setSyncPanelOpen(false)}
        />
      );
    if (id === 'inspector' || id === 'layers')
      return (
        <InspectorPanel
          // Cloud Phase 27 E4 — the parity spec asserts these two panels exist
          // in BOTH shells, so each needs a name a spec can ask for.
          testId={id === 'layers' ? 'layers-panel' : 'inspector-panel'}
          layersOnly={id === 'layers'}
          hideLayersTab={layersMode === 'separate'}
          cpMode={cpMode}
          onSetCpMode={setCpMode}
          selected={selected}
          cfg={cfg}
          tab={id === 'layers' ? 'layers' : inspectorTab}
          onTabChange={setInspectorTab}
          onClose={() => (id === 'layers' ? setLayersOpen(false) : setInspectorOpen(false))}
          onOptimistic={applyOptimisticStyle}
          onRecordEdit={recordSourceEdit}
          onReplaceMedia={onReplaceMedia}
          onResizeArtboard={resizeArtboardShell}
          onSetArtboardHug={setArtboardHugShell}
          onSetArtboardStyle={setArtboardStyleShell}
          onSetArtboardKind={setArtboardKindShell}
          onSetArtboardPrint={setArtboardPrintShell}
          onDuplicateArtboard={duplicateArtboardShell}
          editScope={editScope}
          onUndoRedo={(dir) => postToActiveCanvas({ dgn: dir })}
          photoSel={photoSel}
          photoRev={photoRev}
          onPhotoEdit={onPhotoEdit}
          onPhotoRemoveBackground={onPhotoRemoveBackground}
          onPhotoRecordEdit={onPhotoRecordEdit}
          onPhotoUndoRedo={(dir) => performPhotoUndo(dir === 'redo')}
          layersTree={layersTree}
          componentMap={componentMap}
          lockedKeys={lockedKeys}
          onToggleLock={toggleLockedKey}
          onDetachInstance={detachInstanceShell}
          canvasFile={activePath}
          onSelectLayer={(n) =>
            postToActiveCanvas({
              dgn: 'select-by-id',
              id: n.id,
              artboardId: layersTree?.artboardId,
              index: n.index,
            })
          }
          onHoverLayer={(n) =>
            postToActiveCanvas({
              dgn: 'highlight',
              id: n ? n.id : null,
              artboardId: layersTree?.artboardId,
              index: n ? n.index : 0,
            })
          }
          onReorderLayer={reorderLayer}
          layersBusyRef={layersBusyRef}
          resizing={resizingFor(id)}
        />
      );
    if (id === 'comments')
      return (
        <CommentsPanel
          commentsByFile={commentsByFile}
          filter={commentsFilter}
          setFilter={setCommentsFilter}
          activePath={activePath}
          focusedId={focusedCommentId}
          onJump={jumpToComment}
          // Cloud Phase 25 C2 — a viewer READS threads; the mutating actions
          // are absent until C3 lands comments on the cell's allowlist.
          onResolve={viewerMode ? undefined : resolveComment}
          onReopen={viewerMode ? undefined : reopenComment}
          onDelete={viewerMode ? undefined : deleteComment}
          resizing={resizingFor('comments')}
        />
      );
    return null;
  };

  return (
    <div
      className={'maude' + (presentMode ? ' is-present' : '')}
      data-theme={theme}
      onContextMenu={onShellContextMenu}
    >
      {firstRun && <OnboardingWizard />}
      <CloudRoleBanner cloud={cfg.cloud} />
      <UpdateBanner update={updateReady} onDismiss={() => setUpdateReady(null)} />
      <SyncBanner status={syncStatus} />
      {/* First-upgrade consent (Task 2) — global on purpose: a consent that
          only appears if you happen to open the Sync panel is not consent.
          Skipped during first-run onboarding so two flows don't stack. */}
      {!firstRun && <SyncConsentDialog status={syncStatus} cloud={cfg.cloud} />}
      <NotificationHost paused={!!usageNudge || !!tourSteps}
        hiddenGroups={exportCenter.panelOpen ? ['exports'] : []} />
      <WhatsNewToast wn={whatsNew} />
      <ExportToast center={exportCenter} />
      {gitLifecycle && (
        <div role="status" aria-live="polite" className="st-banner st-banner--info">
          <span className="st-banner-dot" aria-hidden="true" />
          <span>Repo state changed — reload to sync?</span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              try {
                window.location.reload();
              } catch {}
            }}
          >
            Reload
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setGitLifecycle(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="st-shell">
        <Menubar
          readOnly={viewerMode}
          // Cloud Phase 27 C2/C4 — the ONE cloud-only input the shared chrome
          // takes. A prop, not the whole `cfg`: the Menubar needs to know it is
          // in a browser tab on somebody else's machine, and nothing else.
          cloud={cfg.cloud}
          activePath={activePath}
          project={project}
          tabsCount={tabs.length}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          commentsPanelOpen={commentsPanelOpen}
          onToggleComments={() => toggleRightPanel('comments')}
          changesOpen={changesOpen}
          changesCount={unsavedCount}
          onToggleChanges={() => toggleRightPanel('changes')}
          onOpenSystem={openSystem}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => togglePanel('tree')}
          showHidden={showHidden}
          onToggleShowHidden={() => setShowHidden((v) => !v)}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onReportBug={() => setReportBugOpen(true)}
          onStartTour={() => startTour(USAGE_TOUR)}
          onStartCollabTour={() => startTour(COLLAB_TOUR)}
          annotationsVisible={annotationsVisible}
          onToggleAnnotations={toggleAnnotations}
          minimapVisible={minimapVisible}
          onToggleMinimap={toggleMinimap}
          zoomCtlVisible={zoomCtlVisible}
          onToggleZoomCtl={toggleZoomCtl}
          presentMode={presentMode}
          onTogglePresent={togglePresent}
          printGuidesVisible={printGuidesVisible}
          onTogglePrintGuides={togglePrintGuides}
          postToActiveCanvas={postToActiveCanvas}
          onOpenReadiness={() => setReadinessOpen(true)}
          onOpenQuickSetup={() => setQuickSetupOpen(true)}
          onWatchIntro={() => setIntroOpen(true)}
          onOpenWhatsNew={whatsNew.openPanel}
          whatsNewCount={whatsNew.unseen.length}
          exportCenter={exportCenter}
          artboardCount={activeArtboards}
          inspectorOpen={inspectorOpen}
          inspectorTab={inspectorTab}
          onToggleInspector={() => toggleRightPanel('inspector')}
          autoOpenInspector={autoOpenInspector}
          onToggleAutoOpenInspector={() => setAutoOpenInspector((v) => !v)}
          onInsertArtboard={onInsertArtboard}
          timelineOpen={timelineOpen}
          onToggleTimeline={toggleTimeline}
          hasComps={activeComps.length > 0}
          assistantOpen={assistantOpen}
          onToggleAssistant={() => toggleRightPanel('assistant')}
          assistantBusy={assistantBusy}
          assistantUnseen={assistantUnseen}
          onOpenLayers={() => {
            // feature-configurable-panel-docking — Layers is its own dockable
            // panel when layersMode==='separate' (toggle it), else it's the
            // Inspector's Layers tab (open the inspector on that tab).
            if (layersMode === 'separate') {
              togglePanel('layers');
            } else if (inspectorOpen && inspectorTab === 'layers') {
              setInspectorOpen(false);
            } else {
              setInspectorTab('layers');
              openPanelExclusive('inspector');
            }
          }}
          onNewCanvas={() => {
            openPanelExclusive('tree');
            setTimeout(
              () => document.querySelector('[aria-label="New blank brief board"]')?.click(),
              60
            );
          }}
          onAssembleVideo={assembleVideo}
          onOpenExport={(mode) => setExportDialog({ mode })}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenGenerate={() => setGenerateOpen(true)}
          onReload={reloadActive}
          onCloseCanvas={() => activePath && closeTab(activePath)}
          presence={
            <>
              <StAvatar
                initials={initialsOf(gitUser || 'you')}
                hue="var(--accent)"
                title={gitUser ? `${gitUser} (you)` : 'You'}
              />
              {agentActive && (
                <StAvatar
                  initials="C"
                  hue="var(--presence-agent)"
                  title="Claude · editing"
                  pulse
                />
              )}
            </>
          }
        />
        <div className={'st-body' + (dragSide ? ' is-resizing' : '')} ref={bodyRef}>
          {/* LEFT dock slot (feature-configurable-panel-docking) — the collapsed
              rail shows when the left slot is empty; the tree's expand hooks open
              it on the tree tab. */}
          <CollapsedRail
            shown={!leftActive}
            onExpand={() => openPanelExclusive('tree')}
            onSearch={() => {
              openPanelExclusive('tree');
              setTimeout(() => document.querySelector('.st-search input')?.focus(), 60);
            }}
          />
          {(leftActive || leftHostsAssistant) && (
            <DockSlot
              side="left"
              width={sbSize.w}
              open={!!leftActive}
              ids={leftIds}
              activeId={leftActive}
              onPick={togglePanel}
              labels={dockLabels}
            >
              {leftHostsAssistant && (
                <ChatPanel
                  hidden={leftActive !== 'assistant'}
                  activeCanvas={activeCanvasFile}
                  selected={selected}
                  openComments={activeOpenComments}
                  designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
                  resizing={resizingFor('assistant')}
                  onClose={() => setAssistantOpen(false)}
                  onBusyChange={setAssistantBusy}
                  onFinished={handleAssistantFinished}
                  onPermissionRequest={handleAssistantAttention}
                  onElicitationRequest={handleAssistantAttention}
                />
              )}
              {leftActive && leftActive !== 'assistant' && renderPanelBody(leftActive)}
            </DockSlot>
          )}
          {leftActive && (
            <PanelGrip
              label="Resize left panel"
              size={sbSize}
              active={dragSide === 'sb'}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setDragSide('sb');
              }}
            />
          )}
          <div className="main">
            <Viewport
              tabs={tabs}
              activePath={activePath}
              registerIframe={registerIframe}
              systemData={systemData}
              onOpenFromSystem={openTab}
              onSelectDs={loadSystemData}
              project={project}
              cfg={cfg}
              loadingPath={loadingPath}
              onIframeLoad={onIframeLoad}
              canvasError={canvasError}
              canvasReloadNonce={canvasReloadNonce}
              onRetryCanvasLoad={retryCanvasLoad}
              loadedPath={loadedPath}
              showQuickSetup={
                isNativeApp() && !viewerMode && !!setupReadiness && !setupReadiness.ready
              }
              onStartQuickSetup={() => setQuickSetupOpen(true)}
              previewPath={previewPath}
            />
          </div>
          {rightActive && (
            <PanelGrip
              label="Resize right panel"
              dir="rtl"
              size={rpSize}
              active={dragSide === 'rp'}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setDragSide('rp');
              }}
            />
          )}
          {/* RIGHT dock slot (feature-configurable-panel-docking). The Assistant
              (ACP) chat stays MOUNTED (display:none when inactive) so its stream
              survives a tab switch — DDR-123. Native-only. */}
          {(rightActive || rightHostsAssistant) && (
            <DockSlot
              side="right"
              width={rpSize.w}
              open={!!rightActive}
              ids={rightIds}
              activeId={rightActive}
              onPick={togglePanel}
              labels={dockLabels}
            >
              {rightHostsAssistant && (
                <ChatPanel
                  hidden={rightActive !== 'assistant'}
                  activeCanvas={activeCanvasFile}
                  selected={selected}
                  openComments={activeOpenComments}
                  designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
                  resizing={resizingFor('assistant')}
                  onClose={() => setAssistantOpen(false)}
                  onBusyChange={setAssistantBusy}
                  onFinished={handleAssistantFinished}
                  onPermissionRequest={handleAssistantAttention}
                  onElicitationRequest={handleAssistantAttention}
                />
              )}
              {rightActive && rightActive !== 'assistant' && renderPanelBody(rightActive)}
            </DockSlot>
          )}
        </div>
        {/* DDR-148 — Timeline is a BOTTOM dock (full-width strip below the stage,
            above the status bar) — video timelines are horizontal. */}
        {timelineOpen && (
          <TimelinePanel
            comps={activeComps}
            compId={timelineCompId}
            sequences={timelineSequences}
            audio={timelineAudio}
            transitions={timelineTransitions}
            total={timelineTotal}
            frame={timelineFrame}
            playing={timelinePlaying}
            loop={timelineLoop}
            onSeek={(f) => {
              setTimelineFrame(f);
              setTimelinePlaying(false);
              postToActiveCanvas({ dgn: 'timeline-seek', frame: f, id: timelineCompId });
            }}
            onPlay={() => {
              setTimelinePlaying(true);
              // Sync mute + loop to the Player, then play (the artboard has no
              // chrome — the Timeline owns transport/sound/loop now).
              postToActiveCanvas({ dgn: 'timeline-mute', muted: timelineMuted, id: timelineCompId });
              postToActiveCanvas({ dgn: 'timeline-loop', loop: timelineLoop, id: timelineCompId });
              postToActiveCanvas({ dgn: 'timeline-play', id: timelineCompId });
            }}
            onPause={() => {
              setTimelinePlaying(false);
              postToActiveCanvas({ dgn: 'timeline-pause', id: timelineCompId });
            }}
            onToggleLoop={() =>
              setTimelineLoop((v) => {
                const next = !v;
                postToActiveCanvas({ dgn: 'timeline-loop', loop: next, id: timelineCompId });
                return next;
              })
            }
            muted={timelineMuted}
            onToggleMute={() => {
              setTimelineMuted((v) => {
                const next = !v;
                postToActiveCanvas({ dgn: 'timeline-mute', muted: next, id: timelineCompId });
                return next;
              });
            }}
            volume={timelineVolume}
            onVolume={(v) => {
              setTimelineVolume(v);
              // Dragging volume implies "I want to hear it" — unmute.
              if (v > 0 && timelineMuted) {
                setTimelineMuted(false);
                postToActiveCanvas({ dgn: 'timeline-mute', muted: false, id: timelineCompId });
              }
              postToActiveCanvas({ dgn: 'timeline-volume', volume: v, id: timelineCompId });
            }}
            onRetime={(clipRef, patch) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 P2 / Task 3 — the panel hands a { stableId, index }
              // clipRef; stableId addressing wins (multi-comp-safe), the row
              // index stays as the legacy fallback when the enumerator is
              // unavailable.
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const clip = resolveClipRef(cc, clipRef);
                  const legacyIndex =
                    clipRef && typeof clipRef === 'object' ? clipRef.index : clipRef;
                  const body = clip?.stableId
                    ? {
                        canvas: activePath,
                        artboardId,
                        stableId: clip.stableId,
                        contentHash: clip.contentHash,
                        ...patch,
                      }
                    : { canvas: activePath, index: legacyIndex, ...patch };
                  return fetch('/_api/retime-sequence', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                  });
                })
                .then((r) => r.json())
                .then((j) => {
                  if (!j?.ok) {
                    console.warn('[retime]', j?.error || 'failed');
                    timelineOpFailed('Retime refused', j?.error);
                  } else {
                    shellToast(patch.from != null ? 'Clip moved.' : 'Clip trimmed.', true);
                    if (j?.seq != null)
                      pushTlUndo(activePath, j.seq, patch.from != null ? 'move clip' : 'trim clip');
                  }
                  // The file watcher reloads the canvas → re-announce → the
                  // source-fetch effect re-parses the new timing.
                })
                .catch(() => {});
            }}
            onRemove={timelineRemoveClip}
            onReplace={(clipRef) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 P3 + dogfood #5 — replace a clip's media. The file picker
              // MUST open synchronously inside the click gesture: browsers revoke
              // the transient user-activation after an await/fetch round-trip, so
              // the old fetch-then-click() silently no-oped ("replace neotevře
              // žádné okno"). Picker first; resolve the target + upload in the
              // change handler.
              replaceMediaViaPicker({
                accept: 'video/*,image/*',
                resolveTarget: (cc) => {
                  const clip = resolveClipRef(cc, clipRef);
                  if (clip?.mediaArrayRef) return { arrayRef: clip.mediaArrayRef };
                  if (clip?.mediaCdId) return { cdId: clip.mediaCdId };
                  return null;
                },
              });
            }}
            onReplaceAudio={(index) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 dogfood #5 — audio beds are addressable too: the
              // enumerator lists loose media (an <Audio> under the reel) with a
              // cd-id; ⇄ on the audio row swaps its src.
              replaceMediaViaPicker({
                accept: 'audio/*',
                resolveTarget: (cc) => {
                  const beds =
                    cc?.ok && Array.isArray(cc.media)
                      ? cc.media.filter((m) => m.tag === 'Audio')
                      : [];
                  return beds[index]?.cdId ? { cdId: beds[index].cdId } : null;
                },
              });
            }}
            onReplaceLayer={(clipRef, layerIndex) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 dogfood — replace a SPECIFIC layer inside an expanded clip
              // (the mp4 background separately from the title layer). Targets the
              // layer's own media (array-fed or literal-src) from the enumerator.
              const rowIndex = clipRef && typeof clipRef === 'object' ? clipRef.index : clipRef;
              const kind =
                timelineSequences[rowIndex]?.layers?.[layerIndex]?.kind === 'audio'
                  ? 'audio/*'
                  : timelineSequences[rowIndex]?.layers?.[layerIndex]?.kind === 'image'
                    ? 'image/*'
                    : 'video/*';
              replaceMediaViaPicker({
                accept: kind,
                resolveTarget: (cc) => {
                  const ly = resolveClipRef(cc, clipRef)?.layers?.[layerIndex];
                  if (ly?.mediaArrayRef) return { arrayRef: ly.mediaArrayRef };
                  if (ly?.mediaCdId) return { cdId: ly.mediaCdId };
                  return null;
                },
              });
            }}
            onReorder={(clipRef, direction) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 P5 — z-order reorder: move a standalone <Sequence> before/
              // after a sibling (render stacking; later sibling paints on top).
              // ▲ forward = move AFTER the next sibling; ▼ backward = move BEFORE
              // the previous sibling. Both clips addressed by comp-scoped stableId +
              // fingerprint (via /_api/comp-clips); the engine refuses a TransitionSeries
              // clip + a stale/raced target, then reloads via the file watcher.
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const seqs =
                    cc?.ok && Array.isArray(cc.clips)
                      ? cc.clips.filter((c) => c.kind === 'sequence')
                      : [];
                  const moved = resolveClipRef(cc, clipRef);
                  const index = moved ? seqs.indexOf(moved) : -1;
                  const refIdx = direction === 'forward' ? index + 1 : index - 1;
                  const ref = index >= 0 ? seqs[refIdx] || null : null;
                  const position = direction === 'forward' ? 'after' : 'before';
                  if (!moved?.stableId || !ref?.stableId) return null;
                  return fetch('/_api/reorder-sequence', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      canvas: activePath,
                      artboardId,
                      stableId: moved.stableId,
                      contentHash: moved.contentHash,
                      refStableId: ref.stableId,
                      refContentHash: ref.contentHash,
                      position,
                    }),
                  });
                })
                .then((r) => (r ? r.json() : null))
                .then((j) => {
                  if (j && !j.ok) {
                    console.warn('[reorder-clip]', j.error || 'failed');
                    timelineOpFailed('Reorder refused', j.error);
                  } else if (j?.seq != null) {
                    pushTlUndo(activePath, j.seq, 'reorder clip');
                  }
                })
                .catch(() => {});
            }}
            onToggleHide={(clipRef) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 dogfood — hide/show a clip (gates its body behind
              // {false && …}; the tag + time slot stay). Addressed by comp-scoped
              // stableId + fingerprint.
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const clip = resolveClipRef(cc, clipRef);
                  if (!clip?.stableId) return null;
                  return fetch('/_api/toggle-hide', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      canvas: activePath,
                      artboardId,
                      stableId: clip.stableId,
                      contentHash: clip.contentHash,
                    }),
                  });
                })
                .then((r) => (r ? r.json() : null))
                .then((j) => {
                  if (j && !j.ok) timelineOpFailed('Hide refused', j.error);
                  else if (j && j.ok) {
                    shellToast(j.hidden ? 'Clip hidden.' : 'Clip shown.', true);
                    if (j.seq != null) pushTlUndo(activePath, j.seq, j.hidden ? 'hide clip' : 'show clip');
                  }
                })
                .catch(() => shellToast('Hide failed: network error'));
            }}
            onReorderMove={(movedRef2, targetRef, position) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 6 — the magnetic drag commit: a real series MOVE (any
              // distance), addressed by stableId pair + fingerprints.
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const moved = resolveClipRef(cc, movedRef2);
                  const ref = resolveClipRef(cc, targetRef);
                  if (!moved?.stableId || !ref?.stableId) return null;
                  return fetch('/_api/reorder-sequence', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      canvas: activePath,
                      artboardId,
                      stableId: moved.stableId,
                      contentHash: moved.contentHash,
                      refStableId: ref.stableId,
                      refContentHash: ref.contentHash,
                      position,
                      mode: 'move',
                    }),
                  });
                })
                .then((r) => (r ? r.json() : null))
                .then((j) => {
                  if (j && !j.ok) {
                    console.warn('[reorder-move]', j.error || 'failed');
                    timelineOpFailed('Reorder refused', j.error);
                  } else if (j?.ok) {
                    shellToast('Clip moved.', true);
                    if (j.seq != null) pushTlUndo(activePath, j.seq, 'move clip');
                  }
                })
                .catch(() => shellToast('Reorder failed: network error'));
            }}
            onDropMedia={(files, pos) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 P4 + Task 6 — drop media onto the timeline. With a caret
              // position: index-aware storyline insert / frame-anchored
              // overlay-audio insert; multiple files insert in order. Audio
              // files always land in the audio band. Without a position, the
              // legacy append path.
              const artboardId = timelineArtboardId || undefined;
              const fps = timelineFps;
              const canvas = activePath;
              const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
              (async () => {
                // Dogfood fix — dropping media on the timeline of a canvas with
                // NO video-comp used to dead-end in "Insert refused: no
                // video-comp for this artboard". Drop-first means drop-first:
                // upload the files and spin up a NEW video-comp canvas cut from
                // them (same engine as File → Assemble), then open it.
                if (!activeComps.length) {
                  const clips = [];
                  for (const file of list) {
                    const mediaKind = file.type.startsWith('audio/')
                      ? 'audio'
                      : file.type.startsWith('video/')
                        ? 'video'
                        : null;
                    if (!mediaKind) continue;
                    try {
                      const r = await fetch('/_api/asset', {
                        method: 'POST',
                        headers: { 'Content-Type': file.type || 'application/octet-stream' },
                        body: file,
                      });
                      const up = await r.json().catch(() => ({}));
                      if (up?.path) clips.push({ src: up.path, mediaKind });
                      else shellToast(`Upload failed: ${up?.error || `HTTP ${r.status}`}`);
                    } catch {
                      shellToast('Upload failed: network error');
                    }
                  }
                  if (!clips.length) {
                    shellToast('No video/audio files in the drop — nothing to cut.');
                    return;
                  }
                  // 1) In-place upgrade: a `kind="video"` artboard on THIS
                  // canvas gets a VideoComp injected and takes the clips as
                  // storyline beats (server-side ensure). Falls through to a
                  // fresh "New Cut" canvas only when no artboard opted in.
                  let upgraded = false;
                  for (const c of clips) {
                    const probedSec = await probeMediaDuration(c.src).catch(() => null);
                    const body = {
                      canvas,
                      lane: c.mediaKind === 'audio' && upgraded ? 'audio' : 'storyline',
                      durationInFrames: durationFramesForDrop(fps, probedSec),
                      mediaTag: c.mediaKind === 'audio' ? 'Audio' : 'Video',
                      src: c.src,
                    };
                    if (body.lane === 'audio') body.from = 0;
                    const r = await fetch('/_api/insert-sequence', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(body),
                    }).catch(() => null);
                    const j = r ? await r.json().catch(() => null) : null;
                    if (j?.ok) {
                      upgraded = true;
                      if (j.seq != null) pushTlUndo(canvas, j.seq, 'add clip');
                    } else if (!upgraded) {
                      break; // no eligible artboard — New Cut fallback below
                    } else {
                      timelineOpFailed('Insert refused', j?.error);
                    }
                  }
                  if (upgraded) {
                    shellToast('Artboard upgraded to a video comp — clips added to the storyline.', true);
                    return;
                  }
                  for (let n = 0; n < 8; n += 1) {
                    const name = n === 0 ? 'New Cut' : `New Cut ${n + 1}`;
                    const r = await fetch('/_api/canvas', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name, kind: 'video-comp', clips }),
                    }).catch(() => null);
                    const j = r ? await r.json().catch(() => ({})) : {};
                    if (r?.status === 409) continue; // name taken — try the next
                    if (!r?.ok || !j.ok) {
                      shellToast(`New cut failed: ${j.error || 'create refused'}`);
                      return;
                    }
                    await loadTree();
                    openTab(j.file);
                    shellToast(`Started a new cut from ${clips.length} clip${clips.length > 1 ? 's' : ''}.`, true);
                    return;
                  }
                  shellToast('New cut failed: too many "New Cut" canvases — rename some.');
                  return;
                }
                let slot = pos?.lane === 'storyline' ? pos.index : undefined;
                for (const file of list) {
                  const mediaTag = file.type.startsWith('video/')
                    ? 'Video'
                    : file.type.startsWith('audio/')
                      ? 'Audio'
                      : file.type.startsWith('image/')
                        ? 'Img'
                        : null;
                  if (!mediaTag) continue;
                  let up;
                  try {
                    const r = await fetch('/_api/asset', {
                      method: 'POST',
                      headers: { 'Content-Type': file.type || 'application/octet-stream' },
                      body: file,
                    });
                    up = await r.json().catch(() => ({}));
                  } catch {
                    up = null;
                  }
                  if (!up?.path) {
                    shellToast(`Upload failed: ${up?.error || 'server unreachable — retry in a moment'}`);
                    continue;
                  }
                  const isAudio = mediaTag === 'Audio';
                  // Video clips carry a real duration — probe it so the drop
                  // lands at the clip's own length instead of a fixed 3s that
                  // the user then has to drag out by hand. Images have no
                  // inherent duration, so they keep the fallback.
                  const probedSec =
                    mediaTag === 'Video' ? await probeMediaDuration(up.path).catch(() => null) : null;
                  const body = { canvas, artboardId, mediaTag, src: up.path };
                  if (pos && (isAudio || pos.lane === 'audio')) {
                    body.lane = 'audio';
                    body.from = Math.max(0, pos.frame ?? 0);
                    // Default: stretch toward the end of the cut.
                    body.durationInFrames = Math.max(fps, timelineTotal - body.from);
                  } else if (pos?.lane === 'storyline' && !isAudio) {
                    body.lane = 'storyline';
                    if (slot != null) {
                      body.index = slot;
                      slot += 1; // multiple files insert in order
                    }
                    body.durationInFrames = durationFramesForDrop(fps, probedSec);
                  } else if (pos?.lane === 'overlay' && !isAudio) {
                    if ((timelineSequences || []).length === 0) {
                      // First clip of a greenfield comp = the BASE layer →
                      // storyline, wherever it was dropped.
                      body.lane = 'storyline';
                    } else {
                      body.lane = 'overlay';
                      body.from = Math.max(0, pos.frame ?? 0);
                    }
                    body.durationInFrames = durationFramesForDrop(fps, probedSec);
                  } else if (!isAudio) {
                    // Default container rule: a video/image drop ANYWHERE on the
                    // timeline lands in the storyline (append = hard cut at the
                    // end; the caret gives it an index). The old lane-less
                    // append refused hard-cut series ("no transition to clone").
                    body.lane = 'storyline';
                    body.durationInFrames = durationFramesForDrop(fps, probedSec);
                  } else {
                    // Audio without a caret → audio band, from the start.
                    body.lane = 'audio';
                    body.from = 0;
                    body.durationInFrames = Math.max(fps, timelineTotal);
                  }
                  try {
                    const r = await fetch('/_api/insert-sequence', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(body),
                    });
                    const j = await r.json().catch(() => null);
                    if (j && !j.ok) {
                      console.warn('[insert-clip]', j.error || 'failed');
                      timelineOpFailed('Insert refused', j.error);
                    } else if (j?.ok) {
                      shellToast('Clip added to the timeline.', true);
                      if (j.seq != null) pushTlUndo(canvas, j.seq, 'add clip');
                    }
                  } catch {
                    shellToast('Insert failed: network error');
                  }
                }
              })();
            }}
            height={timelineHeight}
            onResize={setTimelineHeight}
            onClose={() => setTimelineOpen(false)}
            selectedClipId={timelineSelectedClip}
            onSelect={setTimelineSelectedClip}
            transitionClips={timelineTransClips}
            onClipVerb={timelineClipVerb}
            comments={(commentsByFile[activePath] || []).filter((c) => c && c.timeline)}
            promptText={askText}
            onAddComment={timelineAddComment}
            onResolveComment={(id) =>
              wsSend({ type: 'comments-patch', id, patch: { status: 'resolved' } })
            }
            onDeleteComment={(id) => wsSend({ type: 'comments-delete', id })}
            onSplitAtPlayhead={() => {
              const s = tlKeyRef.current;
              let ref = s.selected != null ? { stableId: s.selected } : null;
              if (!ref) {
                const rows = s.sequences || [];
                const under =
                  rows.find(
                    (r2) => r2.series && s.frame >= r2.from && s.frame < r2.from + r2.duration
                  ) || rows.find((r2) => s.frame >= r2.from && s.frame < r2.from + r2.duration);
                if (under?.stableId) ref = { stableId: under.stableId };
              }
              if (ref) timelineClipVerb(ref, 'split', { atFrame: s.frame });
              else shellToast('Nothing under the playhead to split.');
            }}
            onAddTitle={(frame) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 19 — "+ Title": inserts immediately with a default text —
              // edit it via double-click → inspector → Text (the artboard's
              // Player DOM isn't the canvas edit surface, so inline editing
              // happens in the timeline inspector).
              Promise.resolve('Title').then((text) => {
              if (!text) return;
              const fps = timelineFps;
              fetch('/_api/insert-sequence', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  canvas: activePath,
                  artboardId: timelineArtboardId || undefined,
                  lane: 'overlay',
                  from: frame,
                  durationInFrames: Math.round(fps * 3),
                  mediaTag: 'Title',
                  src: text,
                }),
              })
                .then((r) => r.json().catch(() => null))
                .then((j) => {
                  if (j && !j.ok) timelineOpFailed('Title refused', j.error);
                  else if (j?.ok) {
                    shellToast('Title added.', true);
                    if (j.seq != null) pushTlUndo(activePath, j.seq, 'add title');
                  }
                })
                .catch(() => shellToast('Title failed: network error'));
              });
            }}
            onAddAiClip={() => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 22 — "+ AI clip": a prompt-carrying slate beat at the end
              // of the storyline. NO modal (user steer 2026-07-30) — the slate
              // lands with a starter prompt the user rewrites IN PLACE
              // (double-click the slate text in the artboard, or Text tab).
              (async () => {
              const prompt = 'Describe this shot — double-click to edit';
              const kind = 'veo';
              const fps = timelineFps;
              fetch('/_api/insert-sequence', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  canvas: activePath,
                  artboardId: timelineArtboardId || undefined,
                  lane: 'storyline',
                  durationInFrames: Math.round(fps * 5),
                  placeholder: { prompt, kind },
                }),
              })
                .then((r) => r.json().catch(() => null))
                .then((j) => {
                  if (j && !j.ok) timelineOpFailed('AI clip refused', j.error);
                  else if (j?.ok) {
                    shellToast('AI placeholder added — double-click its text to write the prompt, then right-click → Generate ✨.', true);
                    if (j.seq != null) pushTlUndo(activePath, j.seq, 'add AI placeholder');
                  }
                })
                .catch(() => shellToast('AI clip failed: network error'));
              })();
            }}
            onGeneratePlaceholder={(clipRef) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 22 — hand the prompt to the existing generation spine
              // (DDR-164), then poll the job and swap the slate in place. The
              // placeholder stays fully editable while the job runs; the final
              // swap re-resolves by stableId with a FRESH fingerprint.
              const canvas = activePath;
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const clip = resolveClipRef(cc, clipRef);
                  const ph = clip?.placeholder;
                  if (!clip?.stableId || !ph?.prompt) {
                    shellToast('No AI placeholder prompt on this clip.');
                    return;
                  }
                  const modality = ph.kind === 'image' ? 'image' : 'video';
                  const prompt =
                    ph.kind === 'motion'
                      ? `Clean, minimal motion-graphics animation (flat shapes, smooth easing): ${ph.prompt}`
                      : ph.prompt;
                  fetch('/_api/generate-jobs', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ provider: 'gemini', modality, prompt }),
                  })
                    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
                    .then((job) => {
                      const jobId = job?.id;
                      if (!jobId) throw new Error('no job id');
                      shellToast(`Generating ${ph.kind}… (runs in the background)`, true);
                      const stableId = clip.stableId;
                      const poll = () => {
                        fetch('/_api/generate-jobs')
                          .then((r) => r.json().catch(() => ({})))
                          .then((d) => {
                            const j2 = (d?.jobs || []).find((x) => x.id === jobId);
                            if (!j2 || j2.status === 'failed') {
                              shellToast(`Generation failed: ${j2?.error || 'job lost'}`);
                              return;
                            }
                            if (j2.status !== 'done') {
                              setTimeout(poll, 4000);
                              return;
                            }
                            const asset = j2.assets?.[0];
                            if (!asset) {
                              shellToast('Generation finished but produced no asset.');
                              return;
                            }
                            // Fresh fingerprint at swap time (the clip may have
                            // been retimed/moved meanwhile — that's fine).
                            fetch(ccUrl)
                              .then((r) => r.json().catch(() => ({})))
                              .then((cc2) => {
                                const live = resolveClipRef(cc2, { stableId });
                                if (!live?.stableId) {
                                  shellToast('Placeholder clip is gone — generated asset kept in assets/.');
                                  return;
                                }
                                timelineClipVerb({ stableId: live.stableId }, 'resolve-placeholder', {
                                  src: asset,
                                  mediaKind: modality === 'image' ? 'image' : 'video',
                                });
                              });
                          })
                          .catch(() => setTimeout(poll, 6000));
                      };
                      setTimeout(poll, 3000);
                    })
                    .catch((e) =>
                      shellToast(`Generate failed: ${e?.message || 'provider error'} — is a Gemini key set in Settings?`)
                    );
                })
                .catch(() => shellToast('Generate failed: network error'));
            }}
            onAddImage={(frame) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 19 — "+ Image": picker → content-addressed upload →
              // overlay-lane <Img> at the playhead. WKWebView can't open an
              // HTML file input, so native goes through the Rust pick dialog.
              const uploadPicked = (blob, type) => {
                const fps = timelineFps;
                fetch('/_api/asset', {
                  method: 'POST',
                  headers: { 'Content-Type': type || 'application/octet-stream' },
                  body: blob,
                })
                  .then((r) => r.json().catch(() => ({})))
                  .then((up) => {
                    if (!up?.path) {
                      shellToast(`Upload failed: ${up?.error || 'unknown error'}`);
                      return null;
                    }
                    return fetch('/_api/insert-sequence', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        canvas: activePath,
                        artboardId: timelineArtboardId || undefined,
                        lane: 'overlay',
                        from: frame,
                        durationInFrames: Math.round(fps * 3),
                        mediaTag: 'Img',
                        src: up.path,
                      }),
                    });
                  })
                  .then((r) => (r ? r.json() : null))
                  .then((j) => {
                    if (j && !j.ok) timelineOpFailed('Image refused', j.error);
                    else if (j?.ok) {
                      shellToast('Image overlay added.', true);
                      if (j.seq != null) pushTlUndo(activePath, j.seq, 'add image overlay');
                    }
                  })
                  .catch(() => shellToast('Image failed: network error'));
              };
              if (isNativeApp()) {
                pickMediaFile()
                  .then((picked) => {
                    if (picked?.bytes) uploadPicked(new Blob([new Uint8Array(picked.bytes)]), '');
                  })
                  .catch((e2) => shellToast(`Image pick failed: ${e2?.message || 'dialog error'}`));
                return;
              }
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.addEventListener('change', () => {
                const file = input.files?.[0];
                if (file) uploadPicked(file, file.type);
              });
              input.click();
            }}
            resolveMediaUrl={(p) =>
              `/${(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}/${p}`
            }
          />
        )}
        <StatusBar
          activePath={activePath}
          selected={selected}
          wsConnected={wsConnected}
          openCount={totalOpen}
          theme={theme}
          onToggleTheme={toggleTheme}
          onClearSelected={clearSelected}
          syncStatus={syncStatus}
          syncProject={cfg?.cloud?.projectName || project}
          syncOpen={syncPanelOpen}
          // Toggle through the dock helpers so the one-panel-per-side invariant
          // holds (opening Sync closes whatever else the right slot shows).
          onOpenSync={syncStatus ? () => toggleRightPanel('sync') : undefined}
          changesCount={unsavedCount}
          // `unpushed` is a LOCAL-git offer ("N to publish"), and the panel has
          // withdrawn Publish under either managed posture — so the chip must
          // not keep advertising it either.
          unpushed={savingIsManaged ? 0 : gitStatus?.unpushed || 0}
          savingIsManaged={savingIsManaged}
          changesOpen={changesOpen}
          onOpenChanges={gitStatus?.repo ? () => setChangesOpen(true) : undefined}
          version={cfg?.version}
        />
      </div>
      {presentMode && (
        <button
          type="button"
          className="st-present-exit"
          onClick={exitPresent}
          aria-label="Exit presentation mode"
          title="Exit presentation mode (Esc)"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span>Exit presentation</span>
          <kbd className="st-present-exit-kbd">Esc</kbd>
        </button>
      )}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
      {shellPromptState && (
        <div
          className="st-scrim"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settleShellPrompt(null);
          }}
        >
          <div className="st-dialog st-prompt" role="dialog" aria-modal="true" aria-label={shellPromptState.title}>
            <div className="st-dialog-hd">
              <span className="st-dialog-title">{shellPromptState.title}</span>
            </div>
            <div className="st-dialog-bd">
              <input
                className="st-input"
                data-testid="shell-prompt-input"
                autoFocus
                defaultValue={shellPromptState.value}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') settleShellPrompt(e.currentTarget.value);
                  else if (e.key === 'Escape') settleShellPrompt(null);
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="button" className="tlci-btn" onClick={() => settleShellPrompt(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="tlci-btn"
                  data-testid="shell-prompt-ok"
                  onClick={(e) =>
                    settleShellPrompt(
                      e.currentTarget.closest('.st-dialog')?.querySelector('input')?.value ?? ''
                    )
                  }
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {exportDialog && (
        <ExportDialog
          mode={exportDialog.mode}
          initialScope={exportDialog.scope}
          activePath={activePath}
          hasComps={activeComps.length > 0}
          comps={activeComps}
          // Which artboard "Active artboard" scope targets. The shell can't query
          // the cross-origin canvas DOM (the in-canvas dialog's activeArtboardId),
          // so use the tracked signals: an explicit selection wins, else the
          // viewport-active artboard canvas-lib reports on pan. Without this,
          // scope=artboard fell back to `:first-of-type` (always the first).
          activeArtboardId={selected?.artboardId ?? canvasActiveArtboard ?? null}
          selection={selected?.selector ? { selector: selected.selector, file: selected.file } : null}
          exportLane={cfg.exportLane || 'local'}
          onBrowserCapture={captureFromCanvas}
          onClose={() => setExportDialog(null)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          cloud={cfg.cloud}
          onClose={() => setSettingsOpen(false)}
          initialTab={typeof settingsOpen === 'string' ? settingsOpen : undefined}
          theme={theme}
          onSetTheme={setTheme}
          cpMode={cpMode}
          onSetCpMode={setCpMode}
          minimapVisible={minimapVisible}
          onToggleMinimap={toggleMinimap}
          zoomCtlVisible={zoomCtlVisible}
          onToggleZoomCtl={toggleZoomCtl}
          annotationsVisible={annotationsVisible}
          onToggleAnnotations={toggleAnnotations}
          autoOpenInspector={autoOpenInspector}
          onToggleAutoOpenInspector={() => setAutoOpenInspector((v) => !v)}
          hasCanvas={!!activePath && activePath !== SYSTEM_TAB}
          panelSide={panelSide}
          onSetPanelSide={(id, side) => setPanelSide((prev) => ({ ...prev, [id]: side }))}
          layersMode={layersMode}
          onSetLayersMode={(m) => {
            setLayersMode(m);
            // Leaving separate mode retires the standalone Layers panel.
            if (m !== 'separate') setLayersOpen(false);
          }}
        />
      )}
      {generateOpen && (
        <GenerateDialog onClose={() => setGenerateOpen(false)} onInsert={insertGeneratedImage} />
      )}
      {assetPickerReq && (
        <AssetPicker
          designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
          onPick={onAssetPicked}
          onClose={() => setAssetPickerReq(null)}
          multiple={!!assetPickerReq.multiple}
          hasArtboardAnchor={!!assetPickerReq.hasArtboardAnchor}
          onPickMany={onPickMany}
        />
      )}
      {stickerPickerReq && (
        <StickerPicker onPick={onStickerPicked} onClose={() => setStickerPickerReq(null)} />
      )}
      {diffTarget && (
        <DiffView
          target={diffTarget}
          cfg={cfg}
          loadLog={gitLoadLog}
          onClose={() => setDiffTarget(null)}
          onRestore={async (file) => {
            const res = await gitDiscard([file]);
            if (res?.ok) setDiffTarget(null);
            else window.alert(res?.error || 'Could not restore that version. Try again.');
          }}
          onResolve={async (choice) => {
            // phase-28 (E3): apply the chosen side via /_api/git/resolve, which
            // completes the two-parent merge commit (and for "both" saves our
            // version as a "(mine)" copy — zero loss). Close on success; keep the
            // resolver open with the error otherwise.
            const res = await gitResolveConflict(choice);
            if (res.ok) {
              setDiffTarget(null);
            } else {
              window.alert(res.error || 'Could not finish the merge. Get the latest again, then retry.');
            }
          }}
        />
      )}
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onStartTour={() => {
          setHelpOpen(false);
          startTour(USAGE_TOUR);
        }}
      />
      {/* `activeCanvas` is THIS window's truth. The server's `_active.json` is
          global and sticky — it survives closing every tab and is written by any
          other session (an agent driving a headless browser, a second window),
          so a report built from it can claim a canvas the user does not have
          open, and capture it. Pass what this client actually shows. */}
      <ReportBugDialog
        open={reportBugOpen}
        activeCanvas={activePath}
        onClose={() => setReportBugOpen(false)}
      />
      <WhatsNewPanel wn={whatsNew} onStartTour={startTour} />
      <ExportPanel center={exportCenter} />
      <ReadinessDialog open={readinessOpen} onClose={() => setReadinessOpen(false)} />
      <IntroVideoDialog open={introOpen} onClose={() => setIntroOpen(false)} />
      <SetupChecklistDialog
        open={quickSetupOpen}
        onClose={() => setQuickSetupOpen(false)}
        onStartTour={() => startTour(QUICK_SETUP_TOUR)}
        onBringBrand={() => setBrandUploadOpen(true)}
        onImportFigma={() => setFigmaImportOpen(true)}
      />
      <BrandUploadPanel open={brandUploadOpen} onClose={() => setBrandUploadOpen(false)} />
      {figmaImportOpen && (
        <FigmaImportPanel
          onClose={() => setFigmaImportOpen(false)}
          onImported={() => loadTree()}
        />
      )}
      {usageNudge && !tourSteps && !collabNudge && (
        <div className="mdcc-tour-nudge" role="status" aria-live="polite">
          <div className="mdcc-tour-nudge__body">
            New here? Take a 60-second tour of the canvas browser.
          </div>
          <button
            type="button"
            className="mdcc-tour-nudge__cta"
            onClick={() => {
              markUsageSeen();
              startTour(USAGE_TOUR);
            }}
          >
            Start
          </button>
          <button
            type="button"
            className="mdcc-tour-nudge__skip"
            aria-label="Dismiss"
            onClick={markUsageSeen}
          >
            ×
          </button>
        </div>
      )}
      {/* Phase 29 (E4) — the collab "rychlý kurz", offered once after onboarding. */}
      {collabNudge && !tourSteps && (
        <div className="mdcc-tour-nudge" role="status" aria-live="polite">
          <div className="mdcc-tour-nudge__body">
            New to working with a team? See how saving &amp; sharing works — 60 seconds.
          </div>
          <button
            type="button"
            className="mdcc-tour-nudge__cta"
            onClick={() => {
              markCollabSeen();
              startTour(COLLAB_TOUR);
            }}
          >
            Start
          </button>
          <button
            type="button"
            className="mdcc-tour-nudge__skip"
            aria-label="Dismiss"
            onClick={markCollabSeen}
          >
            ×
          </button>
        </div>
      )}
      <TourOverlay
        steps={tourSteps ?? []}
        open={!!tourSteps}
        onClose={() => setTourSteps(null)}
        onComplete={markUsageSeen}
        bus={tourBus}
        hasSelection={!!selected}
        hasCanvas={tabs.length > 0}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
