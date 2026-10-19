// actions/defs/search.ts — ⌘K and the canvases panel's search / refresh (V2-2.4: v1 bindings).

import type { ActionDef } from '../types.ts';
import { kb, mods, SHELL_FOCI, SHELL_NOT_TYPING } from './_v1.ts';

export const SEARCH_ACTIONS: ActionDef[] = [
  {
    id: 'search.open',
    label: 'Search',
    kind: 'command',
    icon: 'search',
    exec: 'shell',
    fromCanvas: true,
    keys: [
      // v1: ⌘K toggles the palette everywhere, even in a text field; the canvas forwards it
      // (inspect.ts). v1's shell matched `e.key === 'k' || 'K'`, so ⇧⌘K toggles too — but only
      // there: the canvas forwarder required !shift.
      // S6.4: not on Home — there ⌘K is `home.search` (cross-project, Home's own page), same chord, its own shell.
      kb('⌘K', 'global', { inText: true, when: { notShell: ['home'] } }),
      kb('⇧⌘K', 'global', {
        inText: true,
        alias: true,
        when: { focus: SHELL_FOCI, notShell: ['home'] },
      }),
    ],
    help: { group: 'finding', order: 10 },
    legacy: { sheet: 'Command palette' },
  },
  {
    id: 'canvases.search',
    label: 'Search canvases',
    kind: 'command',
    exec: 'shell',
    keys: [
      // v1 `e.key === '/'` (⌘/ produced '/' too — that alias died with V2-4.5b: ⌘/ is Ask AI,
      // CONTRACT §2). Fires with the canvas iframe active in v1 (before its inCanvasIframe bail), but
      // that state never receives a key (see SHELL_FOCI).
      kb('/', 'global', { inText: false, when: SHELL_NOT_TYPING }),
    ],
    legacy: { sheet: 'Search files' },
  },
  {
    id: 'canvases.find',
    label: 'Find a canvas',
    kind: 'command',
    exec: 'shell',
    // v1 ⌘F: open the Files panel if closed, then focus its search field.
    keys: mods('⌘F', '⇧', 'global', { inText: false, when: SHELL_NOT_TYPING }),
    legacy: { sheet: 'Search files' },
  },
  // S1.2 (11 · pn-organise) — the Canvases panel's pin and sort, from ⌘K. Pins are per person (the hover
  // pin, `/_api/pins`), so a viewer pins too; Sort is a per-project view preference.
  {
    id: 'canvases.pin',
    label: 'Pin canvas',
    kind: 'command',
    exec: 'shell',
    enabled: { facts: ['canvasOpen'] },
  },
  {
    id: 'canvases.unpin',
    label: 'Unpin canvas',
    kind: 'command',
    exec: 'shell',
    enabled: { facts: ['canvasOpen'] },
  },
  {
    id: 'canvases.sort',
    label: 'Sort canvases',
    kind: 'command',
    exec: 'shell',
  },
  {
    id: 'canvases.refresh',
    label: 'Refresh canvases',
    kind: 'command',
    exec: 'shell',
    // v1 ⇧⌘R (re-read the index): shell only — the canvas never forwarded it.
    keys: [kb('⇧⌘R', 'global', { inText: true, when: { focus: SHELL_FOCI } })],
  },
];
