// actions/defs/edit.ts — undo / redo, selection and object keys (V2-2.4: v1 bindings under their
// v2 ids, v1 predicates as they are). One action may carry a shell binding and a canvas binding:
// each document runs its own handler for it (V2-1.3 §5.6).

import type { ActionDef } from '../types.ts';
import { IN_CANVAS, kb, mods, SHELL_FOCI, TRANSPORT } from './_v1.ts';

// v1 shell ⌘Z / ⇧⌘Z: chrome focus with a canvas open; skipped while the timeline transport owns
// them (timeline open with a comp → focus 'timeline') and inside a text field or range slider.
const SHELL_UNDO = {
  focus: ['chrome' as const],
  facts: ['canvasOpen' as const],
  notFacts: ['rangeFocused' as const],
};
// v1 shell ⌘Y (and ⇧⌘Y): the timeline skip covered `z` only.
// S7.6 — the transport's ⌘Z / ⇧⌘Z (timeline focused, not in a <select>) are Undo / Redo now: the
// clip verbs record onto the canvas stack, so one ⌘Z undoes the last edit wherever it was made
// (`timeline.undo` / `timeline.redo` retired; decision maude/v2-S7-timeline-undo-is-project-undo).
const IN_TIMELINE = { when: TRANSPORT, inText: false } as const;
const SHELL_REDO_Y = {
  focus: ['chrome' as const, 'timeline' as const],
  facts: ['canvasOpen' as const],
  notFacts: ['rangeFocused' as const],
};

// V2-4 gate (roles): the Edit menu's verbs that change the canvas are GREYED below Can edit, the
// macOS Edit-menu idiom (`enabled`, not `visible`). Undo / Redo keep their shell ⌘Z / ⇧⌘Z binding
// live, so a viewer's press resolves to the disabled winner and the shell swallows it with the one
// denial line (use-action-keys.jsx + role-gate.js) instead of falling through to WebKit's undo.
// The canvas document's own bindings are untouched: the canvas KeyCtx is always 'owner' and its
// read-only gate is the mode lane's (decision:maude/v2-tool-keys-resolve-for-every-role).
const EDITS = { minRole: 'edit' as const };

// v1 use-keyboard-discipline: canvas focus, not typing (the handler also skips the browse tool and
// needs a selection — v1 checks kept in the handler).
const OBJ = IN_CANVAS;

// S2.6 — an object op: canvas exec, Can edit, an object selected; chords bind in Edit mode only.
const OBJECT_EDIT = { ...OBJ, mode: ['edit' as const], selection: ['object' as const] };
const objectKey = (spec: string, extra: { alias?: boolean } = {}) =>
  kb(spec, 'selection', { when: OBJECT_EDIT, ...extra });
const objectOp = (id: string, label: string, keys: ReturnType<typeof kb>[]): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'canvas',
  enabled: { ...EDITS, selection: ['object'] },
  ...(keys.length ? { keys } : {}),
});

export const EDIT_ACTIONS: ActionDef[] = [
  {
    id: 'edit.undo',
    label: 'Undo',
    kind: 'command',
    exec: 'canvas',
    enabled: EDITS,
    keys: [
      kb('⌘Z', 'global', { inText: false, when: SHELL_UNDO }), // shell → posts `undo` to the canvas
      kb('⌘Z', 'timeline', IN_TIMELINE),
      kb('⌘Z', 'global', { when: IN_CANVAS }), // canvas input-router
    ],
    legacy: { menu: 'Undo', sheet: 'Undo / redo' },
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    kind: 'command',
    exec: 'canvas',
    enabled: EDITS,
    keys: [
      kb('⇧⌘Z', 'global', { inText: false, when: SHELL_UNDO }),
      kb('⇧⌘Z', 'timeline', IN_TIMELINE),
      kb('⌘Y', 'global', { inText: false, alias: true, when: SHELL_REDO_Y }),
      kb('⇧⌘Y', 'global', { inText: false, alias: true, when: SHELL_REDO_Y }),
      kb('⇧⌘Z', 'global', { when: IN_CANVAS }),
      kb('⌘Y', 'global', { alias: true, when: IN_CANVAS }),
    ],
    legacy: { menu: 'Redo', sheet: 'Undo / redo' },
  },
  {
    // S2.20 — Menu › Edit › Undo history…: your changes and your AI's on this canvas, newest first
    // (client/v2/undo/undo-history.jsx, over the ⌘Z projection). No key (V2-1.5 §5.3).
    id: 'edit.undo-history',
    label: 'Undo history…',
    kind: 'command',
    exec: 'shell',
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    enabled: { ...EDITS, facts: ['canvasOpen' as const] },
  },
  {
    id: 'edit.copy',
    label: 'Copy',
    kind: 'command',
    exec: 'shell',
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    // v1 shell ⌘C only logs the retired comment-drop chord's deprecation and falls through to the
    // native copy (no preventDefault).
    keys: [kb('⌘C', 'global', { inText: true, when: { focus: SHELL_FOCI } })],
  },
  {
    // V2-4.2: like Copy, the key is WebKit's own (the Edit menu's predefined Cut / Paste on the
    // Mac); this action is the project menu's row, which does the same to whatever was focused
    // before the menu opened.
    id: 'edit.cut',
    label: 'Cut',
    kind: 'command',
    exec: 'shell',
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    // Greyed below Can edit: the row's canvas branch cuts annotations. ⌘X / ⌘V are WebKit's own
    // (no shell handler), so a commenter still cuts and pastes in the comment composer.
    enabled: EDITS,
    keys: [kb('⌘X', 'global', { inText: true, when: { focus: SHELL_FOCI } })],
  },
  {
    id: 'edit.paste',
    label: 'Paste',
    kind: 'command',
    exec: 'shell',
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    enabled: EDITS,
    keys: [kb('⌘V', 'global', { inText: true, when: { focus: SHELL_FOCI } })],
  },
  {
    id: 'select.all',
    label: 'Select all',
    kind: 'command',
    exec: 'canvas',
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    // v1 use-keyboard-discipline matches `e.key === 'a'` with any ⇧ — so ⇧⌘A selects every element
    // too (V2-1.3 defect 1).
    keys: mods('⌘A', '⇧', 'selection', { when: OBJ }),
  },
  {
    // Menu only in v1 (posts `selection-clear` to the canvas); the "Esc" its rows show is
    // `ui.step-back`'s key.
    id: 'select.none',
    label: 'Deselect all',
    kind: 'command',
    exec: 'canvas',
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    legacy: { menu: 'Deselect all' },
  },
  {
    // Menu only in v1: no key handler implements the ⇧⌘A its rows show (V2-1.3 defect 1).
    id: 'select.all-annotations',
    label: 'Select all annotations',
    kind: 'command',
    exec: 'canvas',
    // V2-4 gate (roles): annotations are selected to change them, and `annotate` is Can edit's
    // (V2-1.7 §5.2). No key, so absent rather than greyed.
    visible: EDITS,
    legacy: { menu: 'Select all annotations' },
  },
  {
    id: 'object.duplicate',
    label: 'Duplicate',
    kind: 'command',
    exec: 'canvas',
    keys: [kb('⌘D', 'selection', { when: { ...OBJ, selection: ['object'] } })],
  },
  {
    id: 'edit.copy-properties',
    label: 'Copy properties',
    kind: 'command',
    exec: 'canvas',
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    keys: mods('⌥⌘C', '⇧', 'selection', { when: { ...OBJ, selection: ['object'] } }),
  },
  {
    id: 'edit.paste-properties',
    label: 'Paste properties',
    kind: 'command',
    exec: 'canvas',
    // A6c (S3.12, 04 Modes note 23): not a Can view row — a viewer's menu lists only what they may do.
    visible: { minRole: 'comment' },
    enabled: EDITS, // V2-4 gate (roles): writes styles; Copy properties is a read and stays
    keys: mods('⌥⌘V', '⇧', 'selection', { when: { ...OBJ, selection: ['object'] } }),
  },
  {
    // S2.1 (ed-obj-enter) — go inside the selected frame: its first object is selected and clicks
    // now pick at that depth. ↵ here, double-click on the canvas (CanvasRouter's drill). Took ↵
    // from `object.select-child`, which stays as the ⌘K / agent entry for the same step.
    id: 'object.enter',
    label: 'Go inside',
    kind: 'command',
    exec: 'canvas',
    // S3.11: Edit's only — in Preview and Viewing ↵ is `inspect.edit` (one binding per chord and context).
    keys: [kb('↵', 'selection', { when: { ...OBJ, mode: ['edit'], selection: ['object'] } })],
  },
  {
    // S2.1 — one level out: the parent is selected; at the top the selection is dropped. Its key is
    // esc, i.e. `ui.step-back`'s selection rung (one esc action, V2-1.3 §5.5) — no binding here.
    id: 'object.step-out',
    label: 'Step out',
    kind: 'command',
    exec: 'canvas',
    enabled: { selection: ['object'] },
  },
  {
    id: 'object.select-child',
    label: 'Select first child',
    kind: 'command',
    exec: 'canvas',
  },
  {
    id: 'object.select-parent',
    label: 'Select parent',
    kind: 'command',
    exec: 'canvas',
    keys: [kb('⇧↵', 'selection', { when: { ...OBJ, selection: ['object'] } })],
  },
  {
    id: 'object.select-next',
    label: 'Select next sibling',
    kind: 'command',
    exec: 'canvas',
    keys: [
      kb('tab', 'selection', { when: { ...OBJ, selection: ['object'] } }),
      kb('⇧tab', 'selection', { when: { ...OBJ, selection: ['object'] } }),
    ],
  },
  {
    id: 'object.remove',
    label: 'Remove',
    kind: 'command',
    exec: 'canvas',
    keys: [
      // v1 shell: the ⌫ guard (blocks WKWebView back-navigation; deletes a selected artboard) and
      // the timeline transport (removes the selected clip) — both ran on one press (defect 7).
      // The transport matched any modifier; the guard none but ⇧.
      ...mods('⌫', '⇧', 'global', {
        when: { focus: ['chrome', 'timeline'], notFacts: ['selectFocused'] },
      }),
      ...mods('⌦', '⇧', 'global', {
        when: { focus: ['chrome', 'timeline'], notFacts: ['selectFocused'] },
      }),
      ...['⌘⌫', '⇧⌘⌫', '⌥⌫', '⌥⇧⌫', '⌥⌘⌫', '⌥⇧⌘⌫', '⌘⌦', '⇧⌘⌦', '⌥⌦', '⌥⇧⌦', '⌥⌘⌦', '⌥⇧⌘⌦'].map(
        (c) =>
          kb(c, 'timeline', {
            inText: false,
            alias: true,
            when: { selection: ['clip'], notFacts: ['selectFocused'] },
          })
      ),
      // v1 canvas use-keyboard-discipline: the selected element (an artboard's ⌫ is `artboard.trash`).
      ...mods('⌫', '⇧', 'selection', { when: { ...OBJ, selection: ['object'] } }),
      ...mods('⌦', '⇧', 'selection', { when: { ...OBJ, selection: ['object'] } }),
    ],
  },
  {
    id: 'object.nudge',
    label: 'Nudge',
    kind: 'command',
    exec: 'canvas',
    keys: ['←', '→', '↑', '↓'].flatMap((a) =>
      mods(a, '⇧', 'selection', { when: { ...OBJ, selection: ['object', 'artboard'] } })
    ),
  },
  // S2.6 (ed-obj-order) — the object menu's rows. Edit-mode chords on an OBJECT selection (the same
  // chords in Preview belong to the annotation board: `annotation.*` carries `mode: preview`). Each
  // is one `edit-op` (edit-ops/{frame,unframe,z-order,lock,hide}.ts); greyed below Can edit.
  objectOp('object.frame', 'Frame selection', [
    objectKey('⌥⌘G'),
    objectKey('⌘G', { alias: true }), // Figma muscle memory; in Preview ⌘G groups annotations
  ]),
  objectOp('object.unframe', 'Remove frame', [objectKey('⇧⌘G')]),
  objectOp('object.bring-front', 'Bring to front', [objectKey('⌘]')]),
  objectOp('object.bring-forward', 'Bring forward', [objectKey(']')]),
  objectOp('object.send-backward', 'Send backward', [objectKey('[')]),
  objectOp('object.send-back', 'Send to back', [objectKey('⌘[')]),
  objectOp('object.lock', 'Lock', [objectKey('⇧⌘L')]),
  objectOp('object.hide', 'Hide', []),
  {
    // A selection gesture, not a write: no edit-op, no role gate (a viewer may select).
    id: 'object.select-matching',
    label: 'Select matching',
    kind: 'command',
    exec: 'canvas',
    enabled: { selection: ['object'] },
  },
  // S2.7 (ed-obj-multi) — the align bar: 2+ objects or 2+ artboards (distribute: 3+). The bar and ⌘K are
  // the homes; no chords (the Figma ⌥-letters collide with macOS dead keys, S2.21 may add some).
  // Objects run `edit-ops/{align,distribute}.ts`; artboards commit positions through the drag bus.
  ...(
    [
      ['align.left', 'Align left', ['align', 'left', 'edge']],
      ['align.hcentre', 'Align horizontal centres', ['align', 'centre', 'center', 'middle']],
      ['align.right', 'Align right', ['align', 'right', 'edge']],
      ['align.top', 'Align top', ['align', 'top', 'edge']],
      ['align.vmiddle', 'Align vertical middles', ['align', 'middle', 'centre', 'center']],
      ['align.bottom', 'Align bottom', ['align', 'bottom', 'edge']],
      ['distribute.h', 'Distribute horizontally', ['distribute', 'space', 'even', 'gaps']],
      ['distribute.v', 'Distribute vertically', ['distribute', 'space', 'even', 'gaps']],
    ] as const
  ).map(
    ([id, label, keywords]): ActionDef => ({
      id,
      label,
      kind: 'command',
      exec: 'canvas',
      enabled: { ...EDITS, selection: ['object', 'artboard'] },
      search: { keywords: [...keywords] },
    })
  ),
  {
    // ⌘K: turn the selection 90°. The rotate handle (drag, ⇧ = 15°) and the Rotation row do the rest.
    id: 'object.rotate',
    label: 'Rotate 90°',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { keywords: ['rotate', 'turn', 'angle'] },
  },
  // S2.11 (ed-lay-auto · ed-lay-reorder · ed-lay-free) — layout. Place freely makes X and Y the
  // object's own (CSS, not data-cd-*); ← → (↑ ↓ in a column) move an object earlier / later in its
  // auto layout — the keys are handled in the canvas (a flex child's arrows), because a registry
  // predicate cannot say "inside auto layout", and v1's nudge ignores a child that sits in a layout.
  // `object.reorder-to` (the drop of a drag, ⌥ = a copy) and `object.constrain` (the Position row's
  // pins) are the same family: edit-ops with params, run by the gesture, not offered in ⌘K.
  // `layout.convert-to-absolute` is v1's "Convert layout to absolute", re-homed in the inspector's
  // Layout › Advanced; the right-click row stays.
  {
    id: 'object.place-freely',
    label: 'Place freely',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { keywords: ['absolute', 'free', 'position', 'ignore auto layout', 'x y'] },
  },
  {
    id: 'object.reorder-earlier',
    label: 'Move earlier',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { keywords: ['reorder', 'order', 'earlier', 'before', 'left', 'up'] },
  },
  {
    id: 'object.reorder-later',
    label: 'Move later',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { keywords: ['reorder', 'order', 'later', 'after', 'right', 'down'] },
  },
  {
    id: 'object.reorder-to',
    label: 'Move next to…',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { hidden: true },
  },
  {
    id: 'object.constrain',
    label: 'Constraints',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { hidden: true },
  },
  // S2.11c — ⌥ on a gap drag: one gap value over several auto layouts, one write and one undo step.
  // A gesture, like `object.reorder-to`: not offered in ⌘K.
  {
    id: 'layout.set-gap',
    label: 'Set gap',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { hidden: true },
  },
  {
    id: 'layout.convert-to-absolute',
    label: 'Convert children to absolute position',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { keywords: ['remove auto layout', 'absolute', 'free', 'unlayout', 'convert layout'] },
  },
  // S2.13 (ed-shape) — the Frame / Shape tools' drag and the corner dot's drag. Gestures like `object.reorder-to`:
  // the tool (F, R, More) is how a person starts them, so they are not offered in ⌘K.
  {
    id: 'object.insert-shape',
    label: 'Draw a shape',
    kind: 'command',
    exec: 'canvas',
    enabled: EDITS,
    search: { hidden: true },
  },
  {
    id: 'artboard.draw',
    label: 'Draw an artboard',
    kind: 'command',
    exec: 'canvas',
    enabled: EDITS,
    search: { hidden: true },
  },
  {
    id: 'object.set-corner-radius',
    label: 'Round a corner',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { hidden: true },
  },
  // S2.12 (ed-text-edit · ed-text-style) — text in place, styles and the Czech ties. The home of every
  // one is the text's inspector (Type: Style · Case · Language) and the caret on the canvas; ⌘K offers the
  // two that need no choice. The rest take a value (a style, a case, a language, the typed copy), so they
  // are run by their control and are not offered in ⌘K. `text.set` is the typed copy — a gesture.
  {
    id: 'text.set',
    label: 'Set text',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { hidden: true },
  },
  {
    id: 'text.set-language',
    label: 'Set language',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { hidden: true },
  },
  {
    id: 'text.set-case',
    label: 'Set case',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { hidden: true },
  },
  {
    id: 'text.use-style',
    label: 'Use a style',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { hidden: true },
  },
  {
    id: 'text.reset-style',
    label: 'Reset text style',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { keywords: ['reset', 'override', 'style', 'type', 'font', 'size'] },
  },
  // S2.16 — ⇧I: an instance of a design-system component, placed linked (`@maude/ds`). The Component
  // picker (shell) chooses what; ⌘K carries no choice, so the row is hidden — a command with params.
  {
    id: 'component.insert',
    label: 'Place a component',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS },
    search: { hidden: true },
  },
  {
    id: 'text.detach-style',
    label: 'Detach text style',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['object'] },
    search: { keywords: ['detach', 'style', 'unlink', 'type', 'no style'] },
  },
  // S2.2 (D18) — the inspector's Advanced actions. Shell commands on the selected element, ⌘K only
  // (their homes are the buttons and the id field inside Inspector › Advanced, client/v2/inspector/).
  // Greyed without an object selected. Setting an id is a write, so it is greyed below Can edit too.
  {
    id: 'inspector.copy-css',
    label: 'Copy CSS',
    kind: 'command',
    exec: 'shell',
    enabled: { selection: ['object'] },
  },
  {
    id: 'element.copy-id',
    label: 'Copy element id',
    kind: 'command',
    exec: 'shell',
    enabled: { selection: ['object'] },
  },
  {
    id: 'element.set-id',
    label: 'Edit element id…',
    kind: 'command',
    exec: 'shell',
    enabled: { ...EDITS, selection: ['object'] },
  },
  // S2.8 — artboards. Both take a size, so neither is a ⌘K row: their homes are the eight handles on a
  // selected artboard (`artboard.resize` is the edit-op id they run, S2-edit-ops.md) and the artboard
  // inspector's "Other widths › Add a width…" (a copy of the board at another width, beside it).
  {
    id: 'artboard.resize',
    label: 'Resize artboard',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['artboard'] },
    search: { hidden: true },
  },
  {
    id: 'artboard.add-width',
    label: 'Add a width',
    kind: 'command',
    exec: 'shell',
    enabled: { ...EDITS, selection: ['artboard'] },
    search: { hidden: true },
  },
  // S2.9 — Tidy up: the align bar's button over 2+ artboards (one row, even gaps, on the lowest one's line). The
  // positions go to the layout lane in ONE commit (annotations ride along, one ⌘Z). Also a ⌘K row.
  {
    id: 'artboard.tidy',
    label: 'Tidy up artboards',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['artboard'] },
    search: { keywords: ['tidy', 'row', 'even', 'gaps', 'arrange', 'line up'] },
  },
  // S2.10 — the artboard's own menu (14 Editing ed-ab-menu). ⌘D copies it to the right at the row's gap, selected;
  // the same copy is one edit-op (`edit-ops/duplicate-at-width.ts`). "Duplicate at another width" takes a width, so
  // it is the menu's flyout, not a ⌘K row; the old object-only ⌘D stays `object.duplicate` (selection 'object').
  {
    id: 'artboard.duplicate',
    label: 'Duplicate artboard',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['artboard'] },
    keys: [kb('⌘D', 'selection', { when: { ...OBJ, mode: ['edit'], selection: ['artboard'] } })],
    search: { keywords: ['copy', 'clone', 'duplicate', 'artboard'] },
  },
  {
    id: 'artboard.duplicate-at-width',
    label: 'Duplicate at another width',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['artboard'] },
    search: { hidden: true },
  },
  {
    id: 'artboard.rename',
    label: 'Rename artboard',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['artboard'] },
    search: { keywords: ['name', 'label', 'artboard'] },
  },
  {
    id: 'artboard.reset-position',
    label: 'Reset artboard position',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['artboard'] },
    search: { keywords: ['position', 'grid', 'back', 'artboard'] },
  },
  // S2.10b/c — ⌫ / "Move to trash" on a selected artboard: the `artboard.trash` edit-op, ONE `kind: 'trash'`
  // action that takes the board, its place and its annotations (the Trash lists it, one ⌘Z brings all
  // back). The selection-layer ⌫ moved here from `object.remove`, which keeps element selections.
  {
    id: 'artboard.trash',
    label: 'Move artboard to the trash',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, selection: ['artboard'] },
    keys: [
      ...mods('⌫', '⇧', 'selection', { when: { ...OBJ, selection: ['artboard'] } }),
      ...mods('⌦', '⇧', 'selection', { when: { ...OBJ, selection: ['artboard'] } }),
    ],
    search: { keywords: ['delete', 'remove', 'trash', 'artboard'] },
  },
  // S2.10 — "Ask AI about this artboard ⌘/" in the artboard menu. The composer that takes the artboard is S5's; the row
  // is greyed with its own line until then (⌘/ stays `ai.chat`).
  {
    id: 'artboard.ask-ai',
    label: 'Ask AI about this artboard',
    kind: 'command',
    exec: 'shell',
    enabled: { ...EDITS, selection: ['artboard'] },
    search: { hidden: true },
  },
  // S3.10a — where a click goes: `data-cd-link` on the element (S3-links-format). Both are `edit-op`s
  // (`edit-ops/{set,clear}-link.ts`) on POST /_api/edit-op. Clear link runs from ⌘K through the inspector's
  // frame; Set link has no human picker yet (the On click row only clears), so it has no runner — the AI path
  // and the route are complete.
  {
    id: 'element.set-link',
    label: 'Set link',
    kind: 'command',
    exec: 'shell',
    enabled: { ...EDITS, selection: ['object'] },
  },
  {
    id: 'element.clear-link',
    label: 'Clear link',
    kind: 'command',
    exec: 'shell',
    enabled: { ...EDITS, selection: ['object'] },
  },
  // S11.8 — Inspector › Advanced, the code half. Copy code reads the canvas source (`/_api/canvas-source`,
  // which needs `export`: Can comment and up, never Can view); the other two write the element's JSX.
  {
    id: 'inspector.copy-code',
    label: 'Copy code',
    kind: 'command',
    exec: 'shell',
    enabled: { minRole: 'comment' as const, selection: ['object'] },
  },
  {
    id: 'inspector.edit-css-as-text',
    label: 'Edit CSS as text…',
    kind: 'command',
    exec: 'shell',
    enabled: { ...EDITS, selection: ['object'] },
  },
  {
    id: 'element.detach',
    label: 'Detach from shared component',
    kind: 'command',
    exec: 'shell',
    enabled: { ...EDITS, selection: ['object'] },
  },
  // S3.11 — the Inspect panel (Preview ⌘-click, Viewing click; 04 md-inspect). Copy code is the same download
  // as `inspector.copy-code` (Can comment and up — the server refuses source to Can view), run from the panel
  // that is open in these modes; Edit ↵ asks the shell for Edit with the same element selected, so it is the
  // canvas's key (the canvas holds the selection) and the panel's Edit button replays it.
  {
    id: 'inspect.copy-code',
    label: 'Copy code',
    kind: 'command',
    exec: 'shell',
    enabled: {
      minRole: 'comment' as const,
      mode: ['preview' as const, 'viewing' as const],
      selection: ['object'],
    },
  },
  {
    id: 'inspect.edit',
    label: 'Edit',
    kind: 'command',
    exec: 'canvas',
    enabled: { ...EDITS, mode: ['preview' as const, 'viewing' as const], selection: ['object'] },
    keys: [
      kb('↵', 'selection', {
        when: { ...OBJ, mode: ['preview', 'viewing'], selection: ['object'] },
      }),
    ],
    search: { keywords: ['inspect', 'switch', 'edit mode'] },
  },
  // S8.19c — Relink… on a picture no device has: pick a copy, import it, re-point every reference to it
  // (edit-op `asset.relink`). Opened from the placeholder frame's button and the Inspector's box; a write,
  // so greyed below Can edit (the server refuses the edit-op anyway).
  {
    id: 'asset.relink',
    label: 'Relink…',
    kind: 'command',
    exec: 'shell',
    enabled: { ...EDITS },
  },
];
