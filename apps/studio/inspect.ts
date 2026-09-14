// Active-canvas state, selected-element tracking, and HTML injection
// (inspector overlay + canvas runtime). See plan Task 7 + DDR-007.

import path from 'node:path';

import type { Context } from './context.ts';
import { normalizeSessionKey, sessionFile } from './session-scope.ts';

export interface SelectedElement {
  file: string;
  /** CSS-selector path (v1 anchor). Always present for backwards-compat + legacy HTML canvases. */
  selector: string;
  /** Occurrence index among `querySelectorAll(selector)` — disambiguates a
   * component repeated within one artboard. Absent → first match. */
  index?: number;
  tag: string;
  classes: string;
  text: string;
  dom_path: string[];
  bounds: { x: number; y: number; w: number; h: number } | null;
  html: string;
  ts: string;
  /**
   * Schema version. v2 = TSX canvas with a `data-cd-id` anchor at click target
   * (or any ancestor — script walks via `closest()`); v1 = no `data-cd-id`
   * anywhere (legacy `.html` canvases, or click on shell chrome of a TSX
   * canvas). Readers must accept both during the grace window.
   */
  v: 1 | 2;
  /** Stable per-element id from canvas-pipeline two-pass transform. Present only when v === 2. */
  id?: string;
  /**
   * Canvas slug — POSIX, extension-less, relative to designRoot. Matches
   * `_locator.json` top-level keys. Present only when v === 2. The inspector
   * derives it server-side from `file` (stripping `<designRoot>/` prefix + `.tsx`).
   */
  canvas?: string;
  /**
   * Canvas-file mtime (ms) at capture — the drift-gate stamp
   * (feature-acp-context-hardening). `data-cd-id` is POSITIONAL, not content
   * identity, so a selection restored after another agent edited the canvas
   * must not be trusted blindly. 0 = mtime unavailable.
   */
  canvas_mtime?: number;
  /**
   * Set on restore-from-`selections` when the canvas changed since capture
   * (mtime mismatch). Consumers re-anchor via `data-dc-element`/selector or
   * degrade to canvas-wide — never trust the positional id when stale.
   */
  stale?: boolean;
  /**
   * feature-photo-editor (Task 14) — which photo-editing context this
   * selection is (an artboard `<img>` vs. an annotation `ImageStroke`), and
   * the resolved `assets/<sha8>.<ext>` source. Client-derived (dom-selection.ts
   * re-reads the live DOM, including a `data-photo-asset` tag stamped after an
   * edit bakes) — round-tripped here (not dropped like the OTHER client-only
   * fields such as `authored`/`computed`/`attrs`) because, unlike those, there
   * is no cheap way to re-derive it from a plain server-side restore: losing it
   * silently drops the Inspector's Photo tab on every canvas switch / reconnect
   * until a fresh click re-selects the element.
   */
  photoKind?: 'artboard-img' | 'annotation-image';
  photoAsset?: string;
}

/**
 * Phase 4.1: `selected` widens from `SelectedElement | null` to
 * `SelectedElement | SelectedElement[] | null` for multi-select via canvas-shell
 * input router. Readers must accept all three shapes. Writer below emits a
 * single object when cardinality is 1 (back-compat with `/design:edit` +
 * downstream tools that read the legacy shape) and an array for N > 1.
 */
export type SelectedValue = SelectedElement | SelectedElement[] | null;

export interface ActiveState {
  active: string | null;
  open_tabs: string[];
  selected: SelectedValue;
  /**
   * Per-canvas selection memory, keyed by canvas slug
   * (feature-acp-context-hardening). Additive: `selected` above stays the
   * ACTIVE canvas's mirror, so every legacy reader (prep.sh SEL_VALID,
   * /design:edit step 3, handoff tooling) keeps working unchanged — the same
   * back-compat philosophy as the Phase 4.1 obj→arr widening. Non-active
   * entries carry `html: ''` (size cap — locators survive, the 4000-char
   * payload doesn't multiply across N canvases).
   */
  selections: Record<string, SelectedValue>;
  last_change: string | null;
  session_started: string;
  active_comments?: unknown[];
}

type SetSelectedInput =
  | Omit<SelectedElement, 'ts' | 'v' | 'canvas'>
  | Array<Omit<SelectedElement, 'ts' | 'v' | 'canvas'>>
  | null;

export interface Inspect {
  /** Whose state this is — `''` for the shared singleton (D3). */
  sessionKey: string;
  state: ActiveState;
  load(): Promise<void>;
  setActive(file: string): void;
  setOpenTabs(tabs: string[]): void;
  setSelected(sel: SetSelectedInput): void;
  /**
   * feature-file-tree-drag-drop-folders (Task 3) — a canvas moved server-side
   * (`moveCanvas`). Retarget every reference to the OLD designRel-prefixed
   * file path (`active`, `open_tabs[]`, the active `selected`) to the new
   * one, and re-key the parked `selections` map entry from the old slug to
   * the new one. Returns whether anything actually changed (so the caller
   * can skip an unnecessary `canvas-list-update` detail). Idempotent no-op
   * when the moved canvas wasn't referenced anywhere in this state.
   */
  retarget(fromFile: string, toFile: string): boolean;
  /** Forget a deleted canvas without moving its selection onto another file. */
  remove(file: string): boolean;
  save(): Promise<void>;
  injectInspector(html: string): string;
}

const NEW = (): ActiveState => ({
  active: null,
  open_tabs: [],
  selected: null,
  selections: {},
  last_change: null,
  session_started: new Date().toISOString(),
});

export function createInspect(
  ctx: Context,
  loadActiveComments: (file: string) => Promise<unknown[]>,
  /**
   * Whose state this is — Cloud Phase 27 D3. `''` is the shared singleton every
   * desktop has always had; a non-empty key gives one member of a cell their
   * own selection, their own open tab, and their own `_active.<key>.json`.
   */
  sessionKey = ''
): Inspect {
  const state: ActiveState = NEW();
  const activeFile = sessionFile(ctx.paths.activeFile, sessionKey);
  let saveQueued = false;

  async function save() {
    saveQueued = false;
    try {
      // Bun.write creates parent dirs automatically — no .keep poke needed.
      let active_comments: unknown[] = [];
      if (state.active) {
        try {
          active_comments = await loadActiveComments(state.active);
        } catch {
          /* ignore */
        }
      }
      const enriched = { ...state, active_comments };
      await Bun.write(activeFile, JSON.stringify(enriched, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('  warn: failed to save _active.json:', msg);
    }
  }

  function scheduleSave() {
    if (saveQueued) return;
    saveQueued = true;
    queueMicrotask(save);
  }

  async function load() {
    try {
      const raw = await Bun.file(activeFile).text();
      const prev = JSON.parse(raw);
      Object.assign(state, prev, { session_started: new Date().toISOString() });
      // Pre-selections _active.json (or a hand-edited one) → keep the invariant.
      if (!state.selections || typeof state.selections !== 'object') state.selections = {};
    } catch {
      // first boot
    }
  }

  /** Canvas-file mtime for the drift-gate stamp. `file` is repoRoot-relative
   *  (designRel-prefixed, as the iframe reports it). Best-effort 0. Clamp to
   *  designRoot: `file` originates in the (untrusted, DDR-054) canvas via the
   *  origin-checked postMessage relay, and we `stat` it — a `../../../etc/…`
   *  must not turn this into a filesystem existence/mtime oracle (defender S1;
   *  mirrors localDepsFromSource's clamp). */
  function mtimeFor(file: string): number {
    try {
      const rel = (file || '').replace(/^\/+/, '');
      if (!rel) return 0;
      const abs = path.resolve(ctx.paths.designRoot, path.relative(ctx.paths.designRel, rel));
      const root = path.resolve(ctx.paths.designRoot);
      if (abs !== root && !abs.startsWith(root + path.sep)) return 0;
      const mt = Bun.file(abs).lastModified;
      return Number.isFinite(mt) ? mt : 0;
    } catch {
      return 0;
    }
  }

  /** Size cap for parked (non-active) selections — locators survive, the
   *  4000-char outerHTML doesn't multiply across N canvases. */
  function stripHtml(sel: SelectedValue): SelectedValue {
    if (sel == null) return sel;
    const strip = (e: SelectedElement): SelectedElement => ({ ...e, html: '' });
    return Array.isArray(sel) ? sel.map(strip) : strip(sel);
  }

  /** Restore the incoming canvas's parked selection, drift-gated: a canvas
   *  edited since capture gets `stale: true` on every element (positional
   *  data-cd-id must not be trusted across another writer's edit). */
  function restoreFor(file: string): SelectedValue {
    const parked = state.selections[deriveCanvasSlug(file)];
    if (parked == null) return null;
    const current = mtimeFor(file);
    const gate = (e: SelectedElement): SelectedElement =>
      e.canvas_mtime && current && e.canvas_mtime !== current ? { ...e, stale: true } : e;
    return Array.isArray(parked) ? parked.map(gate) : gate(parked);
  }

  function setActive(file: string) {
    if (typeof file !== 'string') return;
    if (state.active === file) return;
    // Park the outgoing canvas's selection (html-stripped) instead of losing
    // it — the root fix for "switch canvas → agent loses my selection"
    // (feature-acp-context-hardening).
    if (state.active && state.selected != null) {
      state.selections[deriveCanvasSlug(state.active)] = stripHtml(state.selected);
    }
    state.active = file || null;
    state.selected = file ? restoreFor(file) : null;
    state.last_change = new Date().toISOString();
    scheduleSave();
    ctx.bus.emit('active', state.active, { session: sessionKey });
    // Clients (StatusBar, shell halo, chat context chip) must see the restored
    // selection, not assume the pre-switch null.
    ctx.bus.emit('selected', state.selected, { session: sessionKey });
  }

  function setOpenTabs(tabs: string[]) {
    if (!Array.isArray(tabs)) return;
    state.open_tabs = tabs.filter((t): t is string => typeof t === 'string');
    // GC selection memory for closed canvases — a closed tab's parked
    // selection has no consumer and would otherwise accrete forever. Keep the
    // CURRENT active canvas too: the single-canvas shell sends `tabs` with only
    // the incoming canvas BEFORE `active` parks the outgoing one, so without
    // this the outgoing canvas's memory would depend on message ordering.
    const keep = new Set(state.open_tabs.map((t) => deriveCanvasSlug(t)));
    if (state.active) keep.add(deriveCanvasSlug(state.active));
    for (const slug of Object.keys(state.selections)) {
      if (!keep.has(slug)) delete state.selections[slug];
    }
    state.last_change = new Date().toISOString();
    scheduleSave();
  }

  function enrich(sel: Omit<SelectedElement, 'ts' | 'v' | 'canvas'>): SelectedElement {
    const file = typeof sel.file === 'string' ? sel.file : (state.active ?? '');
    const id = typeof sel.id === 'string' && sel.id ? sel.id : undefined;
    const v: 1 | 2 = id ? 2 : 1;
    return {
      file,
      selector: String(sel.selector || ''),
      index: typeof sel.index === 'number' ? sel.index : undefined,
      tag: String(sel.tag || ''),
      classes: String(sel.classes || ''),
      text: String(sel.text || '').slice(0, 240),
      dom_path: Array.isArray(sel.dom_path) ? sel.dom_path.slice(0, 16) : [],
      bounds: sel.bounds ?? null,
      html: String(sel.html || '').slice(0, 4000),
      ts: new Date().toISOString(),
      v,
      canvas_mtime: mtimeFor(file),
      ...(id ? { id, canvas: deriveCanvasSlug(file) } : {}),
      ...(() => {
        if (sel.photoKind !== 'artboard-img' && sel.photoKind !== 'annotation-image') return {};
        // `photoAsset` traces back to client-derived DOM state (a
        // `data-photo-asset` attribute inside the untrusted canvas iframe,
        // DDR-054) — unlike the sibling `text` field it had no shape/length
        // constraint before persisting to `_active.json` and broadcasting to
        // every connected WS peer (security review finding). It's always a
        // fixed-shape `assets/<sha8>.<ext>` reference, so an unshaped value
        // is dropped outright rather than merely truncated.
        const asset = String(sel.photoAsset || '');
        if (!/^assets\/[0-9a-f]{8}\.[a-z0-9]+$/i.test(asset)) return {};
        return { photoKind: sel.photoKind, photoAsset: asset };
      })(),
    };
  }

  function setSelected(sel: SetSelectedInput) {
    if (sel == null) {
      state.selected = null;
      // Explicit deselect clears the active canvas's parked memory too — a
      // deliberate act, not a context loss.
      if (state.active) delete state.selections[deriveCanvasSlug(state.active)];
    } else if (Array.isArray(sel)) {
      const enriched = sel
        .filter(
          (s): s is Omit<SelectedElement, 'ts' | 'v' | 'canvas'> => !!s && typeof s === 'object'
        )
        .map(enrich);
      // Writer back-compat: collapse single-entry array to a bare object so
      // legacy readers (`/design:edit`, handoff tooling) keep working without
      // schema awareness. N>1 stays as an array.
      if (enriched.length === 0) state.selected = null;
      else if (enriched.length === 1) state.selected = enriched[0] ?? null;
      else state.selected = enriched;
    } else if (typeof sel === 'object') {
      state.selected = enrich(sel);
    } else {
      state.selected = null;
    }
    // Write-through into the per-canvas memory (full payload incl. html — this
    // IS the active canvas's rich copy). Keyed by the ACTIVE canvas, and only
    // when the selection's own file matches it: the client gates select posts to
    // `e.source === activeWin` (app.jsx), but an ACTIVE untrusted canvas (a peer's
    // canvas reviewed in hub mode, DDR-054) could still claim `file: <another
    // trusted canvas>` and plant it into that canvas's slot for later delivery to
    // the auto-approving agent. A selection can only legitimately belong to the
    // canvas the user is looking at, so a mismatched `file` is a cross-canvas
    // plant — drop the write-through (attacker Finding 2 residual).
    if (state.selected != null && state.active) {
      const first = Array.isArray(state.selected) ? state.selected[0] : state.selected;
      const activeSlug = deriveCanvasSlug(state.active);
      if (first?.file && deriveCanvasSlug(first.file) === activeSlug) {
        state.selections[activeSlug] = state.selected;
      }
    }
    state.last_change = new Date().toISOString();
    scheduleSave();
    ctx.bus.emit('selected', state.selected, { session: sessionKey });
  }

  function remove(file: string): boolean {
    const slug = deriveCanvasSlug(file);
    const active = state.active === file;
    const referenced =
      active || state.open_tabs.includes(file) || Object.hasOwn(state.selections, slug);
    if (!referenced) return false;
    // setActive parks the outgoing selection; remove that memory afterwards.
    if (active) setActive('');
    state.open_tabs = state.open_tabs.filter((tab) => tab !== file);
    delete state.selections[slug];
    if (active) state.active_comments = [];
    state.last_change = new Date().toISOString();
    scheduleSave();
    return true;
  }

  function retarget(fromFile: string, toFile: string): boolean {
    const fromSlug = deriveCanvasSlug(fromFile);
    const toSlug = deriveCanvasSlug(toFile);
    let changed = false;

    if (state.active === fromFile) {
      state.active = toFile;
      changed = true;
    }
    if (state.open_tabs.includes(fromFile)) {
      state.open_tabs = state.open_tabs.map((t) => (t === fromFile ? toFile : t));
      changed = true;
    }
    if (Object.hasOwn(state.selections, fromSlug)) {
      state.selections[toSlug] = state.selections[fromSlug] as SelectedValue;
      delete state.selections[fromSlug];
      changed = true;
    }
    if (state.selected != null) {
      const list = Array.isArray(state.selected) ? state.selected : [state.selected];
      let selChanged = false;
      const next = list.map((e) => {
        if (e.canvas !== fromSlug) return e;
        selChanged = true;
        return { ...e, canvas: toSlug, file: e.file === fromFile ? toFile : e.file };
      });
      if (selChanged) {
        state.selected = Array.isArray(state.selected) ? next : (next[0] ?? null);
        changed = true;
      }
    }

    if (!changed) return false;
    state.last_change = new Date().toISOString();
    scheduleSave();
    return true;
  }

  /**
   * Canvas slug for v2 selections. Mirrors `canvasSlug()` from locator.ts but
   * accepts a designRoot-relative `file` path (which is what the iframe reports)
   * rather than an absolute one. Strips a leading `<designRoot-relative>/` if
   * present and strips the final extension.
   */
  function deriveCanvasSlug(file: string): string {
    let s = (file || '').replace(/^\/+/, '');
    // Strip a leading designRoot prefix if it's part of the file path. The
    // iframe's pathname includes the design root (e.g. `.design/ui/Foo.tsx`);
    // locator.ts strips it via path.relative — mirror that here.
    const dr = ctx.paths.designRel.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
    if (dr && s.startsWith(`${dr}/`)) s = s.slice(dr.length + 1);
    const dot = s.lastIndexOf('.');
    return dot > 0 ? s.slice(0, dot) : s;
  }

  return {
    sessionKey,
    state,
    load,
    setActive,
    setOpenTabs,
    setSelected,
    retarget,
    remove,
    save,
    injectInspector,
  };
}

/**
 * One `Inspect` per member — Cloud Phase 27 D3.
 *
 * A desktop asks for `for('')` forever and gets the single instance it always
 * had. A cell asks with the proxy's vouched session key and gets one per
 * member, so an owner and a viewer stop overwriting each other's open tab and
 * selection.
 *
 * Instances are created on demand and kept: they are small (one state object),
 * a member reconnects to the same key across reloads, and evicting one would
 * lose exactly the state this exists to preserve. The key space is bounded by
 * the project's membership, not by anything a client can invent —
 * `normalizeSessionKey` rejects a value that is not proxy-shaped, and the proxy
 * strips inbound `x-maude-*` before injecting its own.
 */
export interface InspectRegistry {
  /** The instance for this session key, created on first use. */
  for(sessionKey?: string | null): Inspect;
  /** Every live instance. */
  all(): Inspect[];
}

export function createInspectRegistry(
  ctx: Context,
  loadActiveComments: (file: string) => Promise<unknown[]>
): InspectRegistry {
  const instances = new Map<string, Inspect>();

  function get(sessionKey?: string | null): Inspect {
    const key = normalizeSessionKey(sessionKey);
    let found = instances.get(key);
    if (!found) {
      found = createInspect(ctx, loadActiveComments, key);
      instances.set(key, found);
      // A member returning after a reload picks their own place back up. Fire
      // and forget: `load()` is a best-effort read of a file that usually does
      // not exist yet, and blocking a request on it would trade a correctness
      // nicety for latency on every first touch.
      if (key) void found.load();
    }
    return found;
  }

  return {
    for: get,
    all: () => [...instances.values()],
  };
}

// ---------- Inspector script injection ----------

function injectInspector(html: string): string {
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + INSPECTOR_SCRIPT;
  return html.slice(0, idx) + INSPECTOR_SCRIPT + html.slice(idx);
}

// Comment-pin rendering overlay injected into every served HTML page under
// designRoot. Pin layer is the ONLY responsibility — hover/click selection is
// owned by canvas-shell.tsx (TSX canvases) and isn't applicable to legacy
// `.html` mocks since the broader migration to TSX. Pin layer keeps working
// in both, because pins are positioned by selector and updated via the
// `comments-set` postMessage channel from the shell.
const INSPECTOR_SCRIPT = `
<script>
(function() {
  if (window.__designInspectorAttached) return;
  window.__designInspectorAttached = true;

  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '.dgn-pin { position: absolute; top: 0; left: 0; z-index: 2147483646; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 999px 999px 999px 4px; background: #facc15; color: #1c1917; font: 600 11px/22px var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); text-align: center; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.4); transition: filter 120ms; transform-origin: bottom left; will-change: transform; }',
    '.dgn-pin:hover { filter: brightness(1.1); outline: 2px solid rgba(0,0,0,0.3); }',
    '.dgn-pin.resolved { background: #22c55e; color: #052e16; }',
    '.dgn-pin.focused { box-shadow: 0 4px 12px rgba(0,0,0,0.6), 0 0 0 2px #fff; outline: 2px solid #fff; }',
    /* Phase 13 / DDR-029 — canvas activity overlay. Single injection point so the
       canvas iframe stays self-contained. Scoped with html ... so canvas-page
       stylesheets can't clobber it. The "editing" motion is a light scan beam
       (Phase 13.3) sweeping the whole artboard top→bottom — transform-only
       (compositor), unmounts when the file goes idle (infinite-with-control,
       flow:motion-rules §5); reduced-motion drops the beam to a static rim. The
       rim border + glow are static boundary chrome. */
    'html .dc-activity-rim { position: absolute; pointer-events: none; box-sizing: border-box; border: 2.5px solid var(--mdcc-activity, hsl(210 90% 58%)); border-radius: 5px; z-index: 6; opacity: 1; transition: opacity 200ms ease-out; }',
    'html .dc-activity-rim[data-fading="true"] { opacity: 0; }',
    'html .dc-activity-rim::after { content: ""; position: absolute; inset: -1px; border-radius: 6px; box-shadow: 0 0 0 1px var(--mdcc-activity, hsl(210 90% 58%)), 0 0 16px 2px var(--mdcc-activity, hsl(210 90% 58%)); opacity: 0.55; pointer-events: none; will-change: opacity; animation: dc-activity-glow var(--mdcc-activity-scan-ms, 2200ms) ease-in-out infinite; }',
    'html .dc-activity-badge { position: absolute; top: 4px; right: 4px; z-index: 2; padding: 2px 8px; border-radius: 4px; background: var(--mdcc-activity, hsl(210 90% 58%)); color: #fff; font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; box-shadow: 0 1px 4px rgba(0,0,0,0.45); }',
    /* Phase 13.3 — the AGENT BORDER is the primary "editing" indicator: a clear
       2.5px border in the agent color with a softly pulsing glow (::after,
       opacity-only, compositor). Clipping lives on the wash (not the rim) so the
       outward glow is not clipped. The dc-activity-scan wash is ONE full-artboard
       wave: a single gradient with a SHARP bottom edge (full agent color) fading
       up to transparent at the top (height = artboard). Its sharp edge enters at
       the top and the whole wave travels straight down and off past the bottom
       edge (translateY -100% → 100%), then the next wave enters from the top in a
       loop. transform-only; linear so it flows at a steady pace. */
    'html .dc-activity-scan { position: absolute; inset: 0; overflow: hidden; border-radius: 4px; pointer-events: none; z-index: 1; }',
    'html .dc-activity-scan::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 135%; will-change: transform; background: linear-gradient(to top, color-mix(in oklab, var(--mdcc-activity, hsl(210 90% 58%)) 20%, transparent) 0%, transparent 100%); animation: dc-activity-wave var(--mdcc-activity-scan-ms, 3800ms) linear infinite; }',
    '@keyframes dc-activity-glow { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.85; } }',
    '@keyframes dc-activity-wave { from { transform: translateY(-100%); } to { transform: translateY(100%); } }',
    '@media (prefers-reduced-motion: reduce) { html .dc-activity-rim { transition: none; } html .dc-activity-rim::after { animation: none; opacity: 0.55; } html .dc-activity-scan { display: none; } }',
    /* feature-photo-editor — background-removal busy reveal. A data-photo-busy
       attribute toggle on the real img/image element (set by canvas-lib.tsx's
       PhotoPreviewBridge on a photo-busy postMessage from the shell), styled
       here at the same single injection point as the .dc-activity-* agent-edit
       chrome above — same "something is actively happening" rim + pulse
       language. Deliberately NOT a floating tracked overlay: that's the exact
       architecture DDR-161's addendum removed from the live-edit preview
       (z-index/resize/hit-testing bugs) — an attribute on the element itself
       moves for free with pan/zoom/resize, no separate rect sync needed.
       Deliberately opacity-only (not a moving mask-position sweep, tried
       first): the ML pass runs single-threaded WASM on the main thread
       (confirmed live — env.wasm.numThreads falls back without
       crossOriginIsolated), which blocks per-frame style/paint work for the
       ENTIRE inference; a mask-position animation froze mid-sweep for that
       whole window. opacity is one of the few properties browsers composite
       off the main thread unconditionally, so the pulse keeps animating
       exactly when the page is busiest — the one moment it needs to. */
    'html [data-photo-busy] { outline: 2px solid var(--mdcc-activity, hsl(210 90% 58%)); outline-offset: 2px; animation: dc-photo-busy-pulse 1100ms ease-in-out infinite; will-change: opacity; }',
    '@keyframes dc-photo-busy-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }',
    '@media (prefers-reduced-motion: reduce) { html [data-photo-busy] { animation: none; opacity: 0.75; } }',
    /* Phase 13.1 / DDR-077 — "holding last good render" toast, shown when an
       agent edit produced a broken intermediate (build/render error) and the
       canvas is held instead of flashing white. Amber = warn, distinct from the
       blue activity rim. pointer-events:none so it never blocks the canvas. */
    'html .dc-hmr-holding { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483646; pointer-events: none; max-width: 90vw; padding: 6px 12px; border-radius: 6px; background: hsl(38 92% 50% / 0.96); color: #1c1207; font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 10px rgba(0,0,0,0.45); }'
  ].join('\\n');
  document.documentElement.appendChild(styleEl);

  var pinLayer = document.createElement('div');
  pinLayer.id = 'dgn-pin-layer';
  pinLayer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483646;';
  document.documentElement.appendChild(pinLayer);

  var commentsCache = [];
  var focusedPinId = null;

  var pinNodes = [];
  var rafToken = null;

  function buildPinNodes() {
    pinLayer.innerHTML = '';
    pinNodes = [];
    var withSelector = commentsCache.filter(function(c) { return c && c.selector; });
    withSelector.forEach(function(c, i) {
      var target = null;
      try { var _all = document.querySelectorAll(c.selector); var _i = (typeof c.index === 'number' && c.index > 0 && c.index < _all.length) ? c.index : 0; target = _all[_i] || _all[0] || null; } catch (e) {}
      var pin = document.createElement('button');
      pin.className = 'dgn-pin' + (c.status === 'resolved' ? ' resolved' : '') + (c.id === focusedPinId ? ' focused' : '');
      pin.textContent = String(i + 1);
      pin.title = (c.text || '').slice(0, 200);
      pin.style.pointerEvents = 'auto';
      pin.style.left = '0px';
      pin.style.top = '0px';
      pin.dataset.id = c.id;
      pin.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        focusedPinId = c.id;
        try { window.parent.postMessage({ dgn: 'comment-click', id: c.id }, '*'); } catch (e) {}
        buildPinNodes();
      });
      pinLayer.appendChild(pin);
      pinNodes.push({ el: pin, comment: c, target: target });
    });
    placePins();
  }

  function placePins() {
    if (!pinNodes.length) return;
    for (var i = 0; i < pinNodes.length; i++) {
      var node = pinNodes[i];
      var x, y, hidden = false;
      if (!node.target || !node.target.isConnected) {
        try { var _nc = node.comment; var _na = document.querySelectorAll(_nc.selector); var _ni = (typeof _nc.index === 'number' && _nc.index > 0 && _nc.index < _na.length) ? _nc.index : 0; node.target = _na[_ni] || _na[0] || null; } catch (e) {}
      }
      if (node.target) {
        var r = node.target.getBoundingClientRect();
        x = r.left + window.scrollX - 8;
        y = r.top + window.scrollY - 8;
        if (r.width === 0 && r.height === 0) hidden = true;
      } else if (node.comment.bounds) {
        x = node.comment.bounds.x - 8;
        y = node.comment.bounds.y - 8;
      } else {
        hidden = true;
      }
      if (hidden) {
        node.el.style.display = 'none';
      } else {
        node.el.style.display = '';
        var scale = (node.comment.id === focusedPinId) ? 1.2 : 1;
        node.el.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px) scale(' + scale + ')';
      }
    }
  }

  function tick() {
    rafToken = null;
    placePins();
    if (pinNodes.length) rafToken = requestAnimationFrame(tick);
  }
  function startTick() {
    if (rafToken == null && pinNodes.length) rafToken = requestAnimationFrame(tick);
  }

  function schedulePins() { buildPinNodes(); startTick(); }

  window.addEventListener('resize', placePins);
  document.addEventListener('scroll', placePins, { passive: true, capture: true });
  document.addEventListener('wheel',  function() { startTick(); }, { passive: true, capture: true });
  document.addEventListener('pointermove', function(e) { if (e.buttons) startTick(); }, { passive: true, capture: true });
  document.addEventListener('keyup', function() { startTick(); }, true);
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function(){ startTick(); }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['style', 'class'], childList: true });
  }

  // Shell chords — keydown fired inside the canvas iframe never reaches the
  // shell's window-scoped listener (iframe keyboard isolation), so each shell
  // chord must be forwarded to the parent. preventDefault is load-bearing for
  // ⌘R: without it the BROWSER reloads the whole shell while focus is in the
  // canvas (the advertised behavior is "reload the active canvas"). Capture
  // phase so canvas-lib's pan/zoom keydown handler can't swallow them first.
  document.addEventListener('keydown', function(e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'k' && !e.shiftKey) {
      e.preventDefault();
      try { window.parent.postMessage({ dgn: 'toggle-palette' }, '*'); } catch (err) {}
      return;
    }
    if (k === 'r' && !e.shiftKey) {
      e.preventDefault();
      try { window.parent.postMessage({ dgn: 'shell-shortcut', id: 'reload' }, '*'); } catch (err) {}
      return;
    }
    if (e.shiftKey) {
      // ⌘⇧T (timeline) + ⌘⇧G (changes) were missing here, so with focus inside
      // the canvas iframe they never reached the shell — opening the Timeline
      // (and its Space/arrow transport, which needs the dock focused) silently
      // stopped working after a canvas interaction moved focus into the iframe.
      // ⌘⇧T is also the browser "reopen closed tab" chord, so the preventDefault
      // below is doubly load-bearing.
      var id = k === 'i' ? 'inspector' : k === 'm' ? 'comments' : k === 'e' ? 'export' : k === 'h' ? 'handoff' : k === 't' ? 'timeline' : k === 'g' ? 'changes' : null;
      if (id) {
        e.preventDefault();
        try { window.parent.postMessage({ dgn: 'shell-shortcut', id: id }, '*'); } catch (err) {}
      }
    }
  }, true);

  window.addEventListener('message', function(e) {
    var m = e.data;
    if (!m || typeof m !== 'object' || !m.dgn) return;
    if (m.dgn === 'comments-set' && Array.isArray(m.comments)) {
      commentsCache = m.comments;
      schedulePins();
    } else if (m.dgn === 'comment-focus') {
      focusedPinId = m.id || null;
      pinNodes.forEach(function(node) {
        node.el.classList.toggle('focused', node.comment.id === focusedPinId);
      });
      placePins();
      startTick();
      var c = commentsCache.find(function(x){ return x && x.id === m.id; });
      if (c && c.selector) {
        try {
          var _ta = document.querySelectorAll(c.selector); var _ti = (typeof c.index === 'number' && c.index > 0 && c.index < _ta.length) ? c.index : 0; var t = _ta[_ti] || _ta[0] || null;
          if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {}
      }
    } else if (m.dgn === 'theme') {
      // Catch the chrome-theme seed the shell posts in reply to our 'loaded'
      // ping (sent below). THIS listener registers during page-load — before
      // the React canvas-shell mounts and adds its OWN 'dgn:theme' listener —
      // so without this branch the shell's reply lands in the gap between
      // page-load and React-mount and is dropped, leaving the canvas stuck on
      // its hardcoded dark default until a manual theme toggle re-broadcasts
      // it (the recurring "open a canvas under a light shell → canvas chrome is
      // dark; toggle twice to fix; next canvas reverts" bug). We set the same
      // attribute the canvas-shell chrome reads (data-maude-theme on <html>);
      // canvas-shell's default-dark guard then sees the value already present
      // and won't override it, and its own listener takes over live toggles.
      if (m.theme === 'light' || m.theme === 'dark') {
        try { document.documentElement.setAttribute('data-maude-theme', m.theme); } catch (e) {}
      }
    }
    /* force-clear is now consumed by canvas-shell.tsx — the inspector
       overlay has no per-element selection state to clear anymore. */
  });

  try {
    var p = location.pathname;
    var file;
    if (p === '/_canvas-shell.html' || p === '/_canvas-shell') {
      var qs = new URLSearchParams(location.search);
      var canvas = qs.get('canvas') || '';
      var designRel = (qs.get('designRel') || '.design').replace(/^\\/+|\\/+$/g, '');
      file = designRel + '/' + canvas;
    } else {
      file = decodeURIComponent(p).replace(/^\\//, '');
    }
    window.parent.postMessage({ dgn: 'loaded', file: file }, '*');
  } catch (e) {}
})();
</script>
`;
