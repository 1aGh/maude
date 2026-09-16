// What each surface's declared actions are actually asserted BY — plan T1/T31.
//
// `local-e2e.md` declares 116 actions across 24 surfaces. The catalogue turned
// every one of them into an `L<NN>.requirement.<action>` case marked
// `requiresTargetExpansion`, and nothing ever expanded them — so the run
// carried 24 blanket `remaining-variants` rows that said "not certified" and
// nothing about how close any surface actually was. A blanket placeholder is
// the same disease as a blanket green: it cannot be acted on.
//
// This is the expansion: per surface, per declared action, the EXACT row ids
// that assert it. Exact ids only — the coverage evaluator already refuses to
// let a nearby passing case cover an absent one, and this table must not
// smuggle that back in by mapping an action to a row that merely sounds like
// it.
//
// An action with nothing to point at says so, with the reason — and says WHICH
// KIND of nothing, because the two are not the same thing:
//
//   `{ noControl: '…' }`   the product has no such control. The contract asks
//                          for an action that cannot be performed, so the
//                          honest record is `unsupported` with a reason — which
//                          is what the plan asks for by name, not a gap.
//   `{ unresolved: '…' }`  a gap. The action is possible and nothing asserts it.
//
// Folding those together made the catalogue permanently incomplete for reasons
// no amount of work could fix, which is a flag nobody can act on.
//
// A mapping may cross surfaces when the row genuinely asserts the action —
// L05's "peer moves the active canvas" IS L04's move-with-open-receivers, and
// duplicating the row to satisfy a table would be worse than pointing at it.

/** @type {Record<string, Record<string, string[] | { unresolved: string }>>} */
export const REQUIREMENT_COVERAGE = {
  L01: {
    create: ['L01.empty-folder.create'],
    'rename when implemented': ['L01.empty-folder.rename'],
    'move into another folder': ['L01.empty-folder.move'],
    delete: ['L01.empty-folder.delete'],
  },
  L02: {
    'create nested hierarchy': ['L02.nested.create'],
    'move hierarchy': ['L02.nested.move'],
    'rename when implemented': ['L02.nested.rename'],
    'delete subtree': ['L02.nested.delete-subtree'],
  },
  L03: {
    create: ['L03.file.create'],
    edit: ['L03.file.edit'],
    move: ['L03.file.move'],
    'rename when implemented': ['L03.file.rename'],
    delete: ['L03.file.delete'],
  },
  L04: {
    create: ['L04.canvas.create.tree', 'L04.canvas.open-and-render'],
    duplicate: ['L04.canvas.duplicate'],
    rename: ['L04.canvas.rename'],
    'move across folders': ['L04.canvas.move-with-open-receivers'],
    remove: ['L04.canvas.delete-independent', 'L04.canvas.delete-with-open-receivers'],
  },
  L05: {
    // The receivers in these two rows have the canvas OPEN — which is what
    // this surface is about. The row lives under L04 because that is where the
    // lifecycle operation is driven from.
    'peer moves active canvas': ['L04.canvas.move-with-open-receivers'],
    'peer deletes active canvas': ['L04.canvas.delete-with-open-receivers'],
    'switch away/back': ['L05.switch-away-and-back', 'L05.reclick-active-canvas'],
    'reopen after restart': ['L05.reopen-after-restart'],
  },
  L06: {
    'valid text source save': ['L06.external-save'],
    'atomic editor save': ['L06.atomic-editor-save'],
    'UI text edit': ['L06.ui-text-edit'],
    'CSS/property edit': ['L06.css-property-edit'],
    'attribute edit': ['L06.attribute-edit'],
  },
  L07: {
    insert: ['L07.element.insert'],
    duplicate: ['L07.element.duplicate'],
    'move/reorder': ['L07.element.move-reorder'],
    resize: ['L07.element.resize'],
    // An element's content and properties are edited through exactly the
    // inspector paths L06 drives; there is no second element-only editor.
    'edit content/property': ['L06.ui-text-edit', 'L06.css-property-edit', 'L06.attribute-edit'],
    delete: ['L07.element.delete'],
  },
  L08: {
    add: ['L08.artboard.add'],
    'rename/title': ['L08.artboard.rename'],
    move: ['L08.artboard.move'],
    resize: ['L08.artboard.resize'],
    reorder: {
      noControl:
        'no artboard reorder control is exposed — order follows layout position, which L08.artboard.move changes. Pointing this at that row would claim a control the product does not have.',
    },
    remove: ['L08.artboard.remove'],
  },
  L09: {
    'create each exposed tool type': [
      'L09.sticky.create',
      'L09.text.create',
      'L09.section.create',
      'L09.pen.create',
      'L09.highlighter.create',
      'L09.arrow.create',
      'L09.shape-square.create',
      'L09.shape-rounded.create',
      'L09.shape-circle.create',
      'L09.shape-diamond.create',
      'L09.shape-triangle.create',
      'L09.shape-triangle-down.create',
    ],
    'select/move/resize': [
      'L09.sticky.move',
      'L09.sticky.resize',
      'L09.text.move',
      'L09.text.resize',
      'L09.section.move',
      'L09.section.resize',
      'L09.pen.move',
      'L09.pen.resize',
      'L09.highlighter.move',
      'L09.highlighter.resize',
      'L09.arrow.move',
      'L09.arrow.resize',
      'L09.shape-square.move',
      'L09.shape-square.resize',
      'L09.shape-rounded.move',
      'L09.shape-rounded.resize',
      'L09.shape-circle.move',
      'L09.shape-circle.resize',
      'L09.shape-diamond.move',
      'L09.shape-diamond.resize',
      'L09.shape-triangle.move',
      'L09.shape-triangle.resize',
      'L09.shape-triangle-down.move',
      'L09.shape-triangle-down.resize',
      'L09.selection-align.left',
      'L09.selection-align.right',
      'L09.selection-align.top',
      'L09.selection-align.bottom',
      'L09.selection-align.h-center',
      'L09.selection-align.v-center',
      'L09.selection-align.dist-h',
      'L09.selection-align.dist-v',
    ],
    'edit available style/text': [
      'L09.sticky.edit-text',
      'L09.sticky.paper-color',
      'L09.text.edit-text',
      'L09.section.edit-text',
      'L09.context-control.bold',
      'L09.context-control.italic',
      'L09.context-control.underline',
      'L09.context-control.strikethrough',
      'L09.context-control.color',
      'L09.context-control.no-fill',
      'L09.context-control.font-size',
      'L09.context-control.custom-font-size-in-pixels',
      'L09.context-control.bulleted-list',
      'L09.context-control.numbered-list',
      'L09.context-control.thin-stroke',
      'L09.context-control.thick-stroke',
      'L09.context-control.dashed-line',
      'L09.context-control.swatch-target',
      'L09.context-control.group-selection',
      'L09.context-control.ungroup-selection',
      'L09.text-align.left',
      'L09.text-align.center',
      'L09.text-align.right',
      'L09.arrow-head.none',
      'L09.arrow-head.line',
      'L09.arrow-head.triangle',
      'L09.arrow-head.triangle-outline',
      'L09.arrow-head.circle',
      'L09.arrow-head.diamond',
      'L09.arrow-head.start-diamond',
      'L09.arrow-line.straight',
      'L09.arrow-line.curved',
      'L09.arrow-line.elbow',
    ],
    delete: [
      'L09.sticky.delete',
      'L09.text.delete',
      'L09.section.delete',
      'L09.pen.delete',
      'L09.highlighter.delete',
      'L09.arrow.delete',
      'L09.shape-square.delete',
      'L09.shape-rounded.delete',
      'L09.shape-circle.delete',
      'L09.shape-diamond.delete',
      'L09.shape-triangle.delete',
      'L09.shape-triangle-down.delete',
      'L09.eraser.erase-stroke',
      'L09.context-control.delete-selected-annotations',
    ],
    undo: [
      'L09.sticky.undo-delete',
      'L09.text.undo',
      'L09.section.undo',
      'L09.pen.undo',
      'L09.highlighter.undo',
      'L09.arrow.undo',
      'L09.eraser.undo',
      'L09.shape-square.undo',
      'L09.shape-rounded.undo',
      'L09.shape-circle.undo',
      'L09.shape-diamond.undo',
      'L09.shape-triangle.undo',
      'L09.shape-triangle-down.undo',
    ],
    redo: [
      'L09.sticky.redo-delete',
      'L09.text.redo',
      'L09.section.redo',
      'L09.pen.redo',
      'L09.highlighter.redo',
      'L09.arrow.redo',
      'L09.eraser.redo',
      'L09.shape-square.redo',
      'L09.shape-rounded.redo',
      'L09.shape-circle.redo',
      'L09.shape-diamond.redo',
      'L09.shape-triangle.redo',
      'L09.shape-triangle-down.redo',
    ],
  },
  L10: {
    'add image sticker': ['L10.sticker.add'],
    'move/resize': ['L10.sticker.move', 'L10.sticker.resize'],
    'replace where supported': ['L10.sticker.replace'],
    remove: ['L10.sticker.remove'],
  },
  L11: {
    'create thread/pin': ['L11.comment.create'],
    reply: ['L11.comment.reply'],
    'edit owned comment': ['L11.comment.edit'],
    'resolve/reopen': ['L11.comment.resolve', 'L11.comment.reopen'],
    'delete where supported': ['L11.comment.delete'],
  },
  L12: {
    'upload/drop new image': ['L12.upload-png.create', 'L12.seeded-photo.arrival-and-decode'],
    'replace content': ['L12.upload-png.replace'],
    'move/rename supported asset path': ['L12.asset.move-rename'],
    'delete unreferenced asset': ['L12.asset.delete-unreferenced'],
  },
  L13: {
    'create from image': {
      noControl:
        'a photo canvas is created from the palette like any other canvas (L04) and then given an image; there is no separate "make a canvas from this file" control to assert.',
    },
    'crop/transform/adjust each exposed non-destructive control': [
      'L13.photo.crop-transform',
      'L13.photo.brightness',
      'L13.photo.contrast',
      'L13.photo.contrast-reset',
      'L13.photo.exposure',
      'L13.photo.exposure-reset',
      'L13.photo.saturation',
      'L13.photo.saturation-reset',
      'L13.photo.hue',
      'L13.photo.hue-reset',
      'L13.photo.grayscale',
      'L13.photo.grayscale-reset',
      'L13.photo.sepia',
      'L13.photo.sepia-reset',
      'L13.photo.invert',
      'L13.photo.invert-reset',
      'L13.photo.reset-adjustments',
      'L13.photo-control.duotone-on',
      'L13.photo-control.duotone-off',
      'L13.photo-control.duotone-intensity',
      'L13.photo-control.grain-on',
      'L13.photo-control.grain-off',
      'L13.photo-control.grain-amount',
      'L13.photo-control.grain-size',
      'L13.photo-control.pattern-on',
      'L13.photo-control.pattern-off',
      'L13.photo-control.pattern-scale',
      'L13.photo-control.pattern-opacity',
      'L13.photo-control.mask-strength',
      'L13.pattern-type.dots',
      'L13.pattern-type.lines',
      'L13.pattern-type.grid',
      'L13.pattern-type.diagonal',
      'L13.pattern-type.crosshatch',
      'L13.pattern-blend.normal',
      'L13.pattern-blend.multiply',
      'L13.pattern-blend.screen',
      'L13.pattern-blend.overlay',
      'L13.pattern-blend.soft-light',
      'L13.mask-preset.none',
      'L13.mask-preset.vignette',
      'L13.mask-preset.edge-fade',
      'L13.mask-preset.radial-reveal',
    ],
    'move/resize': ['L13.photo.move-keeps-edit'],
    // Selecting the rendered image and pressing Backspace IS removing the
    // instance; the row lives under L12 because that is where the photo was
    // put on the canvas in the first place.
    'remove instance': ['L12.upload-png.remove-reference'],
    'undo/redo': ['L13.photo.undo', 'L13.photo.redo'],
  },
  L14: {
    'upload/drop real video': [
      'L14.upload-video.create',
      'L14.upload-video.play-and-seek',
      'L14.seeded-video.play-and-seek',
    ],
    replace: ['L14.upload-video.replace'],
    'move/rename supported path': ['L14.asset.move-rename'],
    'remove instance': ['L14.upload-video.remove-reference'],
    'delete unreferenced asset': ['L14.asset.delete-unreferenced'],
  },
  L15: {
    'create/open composition': ['L15.video.create', 'L15.timeline.open'],
    'insert clip': ['L15.timeline.insert', 'L15.timeline.split'],
    'move/reorder clip': ['L15.timeline.move'],
    trim: ['L15.timeline.trim'],
    'change exposed persistent clip properties': ['L15.timeline.clip-property'],
    'delete clip': ['L15.timeline.delete'],
    'undo/redo': ['L15.timeline.undo', 'L15.timeline.redo'],
  },
  L16: {
    'create/edit/remove specimen': [
      'L16.specimen.create',
      'L16.specimen.edit',
      'L16.specimen.remove',
    ],
    'edit CSS/token/module': ['L16.ds-token.edit', 'L16.module.edit'],
    'move dependency with reference update': ['L16.dependency.move-refused'],
  },
  L17: {
    'reference same asset from two canvases/sticker': ['L17.shared-asset.two-references'],
    'remove one instance': ['L17.shared-asset.remove-one-instance'],
    'rename/move with refs': ['L17.in-use-asset.rename-refused'],
    'attempt delete of in-use asset': ['L17.in-use-asset.delete-refused'],
  },
  L18: {
    'one action': ['L18.gesture-group'],
    'gesture group': ['L18.gesture-group', 'L18.gesture-group.undo'],
    'AI multi-file group': ['L18.ai.multi-file-group'],
    'peer interleaving': ['L18.css-undo.peer-value-kept'],
    'undo/redo': ['L18.history.undo-own-keeps-teammate', 'L18.css-undo.own-value'],
    'preview/restore old revision': ['L18.history.restore'],
  },
  L19: {
    join: ['L19.presence.join'],
    'move cursor/select': ['L19.cursor.move', 'L19.selection.shown'],
    'leave/reconnect': ['L19.presence.leave', 'L19.presence.reconnect'],
    'local camera change': ['L19.camera.stays-local'],
  },
  L20: {
    'disconnect one desktop': ['L20.offline.edit-then-catch-up'],
    'mutate each persistent surface': {
      unresolved:
        "the offline row mutates three of them, each travelling differently: the canvas source, an annotation the peer DRAWS with the sticky tool while cut off (a raw sidecar write is not an import path — that file is a projection of the canvas document's annotations lane), and an asset through the file plane, all checked on every copy after the reconnect. Comments, photo and timeline are still not mutated offline.",
    },
    restart: ['L20.restart.catch-up'],
    'peer edits': ['L20.offline.edit-then-catch-up'],
    reconnect: ['L20.offline.edit-then-catch-up'],
    'open fresh third copy': ['L20.fresh-third-copy'],
  },
  L21: {
    'independent edits': ['L21.independent-edits'],
    'same target': ['L21.same-property-race'],
    'folder/canvas move during edit': ['L21.move-during-edit', 'L21.folder-move-during-edit'],
    'delete versus edit': ['L21.delete-versus-edit'],
    'multi-file AI publish/abort': ['L21.ai.abort-publish', 'L21.ai.abort-discard'],
  },
  L22: {
    'pending edits': {
      unresolved:
        'the pending-then-delivered state is asserted in the native team-project lane (server away, and a project switch with work queued), not by a surface row here.',
    },
    'blocked file': ['L22.blocked-file'],
    'invalid candidate': ['L22.invalid-candidate.held'],
    'auth expiry': {
      unresolved:
        'no single surface row expires a credential; the path is pinned hop by hop instead. The hub refuses an expired credential exactly as it refuses an unknown one (tokens.test.mjs), words that refusal so the peer files it as permanent (auth-reasons.test.mjs), the peer routes it to the sign-in-again state (sync-runtime.test.ts), and the real shell shows that state (team-project.e2e.ts step 8). Every hop is held; nothing walks all four in one stimulus.',
    },
    'unavailable storage': ['L22.unavailable-storage'], // and its recovery, below
    // The storage row is the whole arc: the disk refuses, the status bar
    // refuses to read complete, the panel names the file — and then the disk
    // takes writes again and the row waits for the bytes to land on every
    // copy, hash-checked, timing the recovery.
    'successful recovery': ['L22.unavailable-storage'],
  },
  L23: {
    'edit canvas/annotations/comments continuously while photos/videos seed': ['L23.mixed-session'],
    'move/delete assets safely': ['L23.assets.move-and-delete-during-edits'],
    // The soak switches a participant away to a second canvas and back every
    // fourth edit, under exactly the load this surface is about — "the canvas
    // must stay live for them", in the row's own words.
    'switch canvases': ['L23.mixed-session'],
  },
  L24: {
    'fresh app/browser reopen': ['L24.fresh-reopen'],
    'full eligible inventory compare': ['L24.final-parity'],
    'timed mixed-workload soak': ['L23.mixed-session'],
    'final deletion reconciliation': ['L24.final-parity'],
  },
};

/** Every row id this table points at, deduplicated. */
export function mappedRowIds() {
  const out = new Set();
  for (const actions of Object.values(REQUIREMENT_COVERAGE))
    for (const value of Object.values(actions))
      if (Array.isArray(value)) for (const id of value) out.add(id);
  return out;
}

/** Actions that are possible and that nothing asserts — the real gaps. */
export function unresolvedRequirements() {
  const out = [];
  for (const [surface, actions] of Object.entries(REQUIREMENT_COVERAGE))
    for (const [action, value] of Object.entries(actions))
      if (!Array.isArray(value) && value.unresolved)
        out.push({ surface, action, reason: value.unresolved });
  return out;
}

/** Actions the product has no control for — `unsupported`, with the reason. */
export function unsupportedRequirements() {
  const out = [];
  for (const [surface, actions] of Object.entries(REQUIREMENT_COVERAGE))
    for (const [action, value] of Object.entries(actions))
      if (!Array.isArray(value) && value.noControl)
        out.push({ surface, action, reason: value.noControl });
  return out;
}
