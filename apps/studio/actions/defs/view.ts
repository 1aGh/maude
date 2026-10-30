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
    // S3.10a — back out of a followed link (S3-links-format §5 "Back"): the PreviewBar's "‹ Homepage". No key
    // (esc leaves Preview, it does not go back). A per-window stack in shell memory; nothing to pop = nothing.
    id: 'preview.back',
    label: 'Back',
    kind: 'command',
    exec: 'shell',
    enabled: { mode: ['preview'] },
    search: { keywords: ['link', 'previous', 'return', 'canvas'] },
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
  // S11.9 (06 `ad-left`) — the two switches of the left panel's Advanced folds. Both are the person's own
  // view (kept on this Mac, never written to the project); the select-by-selector field is the Layers
  // panel's, and the canvas answers with a selection of what matched inside the artboards (capped, scoped).
  {
    id: 'canvases.show-file-names',
    label: 'Show file names',
    kind: 'toggle',
    exec: 'shell',
    search: { keywords: ['file', 'names', 'tsx', 'files'], where: 'Canvases › Advanced' },
  },
  {
    id: 'layers.show-tags',
    label: 'Show tags and ids',
    kind: 'toggle',
    exec: 'shell',
    search: { keywords: ['tags', 'ids', 'layers', 'html'], where: 'Layers panel › Advanced' },
  },
  {
    id: 'layers.select-by-selector',
    label: 'Select by selector',
    kind: 'command',
    exec: 'shell',
    enabled: { facts: ['canvasOpen'] },
    search: {
      keywords: ['selector', 'css', 'query', 'select', 'matching'],
      where: 'Layers panel › Advanced',
    },
  },
  // S7.24b (08 · ak-mixed-fit) — the kind chips in the Layers header (the same filter as the Canvases chips);
  // ⌘K moves the cursor to them. The filter dims the other artboards on the canvas, in this person's window only.
  {
    id: 'layers.filter-kind',
    label: 'Filter layers by kind',
    kind: 'command',
    exec: 'shell',
    enabled: { facts: ['canvasOpen'] },
    search: { where: 'Layers panel' },
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
    // S8.12 (ia-assets-keys) — select an artboard, then a tile: ↵ places it there (the same `image.place` edit-op as a
    // drop). The tile menu's first row is this action. Only while a tile is picked and focus is in the tab
    // (`assetTileSelected`); the canvas never sees it. A write: Can edit and up, refused by the server as well.
    id: 'assets.place',
    label: 'Place',
    kind: 'command',
    icon: 'image',
    exec: 'shell',
    enabled: { minRole: 'edit' },
    keys: [
      kb('↵', 'selection', {
        when: { focus: ['chrome', 'timeline'], facts: ['assetTileSelected'] },
      }),
    ],
    search: { hidden: true },
  },
  {
    // V2-8.16 (journey S8) — Assets › Add files… (the + at the bar's right end, or files dropped on the tab): each file
    // comes in cleaned (an SVG is sanitized) and content-named assets/<sha8>.<ext>. The panel runs it itself, so no
    // ⌘K row; the action exists so bringing a file in has its one AI path (`maude design import-asset`, agents.ts).
    // Without it an agent asked to bring a logo into the project hand-copied it somewhere else. A write: Can edit and up.
    id: 'assets.add',
    label: 'Add files…',
    kind: 'command',
    icon: 'plus',
    exec: 'shell',
    enabled: { minRole: 'edit' },
    search: { hidden: true },
  },
  {
    // p8-import-link (12 · ia-edges F "A link instead of a file") — Assets › Add from a link… (the link icon in the
    // tab head, or a link dropped on the tab): the studio fetches the https link — public addresses only, capped, the
    // type from its bytes (link-import.ts) — and saves a copy in Assets. The tab opens first when it is not showing.
    // A write that reaches a third-party site: Can edit and up, and the server refuses everyone else.
    id: 'assets.add-link',
    label: 'Add from a link…',
    kind: 'command',
    icon: 'link',
    exec: 'shell',
    enabled: { minRole: 'edit' },
    search: { keywords: ['link', 'url', 'web', 'download', 'import', 'picture', 'video'] },
  },
  {
    // S8.16 (ia-gen-ask) — Assets › Generate: say the picture, the selected artboard sets the shape; before anything is
    // sent one line says how long and whose account pays, one line the licence. The best take lands in the frame. A
    // paid call to a provider: Can edit and up, and the server refuses a run without its single-use quote.
    id: 'assets.generate',
    label: 'Generate an image…',
    kind: 'command',
    icon: 'sparkle',
    exec: 'shell',
    enabled: { minRole: 'edit' },
    search: { keywords: ['generate', 'ai', 'image', 'picture', 'takes'] },
  },
  {
    // S8.12 — ⌘I on the picked tile: its details (a read, so every role). S8.21 draws the full sheet.
    id: 'assets.details',
    label: 'Show details',
    kind: 'command',
    exec: 'shell',
    keys: [
      kb('⌘I', 'selection', {
        when: { focus: ['chrome', 'timeline'], facts: ['assetTileSelected'] },
      }),
    ],
    search: { hidden: true },
  },
  {
    // S8.13 — Move to trash on the picked tile (its menu row; the tidy view's "Move 31 to the trash…" is the same route).
    // A write: Can edit and up, refused by the server as well. The server also refuses a picture a canvas uses or an
    // older version still shows (`POST /_api/assets/trash`). No key.
    id: 'assets.trash',
    label: 'Move to trash',
    kind: 'command',
    icon: 'trash',
    exec: 'shell',
    enabled: { minRole: 'edit' },
    search: { hidden: true },
  },
  {
    // P8 round 7 (12 · ia-assets-keys) — Rename… in the tile menu: the picture and its sidecars take the new name; the
    // extension stays. A write: Can edit and up, refused by the server as well, and refused for a picture a canvas uses
    // or an older version shows (`POST /_api/assets/rename`), so no artboard loses its picture. No key.
    id: 'assets.rename',
    label: 'Rename…',
    kind: 'command',
    exec: 'shell',
    enabled: { minRole: 'edit' },
    search: { hidden: true },
  },
  {
    // S8.20 (12 · ia-assets-find, CONTRACT §7) — search what's IN the pictures, not only their names: asked once per
    // project, per person, on this Mac ("Describe the pictures in <project>?"), never assumed. On, AI describes each
    // picture once with the person's Claude account; off, search reads names and tags. The sheet is the only way on.
    id: 'assets.describe',
    label: 'Search in pictures',
    kind: 'toggle',
    icon: 'search',
    exec: 'shell',
    search: { keywords: ['describe', 'pictures', 'photos', 'what is in', 'ai', 'search'] },
  },
  {
    // S8.20 — Stop / Resume in "Describing 12 of 193 pictures" (the Assets tab's foot). Consent stays; describing waits.
    id: 'assets.describe-stop',
    label: 'Stop describing pictures',
    kind: 'command',
    exec: 'shell',
    search: { hidden: true },
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
    id: 'trash.restore',
    label: 'Restore',
    kind: 'command',
    icon: 'trash',
    exec: 'shell',
    // S1.17 (S1-slices row S1.7, V2-1.7 §5.2 `trash`): the Trash row's hover Restore (S1.8 draws it).
    // POST /_api/trash/restore refuses a viewer/commenter itself. Needs a row, so ⌘K hides it. No key.
    visible: { minRole: 'edit' },
    search: { hidden: true },
  },
  {
    id: 'trash.clear',
    label: 'Clear out the trash…',
    kind: 'command',
    icon: 'trash',
    exec: 'shell',
    // S1.7b (S1-slices row S1.7, V2-1.7 §5.2 `delete`): the Trash foot's "Clear out…" (S1.8 draws
    // it, owner only). POST /_api/trash/clear refuses everyone else (hidden ≠ refused). No key.
    visible: { minRole: 'owner' },
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
  // S9.22 — the Comments panel's four filters (CONTRACT §6: Open · Mine · Resolved · All) and a thread
  // deep link. Each opens the panel (as `view.comments` does) on that filter; ⌘K lists them by their
  // words. No keys: ⇧⌘M stays the panel's one chord. `comments.open-thread` takes `{ id }` over the
  // `run-action` lane (the mention toast's Open, a deep link, ⌘K on a result).
  { id: 'comments.filter-open', label: 'Show open comments', kind: 'command', exec: 'shell' },
  { id: 'comments.filter-mine', label: 'Show my comments', kind: 'command', exec: 'shell' },
  {
    id: 'comments.filter-resolved',
    label: 'Show resolved comments',
    kind: 'command',
    exec: 'shell',
  },
  { id: 'comments.filter-all', label: 'Show all comments', kind: 'command', exec: 'shell' },
  { id: 'comments.open-thread', label: 'Open comment thread', kind: 'command', exec: 'shell' },
  {
    id: 'view.exports',
    label: 'Exports',
    kind: 'toggle',
    icon: 'export',
    exec: 'shell',
    visible: { minRole: 'comment' },
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
    help: { group: 'finding', order: 30 },
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
    // S3.1 (CONTRACT §2 [A7], 04 md-present-menu): ⌥⌘↵ presents the artboards one by one from the
    // selected artboard (else the one in view, else the start). The shell owns the mode (D1): the
    // handler enters Present through use-canvas-mode-lane; with the canvas focused the chord is
    // forwarded (fromCanvas). Not in Present (esc leaves first).
    id: 'present.from-selection',
    label: 'Present',
    kind: 'command',
    exec: 'shell',
    fromCanvas: true,
    keys: [kb('⌥⌘↵', 'global', { when: { mode: ['edit', 'viewing', 'preview'] } })],
    search: { keywords: ['presentation', 'slideshow', 'artboards', 'selected'] },
  },
  {
    // S3.1 — ⇧⌥⌘↵: the same, from the first artboard in canvas order.
    id: 'present.from-start',
    label: 'Present from the start',
    kind: 'command',
    exec: 'shell',
    fromCanvas: true,
    keys: [kb('⇧⌥⌘↵', 'global', { when: { mode: ['edit', 'viewing', 'preview'] } })],
    search: { keywords: ['presentation', 'slideshow', 'beginning', 'first'] },
  },
  {
    // S3.2b (md-keys, `present` scope): → and space go on, ← and ⇧space go back. With the canvas focused the
    // stage (present/present-stage.tsx) hears the same keys itself; this is the shell half, for when the
    // shell holds the focus (its controls, a click on its chrome). Only while presenting, so → ← and space
    // keep their other meanings everywhere else.
    id: 'present.next',
    label: 'Next artboard',
    kind: 'command',
    exec: 'shell',
    keys: [
      kb('→', 'global', { when: { mode: ['present'] } }),
      kb('Space', 'global', { when: { mode: ['present'] } }),
    ],
    search: { keywords: ['presentation', 'slideshow', 'advance', 'forward'] },
  },
  {
    id: 'present.prev',
    label: 'Previous artboard',
    kind: 'command',
    exec: 'shell',
    keys: [
      kb('←', 'global', { when: { mode: ['present'] } }),
      kb('⇧Space', 'global', { when: { mode: ['present'] } }),
    ],
    search: { keywords: ['presentation', 'slideshow', 'back', 'backward'] },
  },
  {
    // S3.1 — re-pointed: the toggle is a call into the one mode owner (Present · Canvas, D1).
    id: 'present.canvas',
    label: 'Present the canvas',
    kind: 'toggle',
    exec: 'shell',
    legacy: { menu: 'Presentation Mode' },
  },
  {
    // S3.5 (CONTRACT §6 [C31], 04 md-present-menu): the sheet that sets the Present order, the skipped
    // artboards and the speaker notes — all in the versioned `.meta.json`, through PATCH
    // /_api/present-meta (main origin, refused to a read-only session). Hidden below edit.
    id: 'present.order-notes',
    label: 'Order and notes…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    enabled: { facts: ['canvasOpen'] },
    search: { keywords: ['presentation', 'slides', 'speaker notes', 'skip', 'reorder'] },
  },
  {
    // S3.6b (04 md-present-menu, md-presenter): Present ⌄ › "Presenter view on another display ✓ (<name>)". A
    // toggle the person sets; with it on, Present · Artboards shows the Mac the presenter's screen and the
    // audience window follows on the other display. Desktop only, and the row is absent (not greyed) with one
    // display — the shell's Present ⌄ menu and the controls' button read the display list; this action is the
    // one registry home both call. Only a person's click turns it on: no canvas message can.
    id: 'present.presenter-view',
    label: 'Presenter view on another display',
    kind: 'toggle',
    exec: 'shell',
    visible: { shell: ['desktop'], facts: ['native'] },
    search: { keywords: ['presentation', 'second screen', 'audience', 'notes', 'projector'] },
  },
  {
    // S3.7b (md-present-link) — the link a cloud viewer with Can view follows (hub `GET /present/<canvas>`,
    // client/v2/present/copy-link.js). An editor's row; shown greyed with "in a cloud project" outside a
    // cloud-linked project (the V2-4.9 decision 2 pattern — absence with a notice, never a silent hole).
    id: 'present.copy-link',
    label: 'Copy presentation link',
    kind: 'command',
    icon: 'link',
    exec: 'shell',
    visible: { minRole: 'edit' },
    // S3.8 (S3-present-session §5): offline the copy waits — greyed until the network is back.
    enabled: { facts: ['online'], any: [{ facts: ['linkedHub'] }, { shell: ['cloud'] }] },
    search: {
      keywords: ['presentation', 'slideshow', 'audience', 'follow', 'share', 'link', 'url'],
      note: 'in a cloud project',
    },
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
    search: { where: 'Once · every panel' },
  },
  {
    id: 'view.advanced-close-all',
    label: 'Close all Advanced sections',
    kind: 'command',
    exec: 'shell',
    search: { where: 'Settings › Advanced › Reset' },
  },
];
