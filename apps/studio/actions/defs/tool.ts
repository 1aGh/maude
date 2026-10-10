// actions/defs/tool.ts — canvas tools (V2-2.4: v1's input-router letters under their v2 ids).
//
// v1 `classify()`: a bare letter (no ⌘ ⌃ ⌥) outside a text field; it lower-cases `e.key`, so ⇧
// is ignored for every letter except S (bare S belongs to the shell's design-system view, ⇧S arms
// Section). A read-only canvas still swallows the letter — `setTool` refuses the tool.
// Phase 4 derives `tool.*` from `bridge/canvas-modes.ts` (V2-1.2) and flips the moved letters
// (B → P, I → Image, E → Stickers, ⇧S → S) under rule 13.

import type { ActionDef, KeyBinding } from '../types.ts';
import { IN_CANVAS, kb, mods } from './_v1.ts';

const letter = (key: string): KeyBinding[] => mods(key, '⇧', 'tools', { when: IN_CANVAS });

const tool = (id: string, label: string, keys: KeyBinding[], menu?: string): ActionDef => ({
  id,
  label,
  kind: 'tool',
  exec: 'canvas',
  keys,
  ...(menu ? { legacy: { menu } } : {}),
});

export const TOOL_ACTIONS: ActionDef[] = [
  tool('tool.select', 'Select', letter('V'), 'Select'),
  tool('tool.hand', 'Hand', letter('H'), 'Hand'),
  {
    // canvas-lib's viewport controller: hold Space to pan (outside a text field, any modifier).
    id: 'tool.hand-hold',
    label: 'Hand (hold Space)',
    kind: 'tool',
    exec: 'canvas',
    keys: mods('Space', '⌥⇧⌘', 'tools', { hold: true, when: IN_CANVAS }),
  },
  tool('tool.comment', 'Comment', letter('C'), 'Comment'),
  tool('tool.pen', 'Pen', letter('B'), 'Pen'),
  tool('tool.highlighter', 'Highlighter', letter('I')),
  tool('tool.shape', 'Shape', [...letter('R'), ...letter('O').map((b) => ({ ...b, alias: true }))]),
  tool('tool.arrow', 'Arrow', letter('A'), 'Arrow'),
  tool('tool.sticky', 'Sticky', letter('N'), 'Sticky'),
  tool('tool.text', 'Text', letter('T'), 'Text'),
  tool('tool.section', 'Section', [kb('⇧S', 'tools', { when: IN_CANVAS })]),
  tool('tool.eraser', 'Eraser', letter('E'), 'Eraser'),
  // No letter: Browse is the Preview mode's resting tool (DDR-187 / DDR-223).
  tool('tool.browse', 'Browse', [], 'Browse (interact)'),
  // Tools ▸ Rect / Ellipse: dead in v1 — `setTool` knows only `shape` (V2-1.3 defect 5).
  tool('tool.rect', 'Rectangle', [], 'Rect'),
  tool('tool.ellipse', 'Ellipse', [], 'Ellipse'),
];
