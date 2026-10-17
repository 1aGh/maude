// actions/defs/view.ts — panels, view toggles and zoom (V2-2.4: v1 bindings under their v2 ids).

import type { ActionDef } from '../types.ts';
import { IN_CANVAS, IN_CANVAS_ANY, kb } from './_v1.ts';

export const VIEW_ACTIONS: ActionDef[] = [
  {
    // V2-4.5b (CONTRACT §2 [A7], V2-1.2 §9 Q1): ⌥⌘P switches to Preview; in Preview it toggles back
    // to Edit (Viewing for a viewing role). The shell owns the mode: in the canvas the key is a
    // `mode-request` (input-router), in the shell its handler selects the mode (canvas-mode.js
    // `previewToggleTarget`). Not in Present (esc leaves Present).
    id: 'mode.preview',
    label: 'Preview',
    kind: 'toggle',
    icon: 'eye',
    exec: 'canvas',
    keys: [kb('⌥⌘P', 'global', { inText: true, when: { mode: ['edit', 'preview', 'viewing'] } })],
    search: { keywords: ['mode', 'live', 'interact', 'edit'] },
  },
  {
    id: 'view.panels',
    label: 'Hide panels',
    kind: 'toggle',
    exec: 'shell',
    // V2-4.1 (CONTRACT §2 "keys that moved", D17): ⌘\ hides / shows ALL panels. Bare T used to toggle
    // the Files panel; it is unbound now and V2-4.5 binds it to Text (D4).
    keys: [kb('⌘\\', 'global', { inText: true })],
    // A designer lives in the canvas: ⌘\ must work with the canvas focused, so the canvas forwards it.
    fromCanvas: true,
    legacy: { menu: 'Hide panels', sheet: 'Hide / show panels' },
  },
  {
    id: 'view.pin-panels',
    label: 'Pin panels to the side',
    kind: 'toggle',
    exec: 'shell',
    // View › Advanced (CONTRACT §1): panels sit flush at the sides instead of floating over the canvas.
    // A per-Mac pref (prefs.json `pin.on`); no key.
    legacy: { menu: 'Pin panels to the side' },
  },
  {
    id: 'view.hidden-files',
    label: 'Hidden files',
    kind: 'toggle',
    exec: 'shell',
    // v1's bare H died with V2-4.5b (H is Hand in every toolbar, rule 13): the Canvases › Advanced
    // switch and View › Advanced, no key.
    legacy: { menu: 'Show hidden files', sheet: 'Hidden files' },
  },
  {
    id: 'view.design-system',
    label: 'Design system',
    kind: 'toggle',
    icon: 'sliders',
    exec: 'shell',
    // v1's bare S died with V2-4.5b (S is Section, rule 13): the pinned Design system row and ⌘K.
    legacy: { palette: 'Open design system view', sheet: 'Design system view' },
  },
  {
    id: 'view.assets',
    label: 'Assets',
    kind: 'toggle',
    icon: 'image',
    exec: 'shell',
    // V2-4.4a (CONTRACT §7): Assets is the left panel's third tab; Menu › View › Assets and ⌘K open it.
    // No key.
  },
  {
    id: 'view.layers-panel',
    label: 'Layers as a panel',
    kind: 'toggle',
    exec: 'shell',
    // V2-4.4a (CONTRACT §1, View › Advanced): on (the default) Layers is the left panel's second tab;
    // off, Layers lives in the Inspector. The same switch as Settings › Layout. No key.
  },
  {
    id: 'view.trash',
    label: 'Trash',
    kind: 'command',
    icon: 'trash',
    exec: 'shell',
    // Restoring is an edit; the viewer shells draw no Trash row (V2-4 gate probe).
    visible: { minRole: 'edit' },
    // V2-4.4a (CONTRACT §1, C10): the Canvases panel's last row, and ⌘K "Trash". Not in the menu.
    // Clearing it out is owner-only [A6].
  },
  {
    id: 'view.comments',
    label: 'Comments',
    kind: 'toggle',
    icon: 'resolve',
    exec: 'shell',
    fromCanvas: true,
    keys: [kb('⇧⌘M', 'global', { inText: true })],
    legacy: {
      palette: 'Toggle comments panel',
      menu: 'Comments Sidebar',
      sheet: 'Comments sidebar',
    },
  },
  {
    id: 'view.exports',
    label: 'Exports',
    kind: 'toggle',
    icon: 'export',
    exec: 'shell',
    // V2-4.3a (CONTRACT §1, C9): the Exports list — also the Share cluster's Exports icon once any export
    // exists, and ⌘K "Exports". No key; shell-side (the export center is the shell's).
  },
  {
    id: 'history.open',
    label: 'Version history',
    kind: 'toggle',
    exec: 'shell',
    fromCanvas: true,
    // CONTRACT §1–§2: ⌥⌘H. v1's ⇧⌘G (the Changes panel) died with the V2-4 gate (rule 13 — ⇧⌘G is
    // Remove frame in Edit and Ungroup annotations in Preview); its row is in help.ts MOVED_KEYS.
    keys: [kb('⌥⌘H', 'global', { inText: true })],
    legacy: { menu: 'Changes' },
  },
  {
    id: 'view.inspector',
    label: 'Inspector',
    kind: 'toggle',
    icon: 'sliders',
    exec: 'shell',
    fromCanvas: true,
    keys: [kb('⇧⌘I', 'global', { inText: true })],
    legacy: { palette: 'Open inspector', menu: 'Inspector', sheet: 'Inspector' },
  },
  {
    id: 'view.timeline-keep-open',
    label: 'Keep timeline open',
    kind: 'toggle',
    exec: 'shell',
    fromCanvas: true,
    keys: [kb('⇧⌘T', 'global', { inText: true })],
    legacy: { menu: 'Timeline' },
  },
  {
    id: 'view.annotations',
    label: 'Annotations',
    kind: 'toggle',
    exec: 'canvas',
    // v1: annotations-layer, canvas focus only (V2-1.3 defect 4: advertised everywhere).
    keys: [kb('⇧P', 'global', { inText: false, when: IN_CANVAS })],
    legacy: { menu: 'Annotations', sheet: 'Annotations' },
  },
  // ── no key in v1: View menu toggles ──
  {
    id: 'view.layers',
    label: 'Layers',
    kind: 'toggle',
    exec: 'shell',
    legacy: { menu: 'Layers' },
  },
  {
    id: 'view.inspector-on-select',
    label: 'Open inspector on select',
    kind: 'toggle',
    exec: 'shell',
    legacy: { menu: 'Auto-open Inspector on select' },
  },
  {
    id: 'view.minimap',
    label: 'Minimap',
    kind: 'toggle',
    exec: 'shell',
    legacy: { menu: 'Minimap' },
  },
  {
    id: 'view.zoom-controls',
    label: 'Zoom controls',
    kind: 'toggle',
    exec: 'shell',
    legacy: { menu: 'Zoom controls' },
  },
  {
    id: 'view.print-guides',
    label: 'Print guides',
    kind: 'toggle',
    exec: 'shell',
    legacy: { menu: 'Show print guides' },
  },
  {
    id: 'present.canvas',
    label: 'Present the canvas',
    kind: 'toggle',
    exec: 'shell',
    legacy: { menu: 'Presentation Mode' },
  },
  {
    id: 'settings.theme',
    label: 'Theme',
    kind: 'toggle',
    icon: 'sun',
    exec: 'shell',
    legacy: { palette: 'Toggle light / dark theme' },
  },
  // canvas-lib's viewport controller — ⌘ zoom keys fire in a text field too (v1 never checked).
  {
    id: 'view.zoom-in',
    label: 'Zoom in',
    kind: 'command',
    exec: 'canvas',
    keys: [
      kb('⌘=', 'global', { inText: true, when: IN_CANVAS_ANY }),
      kb('⌘+', 'global', { inText: true, alias: true, when: IN_CANVAS_ANY }),
    ],
    legacy: { menu: 'Zoom In', sheet: 'Zoom in / out' },
  },
  {
    id: 'view.zoom-out',
    label: 'Zoom out',
    kind: 'command',
    exec: 'canvas',
    keys: [kb('⌘−', 'global', { inText: true, when: IN_CANVAS_ANY })],
    legacy: { menu: 'Zoom Out', sheet: 'Zoom in / out' },
  },
  {
    id: 'view.zoom-fit',
    label: 'Zoom to fit',
    kind: 'command',
    exec: 'canvas',
    keys: [kb('⌘0', 'global', { inText: true, when: IN_CANVAS_ANY })],
    legacy: { menu: 'Fit to Screen', sheet: 'Fit · actual size' },
  },
  {
    id: 'view.zoom-actual',
    label: 'Actual size',
    kind: 'command',
    exec: 'canvas',
    // ⇧0, Figma's "Zoom to 100%" (V2-3.11: ⌘1…⌘9 pick a tab). Never in a text field: ⇧0 types ")".
    keys: [kb('⇧0', 'global', { inText: false, when: IN_CANVAS_ANY })],
    legacy: { menu: 'Actual Size · 100 %', sheet: 'Fit · actual size' },
  },
  {
    // No key: the embed view frames one artboard on load (DDR-247, `&artboard=<id>`) over the
    // `run-action` lane, `params: { id }`.
    id: 'view.zoom-to-artboard',
    label: 'Zoom to artboard',
    kind: 'command',
    exec: 'canvas',
  },
  {
    id: 'view.jump-artboard',
    label: 'Go to artboard',
    kind: 'command',
    exec: 'canvas',
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n, i) =>
      kb(`⌥⌘${n}`, 'global', { inText: true, alias: i > 0, when: IN_CANVAS_ANY })
    ),
  },
  // V2-4.10 — ⌘K: every panel's › Advanced fold at once (per Mac, client/v2/fold/fold-store.js).
  {
    id: 'view.advanced-open-all',
    label: 'Open all Advanced sections',
    kind: 'command',
    exec: 'shell',
  },
  {
    id: 'view.advanced-close-all',
    label: 'Close all Advanced sections',
    kind: 'command',
    exec: 'shell',
  },
];
