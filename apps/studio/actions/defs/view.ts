// actions/defs/view.ts — panels, view toggles and zoom (V2-2.4: v1 bindings under their v2 ids).

import type { ActionDef } from '../types.ts';
import { IN_CANVAS, IN_CANVAS_ANY, kb, SHELL_NOT_TYPING } from './_v1.ts';

export const VIEW_ACTIONS: ActionDef[] = [
  {
    id: 'view.panels',
    label: 'Hide panels',
    kind: 'toggle',
    exec: 'shell',
    // v1: bare T toggles the Files panel (the v2 key is ⌘\, D4: T is Text).
    keys: [kb('T', 'global', { inText: false, when: SHELL_NOT_TYPING })],
    legacy: { menu: 'Project Tree', sheet: 'Project tree' },
  },
  {
    id: 'view.hidden-files',
    label: 'Hidden files',
    kind: 'toggle',
    exec: 'shell',
    keys: [kb('H', 'global', { inText: false, when: SHELL_NOT_TYPING })],
    legacy: { menu: 'Show hidden files', sheet: 'Hidden files' },
  },
  {
    id: 'view.design-system',
    label: 'Design system',
    kind: 'toggle',
    icon: 'sliders',
    exec: 'shell',
    keys: [kb('S', 'global', { inText: false, when: SHELL_NOT_TYPING })],
    legacy: { palette: 'Open design system view', sheet: 'Design system view' },
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
    id: 'history.open',
    label: 'Version history',
    kind: 'toggle',
    exec: 'shell',
    fromCanvas: true,
    // v1: ⇧⌘G toggles the Changes panel — v2's Version history (⌥⌘H) is its successor; Phase 4
    // moves the key (rule 13: ⇧⌘G becomes remove frame / ungroup).
    keys: [kb('⇧⌘G', 'global', { inText: true })],
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
    keys: [kb('⌘1', 'global', { inText: true, when: IN_CANVAS_ANY })],
    legacy: { menu: 'Actual Size · 100 %', sheet: 'Fit · actual size' },
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
];
