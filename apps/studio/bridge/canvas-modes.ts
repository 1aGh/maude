// apps/studio/bridge/canvas-modes.ts — the v2 canvas mode vocabulary (V2-1.2 §5.4). Data only: a
// leaf module with no React and no DOM, imported by the shell, the canvas runtime and the
// comment-mount bundle (contract §5.1).
//
// V2-2.10 lands the TYPES and the runtime lists the dgn table's validators need. The state machine
// helpers (`toolKeyAction`, `escStep`, `baseMode`, `initialMode`, `clampMode`,
// `holdsModuleUpdates`) and `MODE_TOOLS` land with the dormant governed path (V2-2.10e, T8).

export const CANVAS_MODES = ['edit', 'viewing', 'preview', 'present'] as const;
export type CanvasModeV2 = (typeof CANVAS_MODES)[number];

export const PRESENT_KINDS = ['artboards', 'canvas'] as const;
export interface PresentSpec {
  kind: (typeof PRESENT_KINDS)[number];
  /** A DCArtboard id, or 'start'. */
  from?: string;
}

/** owner/editor → all true · Can comment (today's `viewer`) → comment only · Can view → none. */
export interface ModeCaps {
  edit: boolean;
  annotate: boolean;
  comment: boolean;
}

/** minRole per tool row (the V2-1.3 condition). */
export type Role = 'view' | 'comment' | 'edit';

/** v1 ids keep their v1 meaning (input-router posture tables, annotations-layer, TOOL_CURSORS);
 *  the v2 ids are new tools only (S2 builds the Edit ones, S3 `inspect` + `pointer`). Never rename
 *  a v1 id (contract §8). */
export const V1_TOOL_IDS = [
  'browse',
  'move',
  'hand',
  'comment',
  'pen',
  'highlighter',
  'eraser',
  'shape',
  'sticky',
  'section',
  'arrow',
  'text',
] as const;
export const V2_TOOL_IDS = [
  'inspect',
  'frame',
  'el-shape',
  'el-pen',
  'el-text',
  'image',
  'component',
  'line',
  'ellipse',
  'polygon',
  'crop',
  'slice',
  'pointer',
] as const;
export const TOOL_IDS = [...V1_TOOL_IDS, ...V2_TOOL_IDS] as const;
export type ToolId = (typeof TOOL_IDS)[number];

const MODE_SET: ReadonlySet<string> = new Set(CANVAS_MODES);
const TOOL_SET: ReadonlySet<string> = new Set(TOOL_IDS);
export const isCanvasMode = (v: unknown): v is CanvasModeV2 =>
  typeof v === 'string' && MODE_SET.has(v);
export const isToolId = (v: unknown): v is ToolId => typeof v === 'string' && TOOL_SET.has(v);

// ─── the governed path's pure helpers (§5.4; landed with V2-4.3b) ─────────────────────────────────
//
// v1 bridge: until the two v2 toolbars land (V2-4.5) the canvas still runs DDR-223's binary
// `preview | edit` posture over the v1 tools. A governed mode maps onto it:
//   edit    → edit / `move`
//   viewing → edit / `move`      a read-only `move` IS v1's "select & inspect" (`inspect` is S3's)
//   preview → preview / `browse`
//   present → preview / `browse`  Present · Canvas: clicks pan (Present · Artboards is S3's)

export const NO_CAPS: Readonly<ModeCaps> = Object.freeze({
  edit: false,
  annotate: false,
  comment: false,
});
export const ALL_CAPS: Readonly<ModeCaps> = Object.freeze({
  edit: true,
  annotate: true,
  comment: true,
});

/** Where esc ends. */
export const baseMode = (caps: ModeCaps): CanvasModeV2 => (caps.edit ? 'edit' : 'viewing');
/** DDR-223's boot posture: editors open in Edit, a view-only link in Preview (04 md-edge-viewer). */
export const initialMode = (caps: ModeCaps): CanvasModeV2 => (caps.edit ? 'edit' : 'preview');

/** Defence in depth behind the shell: a role without edit rights never lands in Edit, and Viewing is
 *  the read-only slot, so an editor asking for it gets Edit. */
export function clampMode(m: CanvasModeV2, caps: ModeCaps): CanvasModeV2 {
  if (m === 'edit' && !caps.edit) return 'viewing';
  if (m === 'viewing' && caps.edit) return 'edit';
  return m;
}

/** The v1 posture a governed mode runs on (see the note above). */
export const V1_POSTURE: Readonly<Record<CanvasModeV2, 'preview' | 'edit'>> = Object.freeze({
  edit: 'edit',
  viewing: 'edit',
  preview: 'preview',
  present: 'preview',
});
/** The resting tool each governed mode arms (v1 ids until V2-4.5). */
export const REST_TOOL: Readonly<Record<CanvasModeV2, ToolId>> = Object.freeze({
  edit: 'move',
  viewing: 'move',
  preview: 'browse',
  present: 'browse',
});

/** The mode that arming `t` implies while governed — null for the mode-neutral annotation tools. */
export function governedModeOfTool(t: string, caps: ModeCaps): CanvasModeV2 | null {
  if (t === 'browse') return 'preview';
  if (t === 'move') return caps.edit ? 'edit' : 'viewing';
  return null;
}

// ─── MODE_TOOLS — the two toolbars as data (§5.5; landed with V2-4.5a) ────────────────────────────
//
// One ordered slot list per mode. The canvas toolbar renders it (`tool-palette.tsx`), V2-1.3 derives
// the `tool.<id>` actions from it, and V2-4.5b binds the keys it names. Slots are toolbar buttons;
// `key` is CONTRACT §2, `label` CONTRACT §3, `minRole` per V2-1.3. Pure data — no React, no DOM.

/** Roles rank view < comment < edit; a slot shows when the role reaches its `minRole`. */
const ROLE_RANK: Readonly<Record<Role, number>> = Object.freeze({ view: 0, comment: 1, edit: 2 });

/** The role a cap set stands for: owner/editor → edit · Can comment → comment · Can view → view. */
export function roleOfCaps(caps: Readonly<ModeCaps>): Role {
  if (caps.edit || caps.annotate) return 'edit';
  return caps.comment ? 'comment' : 'view';
}

/** In-iframe popovers (pure tool options). `sticky-colours` is served by the annotation tray that
 *  already stacks above the toolbar (`AnnotationsChrome` owns the colour state). */
export type SlotPopover = 'shape-kinds' | 'sticky-colours' | 'marker-tips' | 'more';
/** Shell-rendered panels a slot opens (V2-4.5b: `tool-panel-open`). */
export type SlotPanel = 'stickers' | 'components' | 'templates' | 'assets';
/** The work package that builds a tool this task does not: its slot is in the data but not rendered. */
export type PendingPackage = 'S2' | 'S3';
/** Today's "+ Insert" kinds a momentary slot adds at the default size (`insert-request`). */
export type InsertKind = 'div' | 'text' | 'image';

export interface ToolSlot {
  /** CONTRACT §2 key as shown on the tooltip ('' = none, ⌘K finds it). */
  readonly key: string;
  /** CONTRACT §3 word. */
  readonly label: string;
  /** The tool the slot arms; null for a panel-only or a More slot. */
  readonly tool: ToolId | null;
  readonly minRole: Role;
  readonly popover?: SlotPopover;
  readonly panel?: SlotPanel;
  /** Marker: the tools one slot cycles through (C14), first = the default tip. */
  readonly tips?: readonly ToolId[];
  /** A momentary slot backed by today's insert action instead of an armed tool. */
  readonly insert?: InsertKind;
  /** Tools (besides `tool`) that light the slot. */
  readonly lights?: readonly ToolId[];
  /** Built by this work package — not rendered until it lands. */
  readonly pending?: PendingPackage;
  /** `popover: 'more'` — the slots behind the ellipsis. */
  readonly more?: readonly ToolSlot[];
}

export interface ModeToolbar {
  /** The resting tool; contract names it per mode (`REST_TOOL` is the v1 bridge until S3). */
  readonly rest: ToolId;
  /** No toolbar at all (Present). */
  readonly hidden?: boolean;
  readonly slots: readonly ToolSlot[];
}

const slot = (s: ToolSlot): ToolSlot => Object.freeze(s);

export const MODE_TOOLS: Readonly<Record<CanvasModeV2, ModeToolbar>> = Object.freeze({
  edit: Object.freeze({
    rest: 'move' as const,
    slots: Object.freeze([
      slot({ key: 'V', label: 'Select', tool: 'move', minRole: 'edit' }),
      slot({ key: 'H', label: 'Hand', tool: 'hand', minRole: 'edit' }),
      // Frame / Text / Image are backed by today's "+ Insert Div / Text / Image" until S2 builds the
      // tools: a click adds one at its default size, as the insert does.
      slot({ key: 'F', label: 'Frame', tool: 'frame', minRole: 'edit', insert: 'div' }),
      slot({ key: 'R', label: 'Shape', tool: 'el-shape', minRole: 'edit', pending: 'S2' }),
      slot({ key: 'P', label: 'Pen', tool: 'el-pen', minRole: 'edit', pending: 'S2' }),
      slot({ key: 'T', label: 'Text', tool: 'el-text', minRole: 'edit', insert: 'text' }),
      slot({
        key: 'I',
        label: 'Image',
        tool: 'image',
        minRole: 'edit',
        insert: 'image',
        panel: 'assets',
      }),
      slot({
        key: '⇧I',
        label: 'Component',
        tool: 'component',
        minRole: 'edit',
        panel: 'components',
        pending: 'S2',
      }),
      slot({
        key: '',
        label: 'More',
        tool: null,
        minRole: 'edit',
        popover: 'more',
        more: Object.freeze([
          slot({ key: '', label: 'Line', tool: 'line', minRole: 'edit', pending: 'S2' }),
          slot({ key: '', label: 'Ellipse', tool: 'ellipse', minRole: 'edit', pending: 'S2' }),
          slot({ key: '', label: 'Polygon', tool: 'polygon', minRole: 'edit', pending: 'S2' }),
          slot({ key: '', label: 'Crop', tool: 'crop', minRole: 'edit', pending: 'S2' }),
          slot({ key: '', label: 'Export area', tool: 'slice', minRole: 'edit', pending: 'S2' }),
        ]),
      }),
    ]),
  }),
  preview: Object.freeze({
    rest: 'browse' as const,
    slots: Object.freeze([
      // A click uses the design, a drag pans (Q3). v1's `hand` tool lights it too.
      slot({ key: 'H', label: 'Hand', tool: 'browse', minRole: 'view', lights: ['hand'] }),
      slot({
        key: 'N',
        label: 'Sticky',
        tool: 'sticky',
        minRole: 'edit',
        popover: 'sticky-colours',
      }),
      slot({ key: 'C', label: 'Comment', tool: 'comment', minRole: 'comment' }),
      // Marker (C14): tips Marker · Highlighter · Eraser; the last-used tip is the one M arms (Q4).
      slot({
        key: 'M',
        label: 'Marker',
        tool: 'pen',
        minRole: 'edit',
        popover: 'marker-tips',
        tips: ['pen', 'highlighter', 'eraser'],
      }),
      slot({ key: 'A', label: 'Arrow', tool: 'arrow', minRole: 'edit' }),
      slot({ key: 'R', label: 'Shape', tool: 'shape', minRole: 'edit', popover: 'shape-kinds' }),
      slot({ key: 'T', label: 'Text', tool: 'text', minRole: 'edit' }),
      // Stickers arms no tool: the pick follows the pointer (S4); the picker opens from here.
      slot({ key: 'E', label: 'Stickers', tool: null, minRole: 'edit', panel: 'stickers' }),
      slot({ key: 'S', label: 'Section', tool: 'section', minRole: 'edit', panel: 'templates' }),
    ]),
  }),
  viewing: Object.freeze({
    rest: 'inspect' as const,
    slots: Object.freeze([
      // A click shows specs, a drag pans. `inspect` is S3's; until then the slot rides `move`.
      slot({ key: 'H', label: 'Hand', tool: 'inspect', minRole: 'view' }),
      slot({ key: 'C', label: 'Comment', tool: 'comment', minRole: 'comment' }),
    ]),
  }),
  present: Object.freeze({ rest: 'browse' as const, hidden: true, slots: Object.freeze([]) }),
});

/** Until a v2 tool has a descriptor, its slot arms this v1 tool instead (S3 retires the entry). */
export const V1_TOOL_BRIDGE: Readonly<Partial<Record<ToolId, ToolId>>> = Object.freeze({
  inspect: 'move',
});

/** The tools a double-click locks on (sticky lock, T19). Q7: a mode change clears the lock. */
export const STICKY_LOCKABLE: ReadonlySet<ToolId> = new Set<ToolId>([
  'pen',
  'highlighter',
  'eraser',
  'shape',
  'sticky',
  'section',
  'arrow',
  'text',
]);

/** Every slot still waiting for its package (More's children included) — pinned by the tests. */
export function pendingSlots(): Array<{ mode: CanvasModeV2; slot: ToolSlot }> {
  const out: Array<{ mode: CanvasModeV2; slot: ToolSlot }> = [];
  for (const mode of CANVAS_MODES) {
    for (const s of MODE_TOOLS[mode].slots) {
      if (s.pending) out.push({ mode, slot: s });
      for (const c of s.more ?? []) if (c.pending) out.push({ mode, slot: c });
    }
  }
  return out;
}

/** The tool a slot actually arms in this canvas: its own when it has a descriptor, else the v1 bridge. */
export function armTarget(t: ToolId, armable: (t: ToolId) => boolean): ToolId | null {
  if (armable(t)) return t;
  const bridged = V1_TOOL_BRIDGE[t];
  return bridged && armable(bridged) ? bridged : null;
}

/**
 * The slots to render for `mode` at `role`: ordered, role-gated, pending ones dropped, a More slot only
 * while it has a live child. `armable(tool)` says whether a tool exists in this canvas (read-only sessions
 * strip the draw tools; a slot whose tool is absent is not a button).
 */
export function visibleSlots(
  mode: CanvasModeV2,
  role: Role,
  armable: (t: ToolId) => boolean = () => true
): ToolSlot[] {
  const bar = MODE_TOOLS[mode];
  if (bar.hidden || role === 'view') return []; // Can view sees no toolbar (04 md-edge-viewer)
  const live = (s: ToolSlot): boolean => {
    if (s.pending || ROLE_RANK[role] < ROLE_RANK[s.minRole]) return false;
    if (s.more) return s.more.some(live);
    if (s.insert) return true; // backed by today's insert action
    if (s.tool === null) return s.panel !== undefined; // a panel-only slot (Stickers)
    return armTarget(s.tool, armable) !== null;
  };
  return bar.slots.filter(live);
}
