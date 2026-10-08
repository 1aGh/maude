// shell/constants.js — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

export const USAGE_TOUR_STORE = 'mdcc-usage-tour-seen';

// Phase 29 (E4) — the collab "rychlý kurz" is offered once after onboarding.
export const COLLAB_TOUR_STORE = 'mdcc-collab-tour-seen';

export const SYSTEM_TAB = '__system__';

export const THEME_STORE = 'mdcc-theme';

export const SHOW_HIDDEN_STORE = 'mdcc-show-hidden';

// DDR-171 — CSS panel vocabulary mode ('advanced' | 'designer'), read inside
// CssKnobs.
export const CP_MODE_STORE = 'maude-cp-mode';

export const SIDEBAR_STORE = 'mdcc-sidebar-open';

export const MINIMAP_STORE = 'mdcc-minimap-visible';

export const ZOOMCTL_STORE = 'mdcc-zoomctl-visible';

export const ANNOT_STORE = 'mdcc-annotations-visible';

export const AUTOOPEN_STORE = 'maude-auto-open-inspector';

// DDR-185 security addendum — floor between OS notifications for a NEW
// permission/elicitation request, so a burst of distinct pending approvals
// (capped at 15 total server-side, DDR-179/180) reads as one attention-
// getting ping instead of a rapid-fire flood. The in-app badge is unaffected.
export const ATTENTION_NOTIFY_COOLDOWN_MS = 30_000;

export const PANEL_SIDES_STORE = 'mdcc-panel-sides';

export const LAYERS_MODE_STORE = 'mdcc-layers-mode';

export const CANVAS_EXT_RE = /\.(tsx|html?)$/i;

// A canvas the shell builds as a module and that reports `canvas-rendered`
// itself, as opposed to a legacy .html canvas that is drawn on `load`.
export const isModuleCanvasPath = (p) => /\.(tsx|jsx)$/i.test(String(p || ''));

// Bun's `define` substitutes this at build time (see build.ts); falls back when
// the bundle is consumed in a context that hasn't run the build.
export const MDCC_VERSION = typeof __MDCC_VERSION__ !== 'undefined' ? __MDCC_VERSION__ : 'dev';

// Stable empty list for the Sidebar while the tree state hydrates.
export const EMPTY_GROUPS = [];

// DDR-223 (issue #93, supersedes DDR-187's boot half) — one-time first-run
// teaching hint. Authoring canvases now boot into EDIT (`move`/V armed): click
// selects like Figma, and the mock is inert until the Preview toggle flips the
// alive posture back on. Teach exactly that ONCE, gated by a NEW localStorage
// marker (`maude-mode-hint-seen` — deliberately not the old
// `maude-browse-hint-seen`, which taught the opposite posture; every existing
// user should see the new hint once). Read-only viewers still boot preview
// (alive) and keep the DDR-187 wording. Auto-dismisses; the taught gesture
// (V in read-only) clears it early.
export const MODE_HINT_SEEN = 'maude-mode-hint-seen';
