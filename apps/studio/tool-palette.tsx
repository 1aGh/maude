/**
 * @file       tool-palette.tsx — Phase 5.1 centered icon toolbar
 * @scope      apps/studio/tool-palette.tsx
 * @purpose    Bottom-center floating chrome — navigate (V/H/C), draw
 *             (B/R/O/A/E), and zoom in one shell. Adopts the dev-server
 *             menubar's visual language (8 px radius, soft shadow, hairline
 *             border) so canvas chrome and app chrome read as one product.
 *
 *             The zoom popover lazy-mounts on demand and groups Fit / Reset
 *             / Zoom In / Zoom Out from `useViewportControllerContext`. The
 *             presentation toggle posts upstream so the dev-server's
 *             `view-annotations` state stays in sync.
 */

import { useEffect, useRef, useState } from 'react';

import {
  IconChevronDown,
  IconLetterA,
  IconSquare,
  SHAPE_KIND_ICONS,
  TOOL_ICONS,
} from './canvas-icons.tsx';
import { isReadOnlyCanvas } from './read-only-mode.ts';
import { useChromeVisibility } from './use-chrome-visibility.tsx';
import { type ShapeKind, useToolMode } from './use-tool-mode.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// Styles — pulled from menubar tokens (`.mb` family). Centered bottom toolbar,
// 32 × 32 buttons with iconography. Grouped pill segments separated by 1 px
// dividers — visual cue that nav / draw / view-controls are distinct kinds.

// DDR-046 — floating chrome ambient shadow + 8 px radius (NOT brutalist).
// Active-tool state: 14% tint bg + 2px accent underbar + accent fg, replacing
// the previous full-accent flood (too loud at 32 × 32 in a quiet chrome).
const PALETTE_CSS = `
.dc-tool-palette {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  align-items: stretch;
  background: var(--maude-chrome-bg-0, #ffffff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: 8px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent));
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  color: var(--maude-chrome-fg-0, #1a1a1a);
  z-index: 6;
  user-select: none;
  /* Intentionally NO overflow:hidden — the zoom popover (.dc-tp-popover) is
     a position:absolute child anchored above the toolbar; clipping the
     parent would hide it. */
}
.dc-tool-palette .dc-tp-group {
  display: flex;
  align-items: stretch;
  padding: 4px;
  gap: 2px;
}
.dc-tool-palette .dc-tp-sep {
  width: 1px;
  background: var(--maude-chrome-border, rgba(0,0,0,0.08));
  margin: 6px 0;
}
.dc-tool-palette button {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--maude-chrome-fg-1, rgba(40,30,20,0.75));
  cursor: pointer;
  position: relative;
  transition: background-color 80ms linear, color 80ms linear;
}
.dc-tool-palette button:hover {
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 8%, transparent);
  color: var(--maude-chrome-fg-0, #1a1a1a);
}
.dc-tool-palette button:focus-visible {
  outline: 2px solid var(--maude-hud-accent, #d63b1f);
  outline-offset: -2px;
}
/* DDR-046 — Active tool: tinted background + accent underbar + accent text.
   The underbar is rendered via ::after so the visual stays inside the 6 px
   radius without leaking past the button edge. */
.dc-tool-palette button[aria-pressed="true"] {
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 14%, transparent);
  color: var(--maude-hud-accent, #d63b1f);
}
.dc-tool-palette button[aria-pressed="true"]::after {
  content: "";
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 2px;
  height: 2px;
  background: var(--maude-hud-accent, #d63b1f);
  border-radius: 1px;
}
/* T19 — sticky-tool lock badge. Tiny accent square in the top-right corner
   of the active tool button, fades in 50 ms after a double-click. The badge
   reads "armed across draws" so the user understands the tool will stay
   selected after each shape commit. */
.dc-tool-palette button[data-sticky="true"] {
  /* Keep the tinted active background; add a hairline ring so the lock state
     is readable even when the button is also aria-pressed. */
  box-shadow: inset 0 0 0 1px var(--maude-hud-accent, #d63b1f);
}
.dc-tool-palette button .dc-tp-sticky-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  background: var(--maude-hud-accent, #d63b1f);
  border-radius: 1px;
  box-shadow: 0 0 0 1px var(--maude-chrome-bg-0, #ffffff);
  opacity: 0;
  transition: opacity 50ms linear 50ms;
  pointer-events: none;
}
.dc-tool-palette button[data-sticky="true"] .dc-tp-sticky-badge {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .dc-tool-palette button .dc-tp-sticky-badge { transition: none; }
}
.dc-tool-palette .dc-tp-zoom {
  min-width: 56px;
  padding: 0 8px;
  font-variant-numeric: tabular-nums;
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dc-tool-palette .dc-tp-zoom svg { opacity: 0.6; }
.dc-tp-popover {
  position: absolute;
  right: 4px;
  bottom: 44px;
  background: var(--maude-chrome-bg-0, #ffffff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: 8px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent));
  display: flex;
  flex-direction: column;
  padding: 4px;
  min-width: 160px;
  z-index: 7;
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.dc-tp-popover button {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 6px 10px;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
}
.dc-tp-popover button:hover { background: color-mix(in oklab, var(--maude-chrome-fg-0, #1c1917) 5%, transparent); }
.dc-tp-popover .dc-tp-kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  opacity: 0.55;
}
/* Phase 24 — Shape tool button + its kind popover. The wrapper is the popover's
   positioning context so it anchors directly above the button. */
.dc-tool-palette .dc-tp-shape {
  position: relative;
  display: inline-flex;
}
.dc-tool-palette .dc-tp-shape > button { position: relative; }
.dc-tool-palette .dc-tp-shape-caret {
  position: absolute;
  right: 2px;
  bottom: 1px;
  display: inline-flex;
  opacity: 0.5;
  pointer-events: none;
}
.dc-tp-shape-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--maude-chrome-bg-0, #ffffff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: 8px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent));
  z-index: 8;
}
.dc-tp-shape-popover button[aria-checked="true"] {
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 14%, transparent);
  color: var(--maude-hud-accent, #d63b1f);
}
/* Stage I3 tail — "+ Element" insert popover. A vertical labeled list (not the
   shape popover's icon grid): Div/Text/Image have no recognizable glyph on
   their own, and this is a rare, must-be-legible action, not a recalled tool. */
.dc-tool-palette .dc-tp-insert { position: relative; display: inline-flex; }
.dc-tp-insert-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  min-width: 128px;
  background: var(--maude-chrome-bg-0, #ffffff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: 8px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent));
  z-index: 8;
}
.dc-tp-insert-popover button {
  width: auto;
  height: auto;
  justify-content: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
}
.dc-tp-insert-popover button span.dc-tp-insert-label { font-size: 12px; }
`.trim();

function ensurePaletteStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-tool-palette-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-tool-palette-css';
  s.textContent = PALETTE_CSS;
  document.head.appendChild(s);
}

// DDR-223 — the Preview/Edit segments replace BOTH resting-tool buttons in
// the nav group: `browse` is armed by the Preview segment, `move` by the Edit
// segment (clicking the active segment re-arms it; V and Esc still arm move
// directly). Annotation tools render in BOTH modes (issue #93: preview keeps
// annotations).
const NAV_TOOLS = ['hand', 'comment'] as const;
// Phase 24 — the two rect/ellipse buttons collapse into one Shape tool (with a
// kind popover); sticky/arrow/text/eraser keep their order. Wave H — section
// joins the row (it was ⇧S-only before; users couldn't discover it).
const DRAW_TOOLS = [
  'pen',
  'highlighter',
  'shape',
  'sticky',
  'section',
  'arrow',
  'text',
  'eraser',
] as const;

// Phase 24 — the Shape tool's primitive picker (popover order matches FigJam).
const SHAPE_KINDS: ReadonlyArray<{ kind: ShapeKind; label: string }> = [
  { kind: 'square', label: 'Square' },
  { kind: 'rounded', label: 'Rounded square' },
  { kind: 'circle', label: 'Circle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'triangle-down', label: 'Triangle down' },
];

/**
 * Stage I3 tail — resolve the insert anchor for the tool-palette "+ Element"
 * affordance's "or appends to the active artboard" mode (the plan's fallback
 * when the user hasn't right-clicked a specific element). Growth-only: an
 * artboard's `<article data-dc-screen>` carries NO `data-cd-id` of its own
 * (`DCArtboard` doesn't forward it to the DOM — only its SOURCE JSX tag is
 * stamped, unresolvable from here), so the primary anchor is the artboard's
 * LAST direct child that DOES carry a `data-cd-id`, inserted `after` it — the
 * exact relation the context-menu's element-relative insert already uses.
 * When the artboard has NO such child yet (fresh/emptied artboard — the bug
 * this fallback fixes, was previously a silent no-op), fall back to the
 * artboard's own `data-dc-screen` id (its `DCArtboard id` prop verbatim) and
 * insert `inside-end` of it directly — `applyInsertElementIntoArtboard`
 * addresses the `<DCArtboard>` JSX node by that same id, mirroring
 * `applyResizeArtboard`/`applyDeleteArtboard`. Returns `null` only when there
 * is no artboard at all (or no `.dc-artboard-body` wrapper) — nothing to
 * anchor on, artboard-less canvas. `doc` is injectable for testing without a
 * real iframe.
 */
export function resolveInsertAnchor(
  doc: Document = document
): { refId: string; position: 'after' } | { artboardId: string; position: 'inside-end' } | null {
  const current = doc.querySelector('[data-dc-screen][aria-current="true"]');
  const artboardEl = current ?? doc.querySelector('[data-dc-screen]');
  if (!artboardEl) return null;
  const body = artboardEl.querySelector(':scope > .dc-artboard-body');
  if (!body) return null;
  const kids = Array.from(body.children).reverse();
  const last = kids.find((el) => el.hasAttribute('data-cd-id'));
  const refId = last?.getAttribute('data-cd-id');
  if (refId) return { refId, position: 'after' };
  const artboardId = artboardEl.getAttribute('data-dc-screen');
  return artboardId ? { artboardId, position: 'inside-end' } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component

export function ToolPalette() {
  ensurePaletteStyles();
  const { tool, setTool, tools, mode, sticky, toggleSticky, shapeKind, setShapeKind } =
    useToolMode();
  const chrome = useChromeVisibility();
  const [mounted, setMounted] = useState(false);
  const [shapeOpen, setShapeOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!shapeOpen && !insertOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setShapeOpen(false);
        setInsertOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShapeOpen(false);
        setInsertOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [shapeOpen, insertOpen]);
  // Close the shape popover whenever the tool changes away from Shape.
  useEffect(() => {
    if (tool !== 'shape') setShapeOpen(false);
  }, [tool]);

  // Stage I3 tail — insert a Div/Text/Image relative to the active artboard's
  // last existing element, or — empty-artboard fallback — as a child of the
  // artboard itself (`resolveInsertAnchor`). Same request verbs the
  // context-menu's per-element "Insert ▸ …" already posts (`insert-request` /
  // `insert-image-request`, main-origin shell WRITES — DDR-054), extended with
  // an `artboardId` field for the fallback case; a null anchor is still a
  // no-op for div/text (nothing to insert into) but NOT for image —
  // feature-bulk-media-insert still posts `insert-image-request` with no
  // refId/artboardId, so an artboard-less canvas opens the picker (in
  // annotation-only mode, Task 7) instead of silently doing nothing.
  const insertViaPalette = (kind: 'div' | 'text' | 'image') => {
    setInsertOpen(false);
    const anchor = resolveInsertAnchor();
    if (!anchor && kind !== 'image') return;
    const anchorFields =
      anchor == null
        ? {}
        : 'artboardId' in anchor
          ? { artboardId: anchor.artboardId, position: anchor.position }
          : { refId: anchor.refId, position: anchor.position };
    try {
      if (kind === 'image') {
        window.parent.postMessage({ dgn: 'insert-image-request', ...anchorFields }, '*');
      } else {
        window.parent.postMessage({ dgn: 'insert-request', ...anchorFields, kind }, '*');
      }
    } catch {
      /* detached / cross-origin teardown */
    }
  };

  if (!mounted) return null;
  // Presentation Mode hides the whole tool palette (clean artboards-only view).
  if (chrome?.present) return null;

  const byId = new Map(tools.map((t) => [t.id, t]));
  const navList = NAV_TOOLS.map((id) => byId.get(id)).filter(Boolean);
  const drawList = DRAW_TOOLS.map((id) => byId.get(id)).filter(Boolean);
  // Cloud Phase 25 C2 — read-only canvas: the draw group is already empty
  // (ToolProvider filters `tools`), and the hardcoded write affordances
  // (Insert +, Stickers) must be ABSENT too. Export + Presentation stay —
  // both are reads of the project.
  const readOnly = isReadOnlyCanvas();

  const renderToolButton = (id: string, label: string, shortcut: string) => {
    const Icon = TOOL_ICONS[id];
    const isDraw = (DRAW_TOOLS as readonly string[]).includes(id);
    const isSticky = sticky.locked && sticky.tool === (id as never);
    const stickyHint = isDraw ? ' · double-click to lock' : '';
    return (
      <button
        key={id}
        type="button"
        aria-label={`${label} (${shortcut})${isSticky ? ' — locked' : stickyHint}`}
        aria-pressed={tool === id}
        data-sticky={isSticky ? 'true' : undefined}
        title={`${label} (${shortcut})${stickyHint}`}
        onClick={() => setTool(id as never)}
        onDoubleClick={() => {
          if (!isDraw) return;
          toggleSticky(id as never);
        }}
      >
        {Icon ? <Icon /> : <span style={{ fontSize: 11 }}>{shortcut}</span>}
        {isSticky ? <span className="dc-tp-sticky-badge" aria-hidden="true" /> : null}
      </button>
    );
  };

  // Phase 24 — the single Shape tool. The button shows the CURRENT shape-kind
  // glyph (so the toolbar reflects what you'll draw); first click arms the tool,
  // clicking it again (or the caret) opens the 6-kind popover.
  const renderShapeButton = () => {
    const isShape = tool === 'shape';
    const isSticky = sticky.locked && sticky.tool === 'shape';
    const KindIcon = SHAPE_KIND_ICONS[shapeKind] ?? TOOL_ICONS.shape;
    return (
      <span key="shape" className="dc-tp-shape">
        <button
          type="button"
          aria-label={`Shape (R) — ${shapeKind}, click again for shape types`}
          aria-pressed={isShape}
          aria-haspopup="menu"
          aria-expanded={shapeOpen}
          data-sticky={isSticky ? 'true' : undefined}
          title="Shape (R) · double-click to lock"
          onClick={() => {
            if (!isShape) setTool('shape');
            else setShapeOpen((o) => !o);
          }}
          onDoubleClick={() => toggleSticky('shape')}
        >
          {KindIcon ? <KindIcon /> : null}
          <span className="dc-tp-shape-caret" aria-hidden="true">
            <IconChevronDown size={9} />
          </span>
          {isSticky ? <span className="dc-tp-sticky-badge" aria-hidden="true" /> : null}
        </button>
        {shapeOpen ? (
          <div className="dc-tp-shape-popover" role="menu" aria-label="Shape type">
            {SHAPE_KINDS.map(({ kind, label }) => {
              const Icon = SHAPE_KIND_ICONS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  role="menuitemradio"
                  aria-checked={shapeKind === kind}
                  aria-label={label}
                  title={label}
                  onClick={() => {
                    setShapeKind(kind);
                    setTool('shape');
                    setShapeOpen(false);
                  }}
                >
                  {Icon ? <Icon /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </span>
    );
  };

  return (
    <div ref={containerRef} className="dc-tool-palette" role="toolbar" aria-label="Canvas tools">
      <div className="dc-tp-group">
        {navList.map((t) => (t ? renderToolButton(t.id, t.label, t.shortcut) : null))}
      </div>
      {drawList.length > 0 ? (
        <>
          <div className="dc-tp-sep" />
          <div className="dc-tp-group">
            {drawList.map((t) =>
              t
                ? t.id === 'shape'
                  ? renderShapeButton()
                  : renderToolButton(t.id, t.label, t.shortcut)
                : null
            )}
          </div>
        </>
      ) : null}
      <div className="dc-tp-sep" />
      <div className="dc-tp-group">
        {/* DDR-223 — "+ Element" is a JSX WRITE, an edit-mode affordance;
            stickers/export/present stay in both modes. */}
        {!readOnly && mode === 'edit' && (
          <span className="dc-tp-insert">
            <button
              type="button"
              aria-label="Insert element — Div, Text, or Image"
              aria-haspopup="menu"
              aria-expanded={insertOpen}
              title="Insert element (appends to the active artboard)"
              onClick={() => setInsertOpen((o) => !o)}
            >
              <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
                +
              </span>
            </button>
            {insertOpen ? (
              <div className="dc-tp-insert-popover" role="menu" aria-label="Insert element">
                <button type="button" role="menuitem" onClick={() => insertViaPalette('div')}>
                  <IconSquare />
                  <span className="dc-tp-insert-label">Div</span>
                </button>
                <button type="button" role="menuitem" onClick={() => insertViaPalette('text')}>
                  <IconLetterA />
                  <span className="dc-tp-insert-label">Text</span>
                </button>
                <button type="button" role="menuitem" onClick={() => insertViaPalette('image')}>
                  <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>
                    ▧
                  </span>
                  <span className="dc-tp-insert-label">Image</span>
                </button>
              </div>
            ) : null}
          </span>
        )}
        {!readOnly && (
          <button
            type="button"
            aria-label="Stickers"
            title="Stickers — searchable sticker picker"
            onClick={() => {
              try {
                window.parent.postMessage({ dgn: 'open-sticker-picker' }, '*');
              } catch {
                /* detached / cross-origin teardown */
              }
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
              🙂
            </span>
          </button>
        )}
        <button
          type="button"
          aria-label="Export (⌘E)"
          title="Export (⌘E)"
          onClick={() => {
            // Phase 6.5 T9 — dispatch the same custom event the context-menu
            // uses; the dialog provider opens with the default scope.
            try {
              window.dispatchEvent(new CustomEvent('maude:open-export', { detail: {} }));
            } catch {
              /* ignore — non-window environments */
            }
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
            ⬇
          </span>
        </button>
        {/* DDR-223 addendum 2 — the Presentation button moved into the mode
            toggle at the palette's head (third segment). */}
      </div>
    </div>
  );
}
ToolPalette.displayName = 'ToolPalette';
