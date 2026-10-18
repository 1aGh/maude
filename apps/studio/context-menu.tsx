/**
 * @file       context-menu.tsx — Phase 4.1 right-click context menu
 * @scope      apps/studio/context-menu.tsx
 * @purpose    Floating, context-aware right-click menu. The router calls
 *             `openContextMenu({ clientX, clientY, target })`; the menu
 *             resolves the section list via the ContextRegistry and renders
 *             items with right-aligned shortcut hints. Pattern prior:
 *             `audience-pro/components-toast-menu.html` (hairline border,
 *             mono shortcut hints, sep lines).
 *
 * Targeting taxonomy:
 *   - element        — cursor is over a `[data-cd-id]` descendant
 *   - artboard-chrome — cursor over an artboard's label/border (`[data-dc-screen]`)
 *   - world           — cursor on empty canvas background
 *   - overlay         — cursor over MiniMap / ZoomToolbar / ToolPalette
 *                       (no menu — bubble through)
 *
 * Items registered for each target type live in the default registry; consumers
 * can extend via `<ContextMenuProvider extra={...}>` (Phase 5+).
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types

export type ContextTargetKind = 'element' | 'artboard-chrome' | 'world' | 'overlay';

export interface ContextTarget {
  kind: ContextTargetKind;
  /** Resolved DOM element under cursor (raw hit). */
  el: Element | null;
  /** Stable `data-cd-id` if the hit is inside a TSX-pipeline-stamped subtree. */
  cdId: string | null;
  /** Owning artboard id (`data-dc-screen`). */
  artboardId: string | null;
  /** Viewport coords for the menu position. */
  clientX: number;
  clientY: number;
}

export interface MenuItem {
  id: string;
  label: string;
  /** Right-aligned shortcut hint (e.g. `⌘C`, `⌫`). */
  shortcut?: string;
  destructive?: boolean;
  /**
   * A FUNCTION form is resolved per-click against `target` — same rationale as
   * the function-form `submenu` below (e.g. "Open Timeline" only enabled when
   * THIS right-clicked artboard actually contains a video sequence).
   */
  disabled?: boolean | ((target: ContextTarget) => boolean);
  /**
   * Optional nested flyout (e.g. `Theme ▸ DS default / Light / Dark / Follow
   * chrome`). When present the row opens a submenu on hover / ArrowRight /
   * click and `onSelect` on THIS item is not invoked — only the chosen leaf's
   * `onSelect` fires. A disabled leaf carries `disabledHint` for its title.
   *
   * A FUNCTION form is resolved lazily by `MenuItemRow` at render time (not
   * memoized at registry-build time) — for a per-click computed flyout like
   * "Select layer" (every stamped element stacked under the cursor, which
   * depends on `target.clientX/clientY` and can't be known when the static
   * registry is built).
   */
  submenu?: MenuItem[] | ((target: ContextTarget) => MenuItem[]);
  /** Hover/title hint shown when the item is `disabled` (a11y affordance). */
  disabledHint?: string;
  /**
   * Fully REMOVE the item for a target (vs. `disabled`, which greys it in place).
   * Resolved per-click. Use when an entry is meaningless — not merely
   * unavailable — for the right-clicked element (e.g. "Edit Photo…" only makes
   * sense on an `<img>`, so it shouldn't appear at all on a `<div>`).
   */
  hidden?: boolean | ((target: ContextTarget) => boolean);
  onSelect: (target: ContextTarget) => void;
}

export type MenuSection = MenuItem[];

export type ContextRegistry = Record<ContextTargetKind, MenuSection[]>;

// ─────────────────────────────────────────────────────────────────────────────
// Default registry. Item callbacks intentionally use `console.warn` for the
// un-implemented affordances; T6 + later phases wire real handlers in.

function noop(name: string) {
  return () => {
    if (typeof console !== 'undefined') {
      console.warn(`[context-menu] TODO: ${name}`);
    }
  };
}

// Phase 6.5 T9 — export hooks. The default registry items use noop() so the
// menu still renders when the dialog provider isn't mounted; consumers wire
// real `openExport(scope)` callbacks by passing a custom registry to
// <ContextMenuProvider extra>. Pattern matches the existing Phase 5 noop
// affordances.
function defaultExportItem(label: string, scopeHint: string): MenuItem {
  return {
    id: `export-${scopeHint}`,
    label,
    shortcut: scopeHint === 'selection' ? '⌘E' : undefined,
    onSelect: () => {
      const detail = { scope: scopeHint };
      try {
        // S8.2 — the shell's one Export sheet (the iframe's own dialog is retired)
        window.parent.postMessage({ dgn: 'open-export', detail }, '*');
      } catch {
        /* SSR / non-window environments */
      }
    },
  };
}

const DEFAULT_REGISTRY: ContextRegistry = {
  element: [
    [
      { id: 'add-comment', label: 'Add comment', shortcut: 'C', onSelect: noop('add-comment') },
      { id: 'copy-css', label: 'Copy CSS', shortcut: '⌘⇧C', onSelect: noop('copy-css') },
      { id: 'copy-id', label: 'Copy data-cd-id', onSelect: noop('copy-id') },
      { id: 'inspect', label: 'Inspect', shortcut: '⌥I', onSelect: noop('inspect') },
    ],
    [defaultExportItem('Export selection…', 'selection')],
    [
      // S2.6 — the real rows are `editing/object-menu.tsx`'s; the old '⌘⇧H' hint named a chord that
      // is Handoff's (⇧⌘H) and the lock chord is ⇧⌘L.
      { id: 'hide', label: 'Hide', onSelect: noop('hide') },
      { id: 'lock', label: 'Lock', shortcut: '⇧⌘L', onSelect: noop('lock') },
    ],
  ],
  'artboard-chrome': [
    [
      { id: 'rename', label: 'Rename', shortcut: '↵', onSelect: noop('rename-artboard') },
      { id: 'duplicate', label: 'Duplicate', shortcut: '⌘D', onSelect: noop('duplicate-artboard') },
    ],
    [defaultExportItem('Export this artboard…', 'artboard')],
    [
      { id: 'fit-one', label: 'Fit just this artboard', onSelect: noop('fit-one') },
      { id: 'reset-pos', label: 'Reset position', onSelect: noop('reset-artboard-pos') },
    ],
  ],
  world: [
    [
      {
        id: 'paste-artboard',
        label: 'Paste artboard',
        shortcut: '⌘V',
        onSelect: noop('paste-artboard'),
      },
      { id: 'fit-view', label: 'Fit to view', shortcut: '1', onSelect: noop('fit-view') },
      { id: 'reset-view', label: 'Reset view', shortcut: '⌘0', onSelect: noop('reset-view') },
    ],
    [
      defaultExportItem('Export project (ZIP)…', 'project-raw'),
      defaultExportItem('Export canvas as separate…', 'canvas-as-separate'),
    ],
  ],
  overlay: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider / context

interface ContextMenuValue {
  open: (target: ContextTarget) => void;
  close: () => void;
  registry: ContextRegistry;
}

const ContextMenuContext = createContext<ContextMenuValue | null>(null);

interface InternalState {
  target: ContextTarget | null;
}

const MENU_CSS = `
.dc-context-menu {
  position: fixed;
  z-index: 7;
  background: var(--maude-chrome-bg-0, #fff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: 8px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent));
  padding: 4px;
  min-width: 220px;
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  color: var(--maude-chrome-fg-0, rgba(20,15,10,0.92));
  user-select: none;
}
.dc-context-menu .dc-menu-sep {
  height: 1px;
  background: var(--maude-chrome-border, rgba(0,0,0,0.08));
  margin: 4px -4px;
}
.dc-context-menu .dc-menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 5px 12px;
  border-radius: 0;
  cursor: pointer;
  background: transparent;
  border: 0;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
}
.dc-context-menu .dc-menu-item:hover {
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #1c1917) 8%, transparent);
}
.dc-context-menu .dc-menu-item:focus-visible {
  /* fix-photo-editor-followup-debt Task 16 — was outline: none (an
     ~1.05:1-contrast, effectively invisible focus ring). Reuses
     --maude-hud-accent (canvas-lib.tsx's own established focus-visible
     token for this chrome family — artboard labels, zoom toolbar) rather
     than inventing a new one; -2px inset offset matches that same
     convention for a control inside a bordered container. */
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #1c1917) 8%, transparent);
  outline: 2px solid var(--maude-hud-accent, #d63b1f);
  outline-offset: -2px;
}
.dc-context-menu .dc-menu-item[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}
.dc-context-menu .dc-menu-item.is-destructive:hover,
.dc-context-menu .dc-menu-item.is-destructive:focus-visible {
  background: #c0392b;
  color: #fff;
}
.dc-context-menu .dc-menu-shortcut {
  color: var(--maude-chrome-fg-1, rgba(40,30,20,0.55));
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
/* Submenu flyout (Theme ▸ …). Anchored to the right of its parent row; flips
   left near the viewport edge via .is-flip. Reuses .dc-menu-item styling. */
.dc-context-menu .dc-menu-sub { position: relative; }
.dc-context-menu .dc-menu-caret { color: var(--maude-chrome-fg-1, rgba(40,30,20,0.55)); font-size: 11px; }
.dc-context-menu .dc-menu-flyout {
  position: absolute;
  top: -5px;
  left: calc(100% + 3px);
  min-width: 196px;
  padding: 4px;
  background: var(--maude-chrome-bg-0, #fff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: 8px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent));
  z-index: 8;
}
.dc-context-menu .dc-menu-flyout.is-flip { left: auto; right: calc(100% + 3px); }
`.trim();

// Exported (FigJam v3) — the annotation layer's right-click menu reuses the
// same .dc-context-menu visual language without duplicating the stylesheet.
export function ensureMenuStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-context-menu-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-context-menu-css';
  s.textContent = MENU_CSS;
  document.head.appendChild(s);
}

export function ContextMenuProvider({
  children,
  registry = DEFAULT_REGISTRY,
}: {
  children: ReactNode;
  registry?: ContextRegistry;
}) {
  const [state, setState] = useState<InternalState>({ target: null });

  const open = useCallback((target: ContextTarget) => {
    if (target.kind === 'overlay') return;
    setState({ target });
  }, []);
  const close = useCallback(() => setState({ target: null }), []);

  const value = useMemo<ContextMenuValue>(
    () => ({ open, close, registry }),
    [open, close, registry]
  );

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      {state.target ? (
        <ContextMenuView
          target={state.target}
          sections={registry[state.target.kind] ?? []}
          onClose={close}
        />
      ) : null}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu(): ContextMenuValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    throw new Error('useContextMenu must be used inside <ContextMenuProvider>');
  }
  return ctx;
}

export function useContextMenuOptional(): ContextMenuValue | null {
  return useContext(ContextMenuContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// View

export function ContextMenuView({
  target,
  sections,
  onClose,
}: {
  target: ContextTarget;
  sections: MenuSection[];
  onClose: () => void;
}) {
  ensureMenuStyles();
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({
    x: target.clientX,
    y: target.clientY,
  });

  // Reposition if menu would overflow the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = target.clientX;
    let ny = target.clientY;
    if (nx + r.width > vw - 8) nx = Math.max(8, vw - r.width - 8);
    if (ny + r.height > vh - 8) ny = Math.max(8, vh - r.height - 8);
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // Focus first menu item for keyboard nav.
    const firstBtn = el.querySelector<HTMLButtonElement>('button.dc-menu-item:not([disabled])');
    firstBtn?.focus();
    // Dismiss on outside-click / Esc / scroll.
    const onDocPointer = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(
          el.querySelectorAll<HTMLButtonElement>('button.dc-menu-item:not([disabled])')
        );
        if (items.length === 0) return;
        // `document.activeElement` is Element | null; anything that is not one
        // of these buttons behaves as "no current item" (-1), which is what
        // indexOf returned before and what the wrap-around arithmetic expects.
        const active = document.activeElement;
        const idx = active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
        const nextIdx =
          e.key === 'ArrowDown'
            ? (idx + 1) % items.length
            : (idx - 1 + items.length) % items.length;
        items[nextIdx]?.focus();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onClose);
    };
  }, [target.clientX, target.clientY, onClose, pos.x, pos.y]);

  // Resolve per-target `hidden` and drop now-empty sections (so a section that
  // held only a hidden item doesn't leave a dangling separator).
  const visibleSections = sections
    .map((section) =>
      section.filter((item) => {
        const h = typeof item.hidden === 'function' ? item.hidden(target) : item.hidden;
        return !h;
      })
    )
    .filter((section) => section.length > 0);
  return (
    <div
      ref={ref}
      className="dc-context-menu"
      role="menu"
      data-esc-owner=""
      style={{ left: pos.x, top: pos.y }}
    >
      {visibleSections.map((section, si) => {
        const sectionKey = section.map((i) => i.id).join('|') || `s${si}`;
        return (
          <div key={sectionKey} role="group">
            {si > 0 ? <div className="dc-menu-sep" aria-hidden="true" /> : null}
            {section.map((item) => (
              <MenuItemRow key={item.id} item={item} target={target} onClose={onClose} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MenuItemRow — a single menu row. Plain rows render a button; rows with a
// `submenu` render a flyout (opens on hover / ArrowRight / click). Additive:
// existing flat registries (no `submenu`) take the plain-button path unchanged.

function MenuItemRow({
  item,
  target,
  onClose,
}: {
  item: MenuItem;
  target: ContextTarget;
  onClose: () => void;
}) {
  const [subOpen, setSubOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve a function-form submenu against THIS click's target (e.g.
  // "Select layer" computing candidates from `target.clientX/clientY`).
  const submenuItems = typeof item.submenu === 'function' ? item.submenu(target) : item.submenu;
  // Same per-click resolution for a function-form `disabled` (e.g. "Open
  // Timeline" only enabled on an artboard that actually contains video).
  const disabled = typeof item.disabled === 'function' ? item.disabled(target) : item.disabled;

  if (!submenuItems || submenuItems.length === 0) {
    return (
      <button
        type="button"
        role="menuitem"
        data-testid={`canvas-menu-item-${item.id}`}
        disabled={disabled}
        title={disabled ? item.disabledHint : undefined}
        className={`dc-menu-item${item.destructive ? ' is-destructive' : ''}`}
        onClick={() => {
          if (disabled) return;
          item.onSelect(target);
          onClose();
        }}
      >
        <span>{item.label}</span>
        {item.shortcut ? <span className="dc-menu-shortcut">{item.shortcut}</span> : null}
      </button>
    );
  }

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const open = (focusFirst = false) => {
    cancelClose();
    const r = btnRef.current?.getBoundingClientRect();
    if (r && typeof window !== 'undefined') setFlip(r.right + 200 > window.innerWidth);
    setSubOpen(true);
    if (focusFirst) {
      setTimeout(() => {
        flyoutRef.current
          ?.querySelector<HTMLButtonElement>('button.dc-menu-item:not([disabled])')
          ?.focus();
      }, 0);
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setSubOpen(false), 140);
  };

  return (
    <div className="dc-menu-sub" onMouseEnter={() => open()} onMouseLeave={scheduleClose}>
      <button
        ref={btnRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={subOpen}
        data-testid={`canvas-menu-item-${item.id}`}
        disabled={disabled}
        className="dc-menu-item"
        onClick={() => (subOpen ? setSubOpen(false) : open())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open(true);
          } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
            if (subOpen) {
              e.stopPropagation();
              setSubOpen(false);
            }
          }
        }}
      >
        <span>{item.label}</span>
        <span className="dc-menu-caret" aria-hidden="true">
          ▸
        </span>
      </button>
      {subOpen ? (
        <div
          ref={flyoutRef}
          className={`dc-menu-flyout${flip ? ' is-flip' : ''}`}
          role="menu"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {submenuItems.map((sub) => {
            // Same per-click resolution the leaf branch does at `disabled`
            // above. Passing the raw value here meant a FUNCTION-form
            // `disabled` — always truthy — greyed the item out permanently and
            // swallowed every click, whatever the predicate said about this
            // target. Submenus simply never got the resolution leaves had.
            const subDisabled =
              typeof sub.disabled === 'function' ? sub.disabled(target) : sub.disabled;
            return (
              <button
                key={sub.id}
                type="button"
                role="menuitem"
                data-testid={`canvas-menu-item-${sub.id}`}
                disabled={subDisabled}
                title={subDisabled ? sub.disabledHint : undefined}
                className={`dc-menu-item${sub.destructive ? ' is-destructive' : ''}`}
                onClick={() => {
                  if (subDisabled) return;
                  sub.onSelect(target);
                  onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setSubOpen(false);
                    btnRef.current?.focus();
                  }
                }}
              >
                <span>{sub.label}</span>
                {sub.shortcut ? <span className="dc-menu-shortcut">{sub.shortcut}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
