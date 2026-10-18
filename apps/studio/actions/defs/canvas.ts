// actions/defs/canvas.ts — canvas lifecycle (V2-2.4: v1 bindings under their v2 ids).

import type { ActionDef } from '../types.ts';
import { kb } from './_v1.ts';

export const CANVAS_ACTIONS: ActionDef[] = [
  {
    id: 'canvas.new',
    label: 'New canvas',
    kind: 'command',
    icon: 'plus',
    exec: 'shell',
    // V2-4 gate (roles): a canvas is created IN this project — Can comment / Can view have no New
    // canvas (V2-1.7 §5.9: `can('edit', null)` is false). Absent, not greyed; the native ⌘N still
    // reaches the shell as `menu://action`, which says the one denial line (role-gate.js).
    visible: { minRole: 'edit' },
    // The v2 key is ⌘N: the desktop File ▸ New Canvas accelerator (C3, V2-3.4 — AppKit owns it, the
    // menu sends `menu://action`). v1's bare N (the browser never delivers ⌘N) died with V2-4.5b,
    // which bound N to Sticky (rule 13; help.ts MOVED_KEYS).
    keys: [kb('⌘N', 'global', { inText: true, when: { shell: ['desktop'] } })],
    legacy: { palette: 'New canvas…', menu: 'New canvas…', sheet: 'New brief board' },
  },
  {
    id: 'canvas.reload',
    label: 'Reload canvas',
    kind: 'command',
    icon: 'reload',
    exec: 'shell',
    fromCanvas: true,
    keys: [kb('⌘R', 'global', { inText: true })],
    legacy: { palette: 'Reload active canvas', menu: 'Reload canvas', sheet: 'Reload canvas' },
  },
  // ── no key in v1: ⌘K / menu entries ──
  {
    id: 'canvas.new-video',
    label: 'New video',
    kind: 'command',
    icon: 'plus',
    exec: 'shell',
    visible: { minRole: 'edit' }, // V2-4 gate (roles): creates a canvas, like New canvas
    legacy: { palette: 'New video…' },
  },
  {
    id: 'canvas.close',
    label: 'Close canvas',
    kind: 'command',
    exec: 'shell',
    legacy: { menu: 'Close canvas' },
  },
  // V2-4.2 — the File menu's canvas rows (CONTRACT §1). Each wraps what the Files tree's row menu
  // already does for a canvas (tree/tree.jsx: Duplicate, Rename…, Move to…); the menu runs it on
  // the OPEN canvas. A viewer cannot write, and with no canvas open there is nothing to act on.
  {
    id: 'canvas.duplicate',
    label: 'Duplicate canvas',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    enabled: { facts: ['canvasOpen'] },
  },
  {
    id: 'canvas.rename',
    label: 'Rename canvas',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    enabled: { facts: ['canvasOpen'] },
  },
  {
    id: 'canvas.move',
    label: 'Move to…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    enabled: { facts: ['canvasOpen'] },
  },
  // S1.2 (11 · pn-trash) — the Canvases panel's row menu, on the OPEN canvas from ⌘K. "Rename" is in place
  // now (`canvas.rename` above turns the row's name into a field; the window.prompt is gone). Copy link is
  // for anyone who can open the canvas; Move to trash is an editor's (only an owner clears the Trash out).
  {
    id: 'canvas.copy-link',
    label: 'Copy canvas link',
    kind: 'command',
    exec: 'shell',
    enabled: { facts: ['canvasOpen'] },
  },
  {
    id: 'canvas.trash',
    label: 'Move canvas to trash',
    kind: 'command',
    icon: 'trash',
    exec: 'shell',
    visible: { minRole: 'edit' },
    enabled: { facts: ['canvasOpen'] },
  },
  // Today's panels: the Figma import dialog and the brand upload panel.
  {
    id: 'import.figma',
    label: 'Import from Figma…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
  },
  {
    id: 'import.brand',
    label: 'Import a brand…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
  },
  {
    id: 'video.assemble',
    label: 'Assemble clips into a video',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' }, // V2-4 gate (roles): writes a new video canvas
    legacy: { menu: 'Assemble dropped clips → video' },
  },
  ...(
    [
      ['desktop', 'Desktop'],
      ['laptop', 'Laptop'],
      ['tablet', 'Tablet'],
      ['mobile', 'Mobile'],
      ['a4', 'A4 (print)'],
      ['letter', 'Letter (print)'],
    ] as const
  ).map(
    ([size, name]): ActionDef => ({
      id: `artboard.new-${size}`,
      label: `New artboard: ${name.replace(' (print)', '')}`,
      kind: 'command',
      exec: 'shell',
      visible: { minRole: 'edit' }, // V2-4 gate (roles): inserts into the open canvas
      legacy: { menu: `New artboard: ${name}` },
    })
  ),
];
