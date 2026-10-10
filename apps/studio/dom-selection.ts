/**
 * @file       dom-selection.ts — selection-from-DOM helpers (leaf module)
 * @scope      apps/studio/dom-selection.ts
 * @purpose    Pure DOM → Selection builders shared by the canvas chrome
 *             (canvas-shell.tsx) and the shell-owned comment mount layer
 *             (canvas-comment-mount.tsx). Lives in its own leaf module — no
 *             React, no canvas-lib import — so both consumers can lift the
 *             same `hoverTargetToSelection` / `deriveFile` logic without a
 *             cycle and without bundling the heavy DesignCanvas tree into the
 *             lite comment mount.
 */

import type { HoverTarget } from './input-router.tsx';
import type { Selection } from './use-selection-set.tsx';

/**
 * Canvas file path for the current page. Under the mount harness the page is
 * `/_canvas-shell.html?canvas=<rel>&designRel=<root>`; for legacy `.html`
 * mocks it's the served file path itself.
 */
export function deriveFile(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const p = window.location.pathname;
    if (p === '/_canvas-shell.html' || p === '/_canvas-shell') {
      const qs = new URLSearchParams(window.location.search);
      const canvas = qs.get('canvas') ?? '';
      const designRel = (qs.get('designRel') ?? '.design').replace(/^\/+|\/+$/g, '');
      return canvas ? `${designRel}/${canvas}` : undefined;
    }
    return decodeURIComponent(p).replace(/^\//, '');
  } catch {
    return undefined;
  }
}

export function realClasses(el: Element | null): string {
  if (!el) return '';
  return (el.getAttribute('class') ?? '')
    .trim()
    .split(/\s+/)
    .filter((c) => c && !c.startsWith('dgn-') && !c.startsWith('dc-cv-'))
    .join(' ');
}

export function shortText(el: Element | null, max: number): string {
  if (!el) return '';
  const t = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function cssPath(el: Element | null): string {
  if (!el) return '';
  const path: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && path.length < 8) {
    const dscEl = cur.getAttribute?.('data-dc-element');
    if (dscEl) {
      path.unshift(`[data-dc-element="${dscEl}"]`);
      break;
    }
    const dscSc = cur.getAttribute?.('data-dc-screen');
    if (dscSc) {
      path.unshift(`[data-dc-screen="${dscSc}"]`);
      break;
    }
    let sel = cur.nodeName.toLowerCase();
    if (cur.id) {
      sel = `#${cur.id}`;
      path.unshift(sel);
      break;
    }
    const cls = realClasses(cur).split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) sel += `.${cls.join('.')}`;
    let sib = 1;
    let n: Element | null = cur.previousElementSibling;
    while (n) {
      sib++;
      n = n.previousElementSibling;
    }
    sel += `:nth-child(${sib})`;
    path.unshift(sel);
    cur = cur.parentElement;
  }
  return path.join(' > ');
}

export function domPath(el: Element | null): string[] {
  const hops: string[] = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && hops.length < 8) {
    let label = cur.nodeName.toLowerCase();
    const dEl = cur.getAttribute?.('data-dc-element');
    const dSc = cur.getAttribute?.('data-dc-screen');
    if (dEl) label += `[data-dc-element="${dEl}"]`;
    else if (dSc) label += `[data-dc-screen="${dSc}"]`;
    else if (cur.id) label += `#${cur.id}`;
    const cls = realClasses(cur).split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length && !dEl && !dSc) label += `.${cls.join('.')}`;
    hops.unshift(label);
    cur = cur.parentElement;
  }
  return hops;
}

export function cssEscape(s: string): string {
  // Minimal CSS.escape polyfill — only handles chars actually present in
  // pipeline-stamped IDs (alphanumerics + `-` + `_`).
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/**
 * Build the wire-shape `Selection` for a resolved hover target. `file`
 * defaults to `deriveFile()`; the comment mount layer passes it explicitly
 * so all three consumers (router, overlay, mount) agree on the same key.
 */
/**
 * The artboard-scoped data-cd-id selector. A component shared across artboards
 * carries the SAME data-cd-id in each, so a bare `[data-cd-id="…"]` resolves
 * (via querySelector) to the FIRST artboard. Prefixing the hit's artboard makes
 * the anchor per-instance. Shared by EVERY selector builder + resolver so they
 * can't drift (the original fix only patched one of ~8 sites).
 */
export function scopedCdSelector(cdId: string, artboardId?: string | null): string {
  return artboardId
    ? `[data-dc-screen="${artboardId}"] [data-cd-id="${cdId}"]`
    : `[data-cd-id="${cdId}"]`;
}

/**
 * Occurrence index of `el` among `doc.querySelectorAll(selector)`. Even with an
 * artboard-scoped data-cd-id selector, a component repeated WITHIN one artboard
 * (a list row, or a reusable used twice) produces several matches — the index
 * is the only thing that makes the anchor truly unique per DOM instance.
 */
export function selectorIndex(doc: Document, selector: string, el: Element | null): number {
  if (!el) return 0;
  try {
    const all = doc.querySelectorAll(selector);
    for (let i = 0; i < all.length; i++) {
      if (all[i] === el) return i;
    }
  } catch {
    /* malformed selector */
  }
  return 0;
}

/**
 * GLOBAL occurrence index of `el` among EVERY node in the document that shares
 * its `data-cd-id` — the DOM instance index the server-side reused-component
 * usage resolver (`resolveUsageId`) expects, in source order. Distinct from a
 * `Selection.index` (which counts within an artboard-SCOPED selector). Used to
 * route a whole-instance move/resize per-occurrence (Stage H3) so it stays local
 * to the dragged instance. Matches the reorder drag's own snapshot occurrence.
 */
export function globalCdOccurrence(doc: Document, cdId: string, el: Element | null): number {
  if (!cdId || !el) return 0;
  return selectorIndex(doc, `[data-cd-id="${cssEscape(cdId)}"]`, el);
}

/**
 * Resolve a stored Selection to its live element, artboard-scoped. Prefers the
 * id+artboardId scoped selector (the robust path), then the stored `selector`
 * (already scoped for recent selections; a legacy fallback for old comments).
 * Every halo / pin / toolbar / spacing-handle resolver routes through this so a
 * shared component anchors to the instance the user actually clicked.
 */
export function resolveSelectionEl(
  doc: Document,
  sel: { id?: string | null; selector?: string | null; artboardId?: string | null; index?: number }
): Element | null {
  const at = (selector: string): Element | null => {
    try {
      const all = doc.querySelectorAll(selector);
      if (!all.length) return null;
      const i = sel.index && sel.index > 0 && sel.index < all.length ? sel.index : 0;
      return all[i] ?? all[0];
    } catch {
      return null;
    }
  };
  if (sel.id) {
    const el = at(scopedCdSelector(sel.id, sel.artboardId));
    if (el) return el;
  }
  if (sel.selector) return at(sel.selector);
  return null;
}

/**
 * Length of the trailing run `a` and `b` share, walked from the end. `domPath()`
 * hops carry no positional (nth-child) info, so a shared suffix survives a
 * sibling insertion/removal anywhere earlier in the tree — exactly the DDR-019
 * `data-cd-id` renumbering case this fallback exists for.
 */
function matchingSuffixLength(a: string[], b: string[]): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  for (let i = 1; i <= max; i++) {
    if (a[a.length - i] !== b[b.length - i]) break;
    n++;
  }
  return n;
}

/**
 * Best-effort structural fallback for when a stored `data-cd-id` selector no
 * longer identifies the intended element. A canvas rewrite (`/design:edit`
 * regenerating JSX) renumbers `data-cd-id` — it's an AST-position fingerprint,
 * not a stable identity (DDR-019) — so the id can end up on an unrelated
 * element, or on none at all. This scores every stamped element in the
 * artboard by how much of its live `domPath()` matches the STORED path
 * (as a trailing run) plus authored-class overlap, and requires the leaf tag
 * to match. Returns null when nothing scores above zero (no plausible match —
 * the caller should treat the target as gone).
 */
export function resolveByDomPath(
  doc: Document,
  opts: { artboardId?: string | null; tag?: string; classes?: string; dom_path?: string[] }
): Element | null {
  const storedPath = opts.dom_path;
  const wantTag = (opts.tag || '').toLowerCase();
  if (!storedPath || storedPath.length === 0 || !wantTag) return null;
  let scope: ParentNode = doc;
  if (opts.artboardId) {
    const artboard = doc.querySelector(`[data-dc-screen="${opts.artboardId}"]`);
    if (artboard) scope = artboard;
  }
  const wantClasses = (opts.classes || '').split(/\s+/).filter(Boolean);
  let best: Element | null = null;
  let bestScore = 0;
  for (const el of Array.from(scope.querySelectorAll('[data-cd-id]'))) {
    if (el.tagName.toLowerCase() !== wantTag) continue;
    const suffix = matchingSuffixLength(domPath(el), storedPath);
    if (suffix === 0) continue;
    const liveClasses = realClasses(el).split(/\s+/).filter(Boolean);
    const overlap = wantClasses.filter((c) => liveClasses.includes(c)).length;
    const score = suffix * 10 + overlap;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/**
 * Phase 12.2 — style maps for the CSS-knob properties. `authored` is what the
 * element sets INLINE (React renders `style={{padding:8}}` → `style="padding:8px"`),
 * so the knob pre-fills the EDITABLE source value and is blank when unset — not
 * the noisy resolved default (`656.003px`, `rgb(0,0,0)`). `computed` is the
 * resolved value, shown only as a faint placeholder hint. Empty for a detached
 * node / SSR.
 */
// Phase 12.3 (W2.2 fix) — EVERY property the CSS panel has a control for, so each
// reads back into `authored` (pre-fills the right control) and is excluded from
// `customStyles`. The earlier short list omitted the box-model LONGHANDS
// (`padding-top`, `margin-left`, …) + the Layout/border longhands, so a value the
// panel wrote (e.g. an alt-scrub `padding-top`) fell through to customStyles and
// the box-model widget showed it as a "custom CSS property" instead of in the box.
const KNOB_PROPS = [
  // Layout
  'display',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'justify-content',
  'gap',
  // Stage M — flex-CHILD props (sizing mode Fill + the Auto-layout child rows).
  // Shown only when the PARENT is flex (Selection.parentDisplay); captured here so
  // they round-trip. `flex` shorthand is listed for customStyles-exclusion only.
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-self',
  // Typography
  'font-family',
  'color',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  // Spacing — shorthand (for customStyles exclusion + whole-side authoring) AND
  // the 8 longhands the box-model widget actually reads/writes.
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  // Size
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  // Appearance
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
  'opacity',
  // feature-element-editing-robustness Stage B — promotes DDR-104 §3's OUT-list
  // into curated rows (superseded by the Stage-G DDR). Adding them here captures
  // their authored/computed values for the new panel controls AND moves them out
  // of the Advanced "customStyles" hatch (a canvas that carried one as a raw
  // custom prop now surfaces it in its curated row instead).
  // Position + stacking
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  // Transform
  'transform',
  'transform-origin',
  // Typography (extra)
  'font-style',
  'text-transform',
  'text-decoration',
  'white-space',
  // Overflow
  'overflow',
  // Media framing
  'object-fit',
  'aspect-ratio',
  'object-position',
] as const;

// Phase 12.3 — HTML attributes the custom-attribute hatch may have written, so a
// just-added `data-*`/`aria-*`/`role`/`title` round-trips back into a panel row.
// Excludes the structural ones the panel manages elsewhere (style, class,
// data-cd-id pipeline anchor, the data-dc-* canvas chrome markers).
const ATTR_SKIP = /^(style|class|data-cd-id|data-dc-|data-dcid$)/;

function styleMapsFor(el: Element | null): {
  authored: Record<string, string>;
  computed: Record<string, string>;
  customStyles: Record<string, string>;
  attrs: Record<string, string>;
  parentDisplay?: string;
  parentFlexDirection?: string;
} {
  if (!el || typeof window === 'undefined' || !window.getComputedStyle) {
    return { authored: {}, computed: {}, customStyles: {}, attrs: {} };
  }
  try {
    const inline = (el as HTMLElement).style;
    const cs = window.getComputedStyle(el as HTMLElement);
    const authored: Record<string, string> = {};
    const computed: Record<string, string> = {};
    const knob = new Set<string>(KNOB_PROPS as readonly string[]);
    // Curated knob props: authored value (knob pre-fill) + computed (placeholder).
    for (const p of KNOB_PROPS) {
      const a = inline.getPropertyValue(p);
      if (a) authored[p] = a.trim();
      const c = cs.getPropertyValue(p);
      if (c) computed[p] = c.trim();
    }
    // Every OTHER authored inline property → customStyles, so the panel can show
    // a custom CSS property the user added that no curated row covers. EXCLUDE
    // the panel-managed FAMILIES wholesale: setting `border`/`border-radius` (or
    // their 3-way shorthands) makes the CSSOM expand them to the per-side
    // longhands — `border-top-width`, `border-left-color`, … — which the panel
    // controls but can't enumerate in the knob set. Without the family guard they
    // leak into "custom CSS properties" (the same class of bug fixed for spacing).
    const MANAGED_FAMILY = /^(margin|padding|border)(-|$)/;
    const customStyles: Record<string, string> = {};
    for (let i = 0; i < inline.length; i++) {
      const p = inline.item(i);
      if (!p || knob.has(p) || MANAGED_FAMILY.test(p)) continue;
      const v = inline.getPropertyValue(p);
      if (v) customStyles[p] = v.trim();
    }
    // Custom HTML attributes (the escape-hatch surface).
    const attrs: Record<string, string> = {};
    for (const a of Array.from((el as HTMLElement).attributes)) {
      if (ATTR_SKIP.test(a.name)) continue;
      attrs[a.name] = a.value;
    }
    // Dogfood follow-up (print artboards) — ATTR_SKIP deliberately hides the
    // engine's own `data-dc-*` plumbing from the generic "custom HTML
    // attributes" panel, but for a whole-ARTBOARD selection those attributes
    // ARE the payload: DCArtboard's readBackAttrs (canvas-lib.tsx) stamps
    // data-dc-kind / data-dc-print / data-dc-fixed / data-dc-bg / … on the
    // <article> precisely so the Inspector's ArtboardKnobs can pre-fill its
    // Kind picker, paper preset, Hug/Fixed toggle, and Style fields. With
    // the blanket skip, every one of those readbacks silently fell back to
    // its default ('digital', screen presets, Hug, empty Bg) no matter what
    // the artboard actually was — the root cause of the "Kind shows Digital
    // on a print artboard" family of bugs. Allow data-dc-* through for the
    // artboard element itself; ordinary elements keep the filter (their
    // panel is CssKnobs, which never reads these).
    if ((el as HTMLElement).hasAttribute('data-dc-screen')) {
      for (const a of Array.from((el as HTMLElement).attributes)) {
        if (a.name.startsWith('data-dc-') && a.name !== 'data-dcid') {
          attrs[a.name] = a.value;
        }
      }
    }
    // Stage M — parent's layout context (for the Fixed/Hug/Fill sizing control +
    // flex-child row gating). Read here because the shell can't reach the
    // cross-origin iframe to compute it after selection.
    const parent = (el as HTMLElement).parentElement;
    const parentDisplay = parent ? window.getComputedStyle(parent).display : '';
    const parentFlexDirection =
      parent && (parentDisplay === 'flex' || parentDisplay === 'inline-flex')
        ? window.getComputedStyle(parent).flexDirection
        : '';
    return { authored, computed, customStyles, attrs, parentDisplay, parentFlexDirection };
  } catch {
    return { authored: {}, computed: {}, customStyles: {}, attrs: {} };
  }
}

export function hoverTargetToSelection(target: HoverTarget, file?: string): Selection {
  const el = target.el;
  const rect =
    el && (el as HTMLElement).getBoundingClientRect
      ? (el as HTMLElement).getBoundingClientRect()
      : null;
  // `cdId` is the hit element's OWN data-cd-id (deep mode); resolver never
  // climbs to an ancestor. Falls back to cssPath of the hit when no stable
  // anchor exists.
  const cdId = target.cdId;
  // Selector resolution order:
  //   1. data-cd-id anchor — stable pipeline-stamped id (preferred). SCOPED by
  //      the hit's artboard (`[data-dc-screen=…] [data-cd-id=…]`) — a component
  //      shared across artboards carries the SAME data-cd-id in each, so an
  //      unscoped `[data-cd-id]` selector resolves (via querySelector) to the
  //      FIRST artboard's instance and the pin/select lands on the wrong board.
  //      Prefixing the artboard makes the anchor per-instance.
  //   2. data-dc-screen — chrome click promoted to whole-artboard select
  //      (T24.5 G8 multi-artboard gesture).
  //   3. cssPath of the hit — last-resort path string.
  const selector = cdId
    ? scopedCdSelector(cdId, target.artboardId)
    : target.artboardId
      ? `[data-dc-screen="${target.artboardId}"]`
      : cssPath(el);
  // Disambiguate repeated instances within the same artboard (list rows, a
  // reusable used twice) — the index is which `querySelectorAll(selector)`
  // match this element is. cssPath is already unique, so 0 there.
  const index = cdId && typeof document !== 'undefined' ? selectorIndex(document, selector, el) : 0;
  return {
    file: file ?? deriveFile(),
    id: cdId ?? undefined,
    selector,
    artboardId: target.artboardId,
    index,
    tag: el?.tagName.toLowerCase() ?? '',
    classes: realClasses(el),
    text: shortText(el, 240),
    dom_path: domPath(el),
    bounds: rect
      ? {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        }
      : null,
    // WORLD-unit size — `offsetWidth`/`offsetHeight` are the element's own local
    // pixel box, unaffected by an ancestor's `.dc-world` zoom transform (unlike
    // `bounds`, which is the SCREEN rect and lies at any zoom other than 100%).
    // The Inspector's artboard-resize fields (Stage D4 tail) need the true
    // JSX-authored width/height to pre-fill correctly regardless of zoom.
    worldW: el instanceof HTMLElement ? Math.round(el.offsetWidth) : undefined,
    worldH: el instanceof HTMLElement ? Math.round(artboardWorldH(el)) : undefined,
    html: el ? (el.outerHTML ?? '').slice(0, 4000) : '',
    // feature-photo-editor (Task 14) — flag a content-addressed artboard `<img>`
    // so the Inspector can offer the Photo tab. Only a real `assets/<sha8>.<ext>`
    // src qualifies (an external URL / SVG icon / data: URI has no sidecar).
    // `data-photo-asset` (stamped by canvas-lib's PhotoPreviewBridge the first
    // time it bakes an edit into this element) is checked FIRST — once an edit
    // is applied, the live `src` is a `data:` URL (the baked composite), which
    // no longer matches the asset regex. Without this, an already-edited photo
    // would lose its Photo tab the moment you select it (the exact regression
    // this fixes — the bridge's own direct-src-swap made the element's `src`
    // stop being a reliable asset key).
    ...(() => {
      if (el?.tagName?.toLowerCase() !== 'img') return {};
      // The canvas iframe is untrusted content (DDR-054) — an authored `<img
      // data-photo-asset="...">` is attacker-controllable, so the tag is only
      // trusted when it actually has the `assets/<sha8>.<ext>` shape (security
      // review finding: an unshaped value would ride unbounded into
      // `_active.json`/the WS broadcast via inspect.ts's `enrich()`).
      const assetRe = /assets\/[0-9a-f]{8}\.[a-z0-9]+/i;
      const tagged = (el as HTMLElement).getAttribute?.('data-photo-asset');
      if (tagged && assetRe.test(tagged))
        return { photoKind: 'artboard-img' as const, photoAsset: tagged };
      const src = (el as HTMLImageElement).getAttribute?.('src') || '';
      const m = assetRe.exec(src);
      return m ? { photoKind: 'artboard-img' as const, photoAsset: m[0] } : {};
    })(),
    ...styleMapsFor(el),
  };
}

/**
 * Build the comment-composer Selection for a right-click "Add comment"
 * (context-menu.tsx's `element` / `artboard-chrome` / `world` targets share
 * this one builder). When an element was under the cursor, delegates to
 * `hoverTargetToSelection` — the exact anchor a comment-tool CLICK on that
 * same element would produce, so a menu-driven comment and a drop-comment
 * pin resolve identically. When there wasn't (empty canvas background, or an
 * artboard's chrome/border rather than its body), returns a FLOATING
 * selection pinned to the click point — the same shape
 * canvas-comment-mount.tsx's `dropComment` uses for its own no-target
 * fallback (issue-90).
 */
export function buildComposeSelection(
  target: { el: Element | null; cdId?: string | null; artboardId?: string | null },
  clientX: number,
  clientY: number,
  file?: string
): Selection {
  if (target.el) {
    return hoverTargetToSelection(
      { el: target.el, cdId: target.cdId ?? null, artboardId: target.artboardId ?? null },
      file
    );
  }
  return {
    file: file ?? deriveFile(),
    selector: '',
    artboardId: target.artboardId ?? null,
    index: 0,
    tag: '',
    classes: '',
    text: '',
    dom_path: [],
    bounds: { x: clientX - 12, y: clientY - 12, w: 24, h: 24 },
    html: '',
  };
}

/**
 * Open the in-place comment composer for `selection`, anchored at
 * `(clientX, clientY)`. The single choke point for the two-part signal every
 * "add a comment here" affordance must send: `cm:open-composer` is what
 * ACTUALLY opens the composer (`comments-overlay.tsx`'s own listener); the
 * `comment-compose` postMessage is a secondary mirror so the parent shell's
 * StatusBar/sidebar reflect the target too. A caller that only sends the
 * second half opens nothing — canvas-shell.tsx's context-menu "Add comment"
 * did exactly that until issue-90.
 */
export function openCommentComposer(selection: Selection, clientX: number, clientY: number): void {
  if (typeof document !== 'undefined') {
    try {
      document.dispatchEvent(
        new CustomEvent('cm:open-composer', { detail: { selection, clientX, clientY } })
      );
    } catch {
      /* CustomEvent unsupported — fall through */
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.parent.postMessage({ dgn: 'comment-compose', selection }, '*');
    } catch {
      /* parent detached */
    }
  }
}

/**
 * World-unit height of a selected element. A FIXED artboard's frame is its
 * label strip + the declared body (V2-2.8 "fixed artboard loses 24 px"), so the
 * label is taken back out: the Inspector's Height field keeps showing the
 * number it always showed, never the label on top of it.
 */
export function artboardWorldH(el: HTMLElement): number {
  if (el.getAttribute('data-dc-fixed') !== 'true' || !el.hasAttribute('data-dc-screen')) {
    return el.offsetHeight;
  }
  const label = Array.from(el.children).find((c) => c.classList.contains('dc-artboard-label')) as
    | HTMLElement
    | undefined;
  return el.offsetHeight - (label ? label.offsetHeight : 0);
}
