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
  // S6.1 — the brief board keeps a door of its own (⌘K and the Canvases panel's New menu); ⌘N makes a blank
  // canvas. It runs what `canvas.new` ran in v1: the tree's composer asks for a name, then stamps the board.
  {
    id: 'canvas.new-brief',
    label: 'New brief board',
    kind: 'command',
    icon: 'plus',
    exec: 'shell',
    visible: { minRole: 'edit' },
  },
  // S6.3 — Home's "Ask AI for a new canvas…" (↵ on Home): a canvas from one sentence, opened and drafted by AI
  // in a new chat. The door is Home's own prompt (it has no key in a project window); in a project window the
  // same call is `home.ask {prompt}` — a parked Home intent runs it (client/v2/create/take-intent.js). The role
  // gate is the create's: Can comment / Can view have no door and the server refuses the POST.
  {
    id: 'home.ask',
    label: 'Ask AI for a new canvas…',
    kind: 'command',
    icon: 'sparkle',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: { hidden: true },
  },
  {
    id: 'canvas.reload',
    label: 'Reload canvas',
    kind: 'command',
    icon: 'reload',
    exec: 'shell',
    // Decision v2-A6c-can-view-menu-minrole: an app-level row — every role keeps it.
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
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
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
  // S11.7 (06 `ad-code`, `ad-edge-syntax`) — the canvas as code, read-only, and the broken-canvas card's
  // rows. View code needs the source, which is a download (V2-1.7): Can comment and up. The server
  // (`GET /_api/canvas-source`, Export on the canvas) refuses Can view whatever the shell draws.
  {
    id: 'canvas.view-code',
    label: 'View code',
    kind: 'command',
    icon: 'code',
    exec: 'shell',
    visible: { minRole: 'comment' },
    enabled: { facts: ['canvasOpen'] },
    search: {
      keywords: ['code', 'source', 'tsx', 'developer', 'read only'],
      where: 'Canvases panel › row menu › View code',
    },
  },
  // S11.9 (06 `ad-left`, `ad-edge-where`) — the row menu's Advanced group, on the OPEN canvas from ⌘K.
  // Reveal in Finder / Open in editor are the Mac app's native doors (S11.16: project-relative paths only,
  // Rust confines them); they are Can edit and up and only where the shell is the desktop app — in a browser
  // the menu swaps them for "Open in the Mac app", and Can comment never sees them. Copy file path and Rename
  // file… are shell commands (Rename file renames the .tsx and its .meta.json together, like Rename).
  {
    id: 'canvas.reveal-in-finder',
    label: 'Reveal in Finder',
    kind: 'command',
    icon: 'folder',
    exec: 'native',
    visible: { shell: ['desktop'], facts: ['native'], minRole: 'edit' },
    enabled: { facts: ['canvasOpen'] },
    search: {
      keywords: ['finder', 'show', 'file', 'folder', 'explorer'],
      where: 'Canvases panel › Advanced › row menu › Reveal in Finder',
    },
  },
  {
    id: 'canvas.open-in-editor',
    label: 'Open in editor',
    kind: 'command',
    icon: 'edit',
    exec: 'native',
    visible: { shell: ['desktop'], facts: ['native'], minRole: 'edit' },
    enabled: { facts: ['canvasOpen'] },
    search: {
      keywords: ['editor', 'code', 'vscode', 'file', 'tsx'],
      where: 'Canvases panel › Advanced › row menu › Open in editor',
    },
  },
  {
    id: 'canvas.copy-file-path',
    label: 'Copy file path',
    kind: 'command',
    icon: 'duplicate',
    exec: 'shell',
    visible: { minRole: 'comment' },
    enabled: { facts: ['canvasOpen'] },
    search: {
      keywords: ['path', 'file', 'copy', 'location'],
      where: 'Canvases panel › Advanced › row menu › Copy file path',
    },
  },
  {
    id: 'canvas.rename-file',
    label: 'Rename file…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    enabled: { facts: ['canvasOpen'] },
    search: {
      keywords: ['rename', 'file', 'name'],
      where: 'Canvases panel › Advanced › row menu › Rename file…',
    },
  },
  // The card's own buttons: they act on the card that is showing, so they are not ⌘K rows.
  {
    id: 'canvas.copy-error',
    label: 'Copy error',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'comment' },
    search: { hidden: true },
  },
  {
    // PRE-FILLS the AI chat composer; the person presses send (ask-AI rule: never sends).
    id: 'canvas.ask-ai-fix',
    label: 'Ask AI to fix it',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop'], minRole: 'edit' },
    search: { hidden: true },
  },
  {
    // "Last good version" / "Go back to 14:05" — the same restore as `history.go-back` (S1.13)
    id: 'canvas.last-good',
    label: 'Last good version',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    search: { hidden: true },
  },
  // Today's panels: the Figma import dialog and the brand upload panel.
  {
    id: 'import.figma',
    label: 'Import from Figma…',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' },
    // S6.9: Home's "Import from Figma" Advanced sheet opens the target project with this action as its intent
    search: { keywords: ['figma', 'frames', 'dev mode', 'access token'] },
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
  // S7.20 (D17) — Edit › Advanced ▸ New artboard › Video: a Landscape 16:9 video artboard in the open canvas, with its
  // comp. (⌘K's "New video" stays `canvas.new-video`, which makes a whole video canvas.) It posts
  // `artboard.insert-preset` to the canvas, which picks the spot and writes the one op.
  {
    id: 'artboard.new-video',
    label: 'New artboard: Video',
    kind: 'command',
    exec: 'shell',
    visible: { minRole: 'edit' }, // inserts into the open canvas, like its siblings
  },
];
