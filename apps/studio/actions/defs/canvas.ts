// actions/defs/canvas.ts — canvas lifecycle (V2-2.4: v1 bindings under their v2 ids).

import type { ActionDef } from '../types.ts';
import { kb, SHELL_NOT_TYPING } from './_v1.ts';

export const CANVAS_ACTIONS: ActionDef[] = [
  {
    id: 'canvas.new',
    label: 'New canvas',
    kind: 'command',
    icon: 'plus',
    exec: 'shell',
    // v1: bare N opens the new-brief-board composer (the browser never delivers ⌘N). The v2 key
    // is ⌘N (native menu, C3) — Phase 4 moves it under rule 13.
    keys: [kb('N', 'global', { inText: false, when: SHELL_NOT_TYPING })],
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
    legacy: { palette: 'New video…' },
  },
  {
    id: 'canvas.close',
    label: 'Close canvas',
    kind: 'command',
    exec: 'shell',
    legacy: { menu: 'Close canvas' },
  },
  {
    id: 'video.assemble',
    label: 'Assemble clips into a video',
    kind: 'command',
    exec: 'shell',
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
      legacy: { menu: `New artboard: ${name}` },
    })
  ),
];
