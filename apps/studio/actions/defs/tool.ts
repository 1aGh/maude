// actions/defs/tool.ts — canvas tools, derived from the two toolbars (V2-4.5b; V2-1.2 §5.4–5.5,
// V2-1.3 §8: "the tool layer derives `tool.<id>` actions from MODE_TOOLS").
//
// One action per toolbar slot (`tool.<tool id>`; v1's ids keep their meaning — Select is
// `tool.select`, the Marker is `tool.pen`), bound to the slot's CONTRACT §2 key in every mode that
// key reaches it from (`modeKeys`): its own mode, and the other mode's crossing (Edit's N C M A E S
// switch to Preview, Preview's V F P I ⇧I to Edit, Viewing's annotation keys reach the denial line).
// The binding says WHICH action; `toolKeyAction` (bridge/canvas-modes.ts) says what it does there.
//
// Rule 13 — the v1 letters died in the commit that bound these: B (Pen → M), I (Highlighter → the
// Marker's tip; I is Image), E (Eraser → the Marker's tip; E is Stickers), O (Ellipse → Edit › More),
// ⇧S (Section → S) and the ⇧-letter aliases v1's lower-casing matched. Listed in help.ts MOVED_KEYS.
// A pending slot (S2's Shape · Pen · Component, More) has no key until its tool lands.

import {
  type CanvasModeV2,
  keySlot,
  MODE_TOOLS,
  modeKeys,
  type ToolSlot,
} from '../../bridge/canvas-modes.ts';
import { k } from '../keys.ts';
import type { ActionDef, ActionId, Focus, HelpGroup, KeyBinding, Mode } from '../types.ts';
import { IN_CANVAS, mods } from './_v1.ts';

/** A slot's action id: v1's ids for v1's tools, `tool.<id>` for the rest, `tool.<panel>` for a
 *  panel-only slot (Stickers). */
export function slotActionId(s: ToolSlot): ActionId {
  if (s.tool === 'move') return 'tool.select';
  return `tool.${s.tool ?? s.panel ?? s.label.toLowerCase()}`;
}

/** The label each slot action keeps on every surface (CONTRACT §3; v1's where an id existed). */
const LABEL: Readonly<Record<ActionId, string>> = {
  'tool.browse': 'Browse',
  'tool.inspect': 'Inspect',
  'tool.pen': 'Marker',
};
const MENU: Readonly<Record<ActionId, string>> = {
  'tool.select': 'Select',
  'tool.hand': 'Hand',
  'tool.comment': 'Comment',
  'tool.pen': 'Pen',
  'tool.arrow': 'Arrow',
  'tool.sticky': 'Sticky',
  'tool.text': 'Text',
  'tool.browse': 'Browse (interact)',
};
const HELP_GROUP: Readonly<Partial<Record<CanvasModeV2, HelpGroup>>> = {
  edit: 'edit-tools',
  preview: 'preview-tools',
};

/** Shell or canvas focus, never a text field or the timeline (C26: the timeline layer owns its
 *  letters there). The shell half runs once its key handlers post `set-mode` (V2-1.3 §5.6). */
const TOOL_FOCUS: Focus[] = ['canvas', 'chrome'];
/** A slot's home is the first of these that has it (Comment is Preview's; Viewing borrows it). */
const KEY_MODES: readonly CanvasModeV2[] = ['edit', 'preview', 'viewing', 'present'];

function deriveSlotActions(): ActionDef[] {
  const byId = new Map<
    ActionId,
    { slot: ToolSlot; home: CanvasModeV2; order: number; keys: Map<string, Mode[]> }
  >();
  let order = 0;
  for (const mode of KEY_MODES)
    for (const s of MODE_TOOLS[mode].slots) {
      if (s.pending || s.more || !s.key) continue;
      const id = slotActionId(s);
      if (!byId.has(id)) byId.set(id, { slot: s, home: mode, order: order++, keys: new Map() });
    }
  for (const mode of KEY_MODES)
    for (const key of modeKeys(mode)) {
      const hit = keySlot(mode, key);
      if (!hit) continue;
      const entry = byId.get(slotActionId(hit.slot));
      if (!entry) continue;
      const modes = entry.keys.get(key) ?? [];
      modes.push(mode);
      entry.keys.set(key, modes);
    }
  return [...byId.entries()].map(([id, e]) => {
    const keys: KeyBinding[] = [...e.keys.entries()].map(([key, modes]) => ({
      chord: k(key),
      layer: 'tools',
      when: { focus: TOOL_FOCUS, mode: modes },
    }));
    const group = HELP_GROUP[e.home];
    return {
      id,
      label: LABEL[id] ?? e.slot.label,
      kind: 'tool',
      exec: 'canvas',
      keys,
      ...(group ? { help: { group, order: e.order } } : {}),
      ...(MENU[id] ? { legacy: { menu: MENU[id] } } : {}),
    } satisfies ActionDef;
  });
}

const keyless = (id: string, label: string, menu?: string): ActionDef => ({
  id,
  label,
  kind: 'tool',
  exec: 'canvas',
  keys: [],
  ...(menu ? { legacy: { menu } } : {}),
});

export const TOOL_ACTIONS: ActionDef[] = [
  ...deriveSlotActions(),
  {
    // canvas-lib's viewport controller: hold Space to pan (outside a text field, any modifier).
    id: 'tool.hand-hold',
    label: 'Hand (hold Space)',
    kind: 'tool',
    exec: 'canvas',
    keys: mods('Space', '⌥⇧⌘', 'tools', { hold: true, when: IN_CANVAS }),
  },
  // The Marker's tips (C14): the Marker slot (M) arms the last one used; no key of their own.
  keyless('tool.highlighter', 'Highlighter'),
  keyless('tool.eraser', 'Eraser', 'Eraser'),
  // Preview's Shape kinds are a popover; `tool.section` is the Section slot (S). Tools ▸ Rect /
  // Ellipse: dead in v1 — `setTool` knows only `shape` (V2-1.3 defect 5).
  keyless('tool.rect', 'Rectangle', 'Rect'),
  keyless('tool.ellipse', 'Ellipse', 'Ellipse'),
];
