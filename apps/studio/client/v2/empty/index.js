// client/v2/empty/index.js — S11.1: THE EMPTY KIT. One look and one voice for every place that starts with
// nothing (05 Empty States, 20 artboards, six packages). Other packages IMPORT this barrel — they never copy
// the markup, the spot art or the words.
//
// Exports
//   Empty({ size: 'panel'|'canvas', spot?, quiet?, land?, title, next?, chips?, actions?, foot?, align? })
//       the block: spot art (or a glyph) · the situation · what to do · chips · AT MOST ONE action · a fine
//       foot line. Also takes `copyId` + `vars` to read all of it from the copy table, `glyph`, `spotW`,
//       `onPickChip`. Rules it enforces: no button when there is nothing to do (a copy id in NO_DOOR —
//       vh-before-first, trash-empty, shared-none — drops `actions`); only the person's words and the
//       tokens; the spot lands (spring) only when `land` is set.
//   Spot({ name: 'canvas'|'ai'|'none'|'comment'|'image'|'done'|'offline'|'trash', w, quiet, land })
//       the spot art, drawn with the draw engine, token fills only. `land` plays the DS spring once on the
//       notes (reduced motion: the final frame in 1 ms). `frame` freezes it at a moment (the filmstrip).
//   AskButton({ children, keys, onClick })   azure, the spark in the button's own colour — the AI is next.
//   Suggestions({ items, onPick? })          chips written as things you'd say.
//   Confetti({ id, shift? })                 the ONE celebration; imported only from client/v2/comments/.
//   SkeletonArtboard({ label, kind, x, y, w, h }) · ArrivingRow({ name, depth, folder, count, meta })
//                                            "arriving is not empty": names always shown, shapes pulsing.
//   copy(id, vars)                           the 05 words by id (`<artboard>.<part>`, e.g.
//                                            `es-panels-canvas.comments-none`); `{vars}` filled, a missing
//                                            one throws. COPY / NO_DOOR / copyIds() are exported too.
//
// Styles: ./empty.css (imported once from client/styles/_index.css). Classes are `es-*`, the canvas's own.

// S11.4 — the arriving / not-on-this-Mac provider (Canvases panel ghost rows + foot) and the card.
export {
  arrivingSlots,
  setShowLocalOnly,
  showLocalOnly,
  useArrivingRows,
} from './arriving.jsx';
export { AskButton } from './ask-button.jsx';
export { NotLocalCanvas, useCanvasAvailability } from './not-local.jsx';
export { Confetti } from './confetti.jsx';
export { COPY, copy, copyIds, NO_DOOR } from './empty-copy.js';
export { Empty, Glyph, rich } from './empty.jsx';
export { ArrivingRow, SkeletonArtboard } from './skeleton.jsx';
export { FRAMES, pose, Spot, springAt } from './spot.jsx';
export { Suggestions } from './suggestions.jsx';
