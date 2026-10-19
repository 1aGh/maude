// apps/studio/bridge/canvas-modes.ts — the v2 canvas mode vocabulary (V2-1.2 §5.4). Data only: a
// leaf module with no React and no DOM, imported by the shell, the canvas runtime and the
// comment-mount bundle (contract §5.1).
//
// V2-2.10 lands the TYPES and the runtime lists the dgn table's validators need. The state machine
// helpers (`toolKeyAction`, `escStep`, `baseMode`, `initialMode`, `clampMode`,
// `holdsModuleUpdates`) and `MODE_TOOLS` land with the dormant governed path (V2-2.10e, T8).

import { holdsAiChanges } from './mode-shows.ts';

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
  /** S3.7a — this canvas may publish its Present · Artboards position on awareness (S3-present-session
   *  §3). Absent = false (a v1 shell never sends it). Only keeps honest clients quiet: the relay strip
   *  is what enforces who may broadcast. */
  present?: boolean;
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
//   viewing → edit / `inspect`   S3.11: `inspect` is a tool of its own (outline + size tag, no handles)
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
  viewing: 'inspect',
  preview: 'browse',
  present: 'browse',
});

// The mode arming a tool implies while governed is `homeModeOfTool` (below, V2-4.5b): with two
// toolbars the annotation tools are no longer mode-neutral — they are Preview's.

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

/** In-iframe popovers (pure tool options). `sticky-colours` and `marker-tips` (tip · inks · thicknesses)
 *  hold the person's draw-time choices (annotations/ui/tool-state.ts; the swatch tray is retired, S4.8). */
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
  /**
   * The key and the button open `panel` and arm nothing, yet the slot keeps its tool id as its registry id
   * (S2.15: I shows the Assets tab; `tool.image` stays the action that is bound to it).
   */
  readonly panelFirst?: boolean;
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
      // Frame and Shape are drawn by dragging (S2.13): a frame inside an artboard, an artboard on empty canvas.
      // Image (S2.15): I opens the Assets tab; a tile dropped on a frame, or ↵ on a selected artboard, places it
      // (`image.place`). It arms nothing, and no longer adds one at a default size.
      slot({ key: 'F', label: 'Frame', tool: 'frame', minRole: 'edit' }),
      slot({ key: 'R', label: 'Shape', tool: 'el-shape', minRole: 'edit' }),
      // Pen (S2.14): click for a sharp point, drag for a smooth one; double-click a path to edit its points.
      slot({ key: 'P', label: 'Pen', tool: 'el-pen', minRole: 'edit' }),
      // Click to type (S2.12b): a tool, no longer today's momentary Insert Text.
      slot({ key: 'T', label: 'Text', tool: 'el-text', minRole: 'edit' }),
      slot({
        key: 'I',
        label: 'Image',
        tool: 'image',
        minRole: 'edit',
        panel: 'assets',
        panelFirst: true,
      }),
      // Component arms no tool: the shell's picker (⇧I, S2.16) hands a pick back as `place-component`
      slot({ key: '⇧I', label: 'Component', tool: null, minRole: 'edit', panel: 'components' }),
      slot({
        key: '',
        label: 'More',
        tool: null,
        minRole: 'edit',
        popover: 'more',
        more: Object.freeze([
          slot({ key: '', label: 'Line', tool: 'line', minRole: 'edit' }),
          slot({ key: '', label: 'Ellipse', tool: 'ellipse', minRole: 'edit' }),
          slot({ key: '', label: 'Polygon', tool: 'polygon', minRole: 'edit' }),
          // Crop (S2.15): arm it, then click a picture (or select one first) — crop mode, ↵ done · esc cancel
          slot({ key: '', label: 'Crop', tool: 'crop', minRole: 'edit' }),
          // Export area (S2.13): drag a rectangle, the Export sheet opens with it. Writes nothing to the file.
          slot({ key: '', label: 'Export area', tool: 'slice', minRole: 'edit' }),
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
      // A click shows specs, a drag pans (S3.11: the `inspect` tool).
      slot({ key: 'H', label: 'Hand', tool: 'inspect', minRole: 'view' }),
      slot({ key: 'C', label: 'Comment', tool: 'comment', minRole: 'comment' }),
    ]),
  }),
  // Present has no toolbar; its one tool is the Pointer (L), data here so the key table knows it.
  // S3.2b builds the dot (present/pointer-dot.tsx): the canvas owns the key while presenting, the
  // registry derives `tool.pointer` from this slot. Any role may point (`minRole: 'view'`).
  present: Object.freeze({
    rest: 'browse' as const,
    hidden: true,
    slots: Object.freeze([slot({ key: 'L', label: 'Pointer', tool: 'pointer', minRole: 'view' })]),
  }),
});

/** Until a v2 tool has a descriptor, its slot arms this v1 tool instead. S3.11 retired `inspect → move`
 *  (it is a tool of its own now); the map stays for the next v2 slot that needs a bridge (none today). */
export const V1_TOOL_BRIDGE: Readonly<Partial<Record<ToolId, ToolId>>> = Object.freeze({});

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
    if (s.tool === null || s.panelFirst) return s.panel !== undefined; // a panel-only slot (Stickers, Image)
    return armTarget(s.tool, armable) !== null;
  };
  return bar.slots.filter(live);
}

// ─── keys, the tool's home mode and the esc ladder (§5.4; landed with V2-4.5b) ────────────────────
//
// A key means what its slot does in the mode you are in. A key that is not in this mode's toolbar
// but is in the other one crosses (Edit → Preview: N C M A E S; Preview → Edit: V F P I ⇧I; H R T
// stay where they are): the canvas asks the shell (`mode-request`), never moves the mode itself (M3).
// A role that may not use the slot gets the shell's denial line (Q2): the canvas asks anyway and the
// shell, which owns the role, refuses. A pending slot has no key (rule 13: no key before its tool).

/** The modes a key is looked up in, after the current one. Viewing borrows Preview's, then Edit's
 *  keys, so a viewing role's N or V reaches the denial line instead of doing nothing. */
const KEY_FALLBACK: Readonly<Record<CanvasModeV2, readonly CanvasModeV2[]>> = Object.freeze({
  edit: ['preview'],
  preview: ['edit'],
  viewing: ['preview', 'edit'],
  present: [],
});

/**
 * Where a key lands from `mode`: the first toolbar (this mode's, then KEY_FALLBACK's) with a slot
 * for it; null = not a tool key there. A pending slot still OWNS its key (Edit's R is the design
 * Shape before S2 builds it — R never falls through to Preview's Shape); `toolKeyAction` answers null.
 */
export function keySlot(
  mode: CanvasModeV2,
  key: string
): { mode: CanvasModeV2; slot: ToolSlot } | null {
  for (const m of [mode, ...KEY_FALLBACK[mode]]) {
    const s = MODE_TOOLS[m].slots.find((x) => x.key === key);
    if (s) return { mode: m, slot: s };
  }
  return null;
}

export type ToolKeyAction =
  /** Same mode: arm the tool here (a v2 id — the caller passes it through `armTarget`). */
  | { kind: 'arm'; tool: ToolId }
  /** Same mode, a momentary slot: add one at the default size (today's insert). */
  | { kind: 'insert'; insert: InsertKind }
  /** Same mode, a panel-only slot (Stickers): the shell opens the panel (`tool-panel-open`). */
  | { kind: 'panel'; panel: SlotPanel }
  /** Another mode's key: ask the shell to switch, then arm `tool` / open `panel` there. */
  | { kind: 'request'; mode: CanvasModeV2; tool?: ToolId; panel?: SlotPanel }
  /** The role may not: ask anyway — the shell owns the role and shows the one denial line (a
   *  panel-only slot asks for its panel, which the shell refuses the same way). */
  | { kind: 'deny'; mode: CanvasModeV2; tool?: ToolId; panel?: SlotPanel };

/**
 * What pressing `key` (a canonical chord: 'N', '⇧I') does in `mode` for `caps` (T8). Pure: the
 * caller (input-router) arms, posts the request, opens the panel or runs the insert. `markerTip` is
 * the session's last Marker tip (toolbars/marker-tip.ts, Q4).
 */
export function toolKeyAction(
  mode: CanvasModeV2,
  key: string,
  caps: Readonly<ModeCaps>,
  markerTip?: ToolId
): ToolKeyAction | null {
  const hit = keySlot(mode, key);
  if (!hit || hit.slot.pending) return null;
  const { slot } = hit;
  // A momentary slot arms nothing (S2 makes Frame / Text / Image tools); the Marker arms its tip.
  const panelOnly = !!slot.panel && (slot.tool === null || !!slot.panelFirst);
  const tool =
    slot.insert || slot.panelFirst
      ? null
      : slot.tips && markerTip && slot.tips.includes(markerTip)
        ? markerTip
        : slot.tool;
  const role = roleOfCaps(caps);
  if (ROLE_RANK[role] < ROLE_RANK[slot.minRole] || (hit.mode === 'edit' && !caps.edit)) {
    if (tool) return { kind: 'deny', mode: hit.mode, tool };
    return panelOnly && slot.panel
      ? { kind: 'deny', mode: hit.mode, panel: slot.panel }
      : { kind: 'deny', mode: hit.mode };
  }
  if (hit.mode !== mode) {
    const out: { kind: 'request'; mode: CanvasModeV2; tool?: ToolId; panel?: SlotPanel } = {
      kind: 'request',
      mode: hit.mode,
    };
    if (tool) out.tool = tool;
    if (panelOnly && slot.panel) out.panel = slot.panel;
    return out;
  }
  if (slot.insert) return { kind: 'insert', insert: slot.insert };
  if (tool) return { kind: 'arm', tool };
  return slot.panel ? { kind: 'panel', panel: slot.panel } : null;
}

/** Every key `mode` answers, its own and the crossing ones, pending slots left out — the registry
 *  binds exactly these (actions/defs/tool.ts). */
export function modeKeys(mode: CanvasModeV2): string[] {
  const keys: string[] = [];
  for (const m of [mode, ...KEY_FALLBACK[mode]])
    for (const s of MODE_TOOLS[m].slots) {
      if (!s.key || keys.includes(s.key)) continue;
      const hit = keySlot(mode, s.key);
      if (hit?.slot === s && !s.pending) keys.push(s.key);
    }
  return keys;
}

/**
 * May `caps` use `tool` in `mode`'s toolbar (M4, the shell's half of the denial line)? A tool the
 * toolbar has no slot for is not this check's to refuse (a mode's rest, Hand) — `clampMode` and the
 * server still are.
 */
export function slotAllows(mode: CanvasModeV2, tool: string, caps: Readonly<ModeCaps>): boolean {
  if (!isToolId(tool)) return false;
  const s = MODE_TOOLS[mode].slots.find(
    (x) => x.tool === tool || !!x.tips?.includes(tool) || !!x.more?.some((c) => c.tool === tool)
  );
  return !s || ROLE_RANK[roleOfCaps(caps)] >= ROLE_RANK[s.minRole];
}

/** Hand pans in every toolbar (Preview's Hand slot lights it): it belongs to no one mode. */
const MODE_NEUTRAL: ReadonlySet<ToolId> = new Set<ToolId>(['hand']);

function barHas(mode: CanvasModeV2, t: ToolId): boolean {
  return MODE_TOOLS[mode].slots.some(
    (s) =>
      s.tool === t ||
      (s.tool !== null && V1_TOOL_BRIDGE[s.tool] === t) ||
      !!s.tips?.includes(t) ||
      !!s.lights?.includes(t) ||
      !!s.more?.some((c) => c.tool === t)
  );
}

/**
 * The mode arming `t` belongs to while governed, seen from `current` (§5.4 "setTool(t) with t in
 * another mode"): `current` when its toolbar has the tool, else the toolbar that does — `move` is
 * Edit's for an editor and Viewing's otherwise, then Preview (an editor's annotation tools), then
 * Edit. null = mode-neutral (Hand), or no toolbar has it.
 */
export function homeModeOfTool(
  t: string,
  caps: Readonly<ModeCaps>,
  current: CanvasModeV2
): CanvasModeV2 | null {
  if (!isToolId(t) || MODE_NEUTRAL.has(t)) return null;
  if (barHas(current, t)) return current;
  if (t === 'move') return caps.edit ? 'edit' : 'viewing';
  for (const m of ['preview', 'edit'] as const) if (barHas(m, t)) return m;
  return null;
}

// ─── the A8 hold (§5.4; S3.1) ─────────────────────────────────────────────────────────────────────
//
// AI changes show live in Edit, Preview (under the pointer too), Present · Canvas and Viewing. In
// Present · Artboards a canvas write is held until the presenter moves on (`present-position`
// changes) or leaves Present, so the audience never sees an artboard change under them.
// `_shell.html`'s HMR applier carries an inline copy (it imports nothing); a parity test pins it.

/** Is a canvas write held right now? */
export function holdsModuleUpdates(
  snap: { mode: CanvasModeV2 | null; present: PresentSpec | null } | null | undefined
): boolean {
  return !!snap && !!snap.mode && holdsAiChanges(snap.mode, snap.present);
}

/** A well-formed Present spec (the shell's own, or one a `mode-request` asked for): `artboards`
 *  keeps its `from` (an id or 'start'); anything else is Present · Canvas. */
export function presentSpec(raw: unknown): PresentSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { kind?: unknown; from?: unknown };
  if (r.kind !== 'artboards') return { kind: 'canvas' };
  return typeof r.from === 'string' && r.from && r.from.length <= 200
    ? { kind: 'artboards', from: r.from }
    : { kind: 'artboards', from: 'start' };
}

/** One esc press, after the canvas's own handler dropped the stroke, the menu and the selection. */
export type EscStep =
  /** An armed tool: back to the mode's resting tool. */
  | 'rest'
  /** At rest in Edit or Viewing: nothing more ("there's no Edit to return to"). */
  | 'stay'
  /** `mode-request {mode:'back', cause:'esc'}`: Preview at rest → `baseMode`; Present → `returnTo`. */
  | 'back';

/** 04 md-esc, one step per press: tool → resting tool → the previous mode. */
export function escStep(mode: CanvasModeV2, tool: string): EscStep {
  if (mode === 'present') return 'back';
  const rest = MODE_TOOLS[mode].rest;
  if (tool !== rest && V1_TOOL_BRIDGE[rest] !== tool) return 'rest';
  return mode === 'preview' ? 'back' : 'stay';
}
