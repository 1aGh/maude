/**
 * @file       tool-palette.tsx — the canvas's two toolbars (V2-4.5a, V2-1.2 §5.5)
 * @scope      apps/studio/tool-palette.tsx, apps/studio/toolbars/*
 * @purpose    Bottom-center floating toolbar island inside the canvas iframe. One toolbar per mode,
 *             read from `MODE_TOOLS` (bridge/canvas-modes.ts): Edit (Select · Hand · Frame · Shape ·
 *             Pen · Text · Image · Component · More), Preview (Hand · Sticky · Comment · Marker ·
 *             Arrow · Shape · Text · Stickers · Section) and Viewing (Hand · Comment). Present and
 *             Can view show none. It replaced the v1 palette; the mode segments left in V2-4.3b.
 *
 *             The mode is the shell's: the toolbar follows the governed `set-mode` (the document's
 *             mode store) and falls back to the tool provider's posture while ungoverned. A mode
 *             change morphs the island (ToolbarMorph, `--dur-panel`, compositor-only; reduced
 *             motion is a cut) and the island reports its box to the shell (`toolbar-rect`, ≤ 1 per
 *             frame) so the shell's tool panels anchor to it.
 *
 *             Slots whose tool does not exist yet are in the data but NOT rendered (`pending`):
 *             S2 builds them. Frame / Image ride today's "+ Insert Div / Image"; Text is a tool (click to type).
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import {
  ALL_CAPS,
  armTarget,
  type CanvasModeV2,
  type InsertKind,
  type ModeCaps,
  NO_CAPS,
  roleOfCaps,
  STICKY_LOCKABLE,
  type ToolId,
  type ToolSlot,
  visibleSlots,
} from './bridge/canvas-modes.ts';
import { IconChevronDown, SHAPE_KIND_ICONS, TOOL_ICONS } from './canvas-icons.tsx';
import { TOOLBAR_INSERT_EVENT, type Tool } from './input-router.tsx';
import { isReadOnlyCanvas } from './read-only-mode.ts';
import { isMarkerTip, lastMarkerTip, rememberMarkerTip } from './toolbars/marker-tip.ts';
import { openToolPanel } from './toolbars/tool-panel.ts';
import { ensureToolbarStyles } from './toolbars/toolbar-css.ts';
import { SLOT_ICONS } from './toolbars/toolbar-icons.tsx';
import { createRectPoster, wholeRect } from './toolbars/toolbar-rect.ts';
import { useChromeVisibility } from './use-chrome-visibility.tsx';
import { type ShapeKind, useToolMode } from './use-tool-mode.tsx';

// Phase 24 — the Shape tool's primitive picker (popover order matches FigJam).
const SHAPE_KINDS: ReadonlyArray<{ kind: ShapeKind; label: string }> = [
  { kind: 'square', label: 'Square' },
  { kind: 'rounded', label: 'Rounded square' },
  { kind: 'circle', label: 'Circle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'triangle-down', label: 'Triangle down' },
];

const TIP_LABELS: Readonly<Record<string, string>> = {
  pen: 'Marker',
  highlighter: 'Highlighter',
  eraser: 'Eraser',
};

/** The island's morph, in ms: `--dur-panel` (220) plus a frame of slack before the ghost is dropped. */
const MORPH_MS = 260;

/** Resting-tool slots (the navigate group); a separator follows the first run of them. */
const NAV_SLOT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['move', 'hand', 'browse', 'inspect']);

/** Which glyph a tool/slot wears (the v1 icons keep their meaning). */
const SLOT_GLYPH: Readonly<Record<string, string>> = {
  browse: 'hand',
  inspect: 'hand',
  'el-text': 'text',
};

/**
 * Stage I3 tail — resolve the insert anchor for the "+ Element" affordance's "or appends to the
 * active artboard" mode (the plan's fallback when the user hasn't right-clicked a specific element).
 * Growth-only: an artboard's `<article data-dc-screen>` carries NO `data-cd-id` of its own
 * (`DCArtboard` doesn't forward it to the DOM — only its SOURCE JSX tag is stamped, unresolvable from
 * here), so the primary anchor is the artboard's LAST direct child that DOES carry a `data-cd-id`,
 * inserted `after` it — the exact relation the context-menu's element-relative insert already uses.
 * When the artboard has NO such child yet (fresh/emptied artboard — the bug this fallback fixes, was
 * previously a silent no-op), fall back to the artboard's own `data-dc-screen` id (its `DCArtboard id`
 * prop verbatim) and insert `inside-end` of it directly — `applyInsertElementIntoArtboard` addresses
 * the `<DCArtboard>` JSX node by that same id, mirroring `applyResizeArtboard`/`applyDeleteArtboard`.
 * Returns `null` only when there is no artboard at all (or no `.dc-artboard-body` wrapper) — nothing
 * to anchor on, artboard-less canvas. `doc` is injectable for testing without a real iframe.
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

/** Fire a verb at the shell (a main-origin write; DDR-054 keeps the canvas itself write-free). */
function postShell(msg: object): void {
  try {
    window.parent.postMessage(msg, '*');
  } catch {
    /* detached / cross-origin teardown */
  }
}

/** Stage I3 tail — insert a Div/Text/Image relative to the active artboard's last existing element, or —
 *  empty-artboard fallback — as a child of the artboard itself (`resolveInsertAnchor`). Same request
 *  verbs the context-menu's per-element "Insert ▸ …" posts (`insert-request` / `insert-image-request`),
 *  extended with an `artboardId` field for the fallback; a null anchor is a no-op for div/text (nothing
 *  to insert into) but NOT for image — feature-bulk-media-insert still posts `insert-image-request` with
 *  no refId/artboardId, so an artboard-less canvas opens the picker in annotation-only mode. */
function insertViaToolbar(kind: InsertKind): void {
  const anchor = resolveInsertAnchor();
  if (!anchor && kind !== 'image') return;
  const fields =
    anchor == null
      ? {}
      : 'artboardId' in anchor
        ? { artboardId: anchor.artboardId, position: anchor.position }
        : { refId: anchor.refId, position: anchor.position };
  if (kind === 'image') postShell({ dgn: 'insert-image-request', ...fields });
  else postShell({ dgn: 'insert-request', ...fields, kind });
}

function reducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/** The shell's governed mode snapshot (null outside a browser, or until the first `set-mode`). */
function useGoverned(): { mode: CanvasModeV2; caps: Readonly<ModeCaps> } | null {
  const store = typeof window !== 'undefined' ? canvasModeStore(window) : null;
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribe(cb) : () => {}),
    [store]
  );
  const snap = useSyncExternalStore(
    subscribe,
    () => store?.get() ?? null,
    () => null
  );
  return snap?.mode && snap.caps ? { mode: snap.mode, caps: snap.caps } : null;
}

const glyphFor = (id: string | null, fallback?: string) => {
  const key = id ? (SLOT_GLYPH[id] ?? id) : '';
  return TOOL_ICONS[key] ?? SLOT_ICONS[key] ?? (fallback ? TOOL_ICONS[fallback] : undefined);
};

type Popover = 'shape-kinds' | 'marker-tips' | null;

export function ToolPalette() {
  ensureToolbarStyles();
  const {
    tool,
    setTool,
    tools,
    mode: posture,
    sticky,
    toggleSticky,
    shapeKind,
    setShapeKind,
  } = useToolMode();
  const chrome = useChromeVisibility();
  const governed = useGoverned();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState<Popover>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // Which toolbar: Presentation hides everything; else the shell's mode; else the provider's posture.
  const barMode: CanvasModeV2 = chrome?.present
    ? 'present'
    : (governed?.mode ?? (posture === 'preview' ? 'preview' : 'edit'));
  const caps = governed?.caps ?? (isReadOnlyCanvas() ? NO_CAPS : ALL_CAPS);
  const role = roleOfCaps(caps);
  const toolSet = useMemo(() => new Set<string>(tools.map((t) => t.id)), [tools]);
  const slots = useMemo(
    () => visibleSlots(barMode, role, (t) => toolSet.has(t)),
    [barMode, role, toolSet]
  );

  // ToolbarMorph — derived during render so the ghost and the animation start in the same frame the
  // new slots appear. Reduced motion (M6) and a toolbar that is absent on either side are a cut.
  const [track, setTrack] = useState<{ mode: CanvasModeV2; slots: readonly ToolSlot[] }>({
    mode: barMode,
    slots,
  });
  const [morph, setMorph] = useState<{ from: CanvasModeV2; slots: readonly ToolSlot[] } | null>(
    null
  );
  if (track.mode !== barMode || track.slots !== slots) {
    if (track.mode !== barMode && track.slots.length > 0 && slots.length > 0 && !reducedMotion())
      setMorph({ from: track.mode, slots: track.slots });
    setTrack({ mode: barMode, slots });
  }
  useEffect(() => {
    if (!morph) return;
    const t = setTimeout(() => setMorph(null), MORPH_MS);
    return () => clearTimeout(t);
  }, [morph]);

  // `toolbar-rect` — the island's box for the shell's tool panels, coalesced to one per frame.
  const modeRef = useRef(barMode);
  modeRef.current = barMode;
  const poster = useMemo(
    () =>
      createRectPoster({
        measure: () => {
          const el = rootRef.current;
          if (!el) return null;
          const r = wholeRect(el.getBoundingClientRect());
          return r.w > 0 && r.h > 0 ? r : null;
        },
        mode: () => modeRef.current,
        post: (m) => {
          if (typeof window !== 'undefined' && window.parent !== window) postShell(m);
        },
      }),
    []
  );
  useEffect(() => () => poster.cancel(), [poster]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a mode or slot change is what re-measures
  useEffect(() => poster.request(), [poster, barMode, slots]);
  const setRoot = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      roRef.current?.disconnect();
      roRef.current = null;
      if (el && typeof ResizeObserver === 'function') {
        roRef.current = new ResizeObserver(() => poster.request());
        roRef.current.observe(el);
      }
      poster.request();
    },
    [poster]
  );

  useEffect(() => setMounted(true), []);
  // The Marker remembers its last tip for the session (Q4); V2-4.5b's M key arms the same one.
  useEffect(() => rememberMarkerTip(tool), [tool]);
  // V2-4.5b — Edit's F / I keys (and a Text click on empty canvas) do what their momentary slot does (input-router resolves them).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onInsert = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: unknown }>).detail?.kind;
      if (kind === 'div' || kind === 'text' || kind === 'image') insertViaToolbar(kind);
    };
    document.addEventListener(TOOLBAR_INSERT_EVENT, onInsert);
    return () => document.removeEventListener(TOOLBAR_INSERT_EVENT, onInsert);
  }, []);
  // A popover belongs to its tool and its mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing on a mode change is the point
  useEffect(() => {
    setOpen((o) =>
      (o === 'shape-kinds' && tool !== 'shape') || (o === 'marker-tips' && !isMarkerTip(tool))
        ? null
        : o
    );
  }, [tool, barMode]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!mounted || slots.length === 0) return null;

  const armed = (t: ToolId | null): ToolId | null =>
    t === null ? null : armTarget(t, (x) => toolSet.has(x));

  const renderSlot = (s: ToolSlot): ReactNode => {
    if (s.more) return null; // S2 renders More when its first tool lands (nothing live behind it today)
    const keyHint = s.key ? ` (${s.key})` : '';
    const id = s.tool ?? s.panel ?? s.label.toLowerCase();

    // Momentary: Frame / Image add one at the default size, as "+ Insert" did.
    if (s.insert) {
      const Icon = glyphFor(id);
      const kind = s.insert;
      return (
        <button
          key={id}
          type="button"
          data-testid={`toolbar-slot-${id}`}
          aria-label={`${s.label}${keyHint}`}
          title={`${s.label}${keyHint} · adds one to the active artboard`}
          onClick={() => insertViaToolbar(kind)}
        >
          {Icon ? <Icon /> : null}
        </button>
      );
    }

    // Panel-only slot (Stickers): the SHELL draws the panel — `tool-panel-open` (V2-4.5c), anchored to this
    // button and the reported `toolbar-rect`. No tool is armed.
    if (s.tool === null) {
      const Icon = glyphFor(id);
      return (
        <button
          key={id}
          type="button"
          data-testid={`toolbar-slot-${id}`}
          aria-label={`${s.label}${keyHint}`}
          title={`${s.label}${keyHint} — ${s.panel === 'components' ? 'place from the design system' : 'searchable sticker picker'}`}
          onClick={(e) => openToolPanel(s.panel ?? 'stickers', e.currentTarget)}
        >
          {Icon ? <Icon /> : null}
        </button>
      );
    }

    const target = armed(s.tool);
    if (!target) return null;
    const isTips = !!s.tips;
    const isShape = s.popover === 'shape-kinds';
    const tip = isTips ? (isMarkerTip(tool) ? tool : lastMarkerTip()) : null;
    const current: ToolId = isTips ? ((tip as ToolId) ?? target) : target;
    const lit = isTips
      ? (s.tips as readonly ToolId[]).includes(tool as ToolId)
      : tool === target || (s.lights ?? []).includes(tool as ToolId);
    const lockable = STICKY_LOCKABLE.has(current);
    const isSticky = lockable && sticky.locked && sticky.tool === current;
    const popover: Popover = isShape ? 'shape-kinds' : isTips ? 'marker-tips' : null;
    const Icon = isShape
      ? (SHAPE_KIND_ICONS[shapeKind] ?? TOOL_ICONS.shape)
      : glyphFor(isTips ? current : id);
    const stickyHint = lockable ? ' · double-click to lock' : '';
    const label = isShape
      ? `${s.label}${keyHint} — ${shapeKind}, click again for shape types`
      : isTips
        ? `${s.label}${keyHint} — ${TIP_LABELS[current] ?? current}, click again for tips`
        : `${s.label}${keyHint}${isSticky ? ' — locked' : stickyHint}`;
    return (
      <span key={id} className="dc-tp-slot">
        <button
          type="button"
          data-testid={`toolbar-slot-${id}`}
          data-tip={isTips ? current : undefined}
          aria-label={label}
          aria-pressed={lit}
          aria-haspopup={popover ? 'menu' : undefined}
          aria-expanded={popover ? open === popover : undefined}
          data-sticky={isSticky ? 'true' : undefined}
          title={`${s.label}${keyHint}${stickyHint}`}
          onClick={() => {
            if (isTips) {
              if (lit) setOpen((o) => (o === 'marker-tips' ? null : 'marker-tips'));
              else setTool(lastMarkerTip());
            } else if (isShape && lit) {
              setOpen((o) => (o === 'shape-kinds' ? null : 'shape-kinds'));
            } else {
              setTool(target as Tool);
            }
          }}
          onDoubleClick={() => {
            if (lockable) toggleSticky(current as Tool);
          }}
        >
          {Icon ? <Icon /> : null}
          {popover ? (
            <span className="dc-tp-caret" aria-hidden="true">
              <IconChevronDown size={9} />
            </span>
          ) : null}
          {isSticky ? <span className="dc-tp-sticky-badge" aria-hidden="true" /> : null}
        </button>
        {isShape && open === 'shape-kinds' ? (
          <div
            className="dc-tp-shape-popover"
            data-testid="toolbar-popover-shape-kinds"
            role="menu"
            aria-label="Shape type"
          >
            {SHAPE_KINDS.map(({ kind, label: kindLabel }) => {
              const KindIcon = SHAPE_KIND_ICONS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  role="menuitemradio"
                  aria-checked={shapeKind === kind}
                  aria-label={kindLabel}
                  title={kindLabel}
                  onClick={() => {
                    setShapeKind(kind);
                    setTool('shape');
                    setOpen(null);
                  }}
                >
                  {KindIcon ? <KindIcon /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {isTips && open === 'marker-tips' ? (
          <div
            className="dc-tp-list-popover"
            data-testid="toolbar-popover-marker-tips"
            role="menu"
            aria-label="Marker tip"
          >
            {(s.tips as readonly ToolId[]).map((t) => {
              const TipIcon = TOOL_ICONS[t];
              return (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  data-testid={`toolbar-tip-${t}`}
                  aria-checked={current === t}
                  onClick={() => {
                    rememberMarkerTip(t);
                    setTool(t as Tool);
                    setOpen(null);
                  }}
                >
                  {TipIcon ? <TipIcon /> : null}
                  <span className="dc-tp-label">{TIP_LABELS[t] ?? t}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </span>
    );
  };

  // A separator follows the first run of resting-tool slots (Select / Hand).
  const body: ReactNode[] = [];
  let navRun = true;
  slots.forEach((s, i) => {
    const isNav = s.tool !== null && NAV_SLOT_TOOLS.has(s.tool);
    if (navRun && !isNav && i > 0) body.push(<div key="sep" className="dc-tp-sep" />);
    if (!isNav) navRun = false;
    body.push(renderSlot(s));
  });

  return (
    <div
      ref={setRoot}
      className="dc-tool-palette"
      data-testid={`toolbar-${barMode}`}
      data-morph={morph ? `${morph.from}>${barMode}` : undefined}
      role="toolbar"
      aria-label="Canvas tools"
    >
      <div className="dc-tb-body">{body}</div>
      {morph ? (
        <div className="dc-tb-ghost" aria-hidden="true">
          {morph.slots.map((g) => {
            const Icon = glyphFor(g.tool ?? g.panel ?? g.label.toLowerCase());
            return (
              <span key={g.tool ?? g.panel ?? g.label} className="dc-tb-ghost-slot">
                {Icon ? <Icon /> : null}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
ToolPalette.displayName = 'ToolPalette';
