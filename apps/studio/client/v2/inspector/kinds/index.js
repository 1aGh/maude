// client/v2/inspector/kinds/index.js — S2.2: the kind chip beside the name (14 Editing, ed-inspector).
//
// APPEND-ONLY: a later slice (S2.13 shapes, S2.14 paths, S2.17 instances) calls `registerKind` from its
// own file; nothing here is edited. Resolution is by `order` (lowest first, ties by registration), and the
// last entry is the fallback that matches everything — a Frame.
//
// The chip says what is selected, in CONTRACT words:
//   · an ARTBOARD shows its artboard kind (C16): Web page · Fixed size · Print · Video;
//   · an object shows what it is: Button · Text · Image · Frame (and Shape · Path · Instance once their
//     slices register them);
//   · several objects are Mixed.
// Height mode is a row in the artboard's editor, never a chip.

/** `data-dc-kind` (DCArtboard's resolved kind) → the chip. `digital` is the implicit default. */
export const ARTBOARD_KIND_CHIPS = Object.freeze({
  web: 'Web page',
  digital: 'Fixed size',
  print: 'Print',
  video: 'Video',
});

/** The id of the kind nothing else claims. */
export const KIND_FALLBACK = 'frame';

/** @type {Array<{ id: string, label: string | ((s: any) => string), order: number, match: (s: any) => boolean, seq: number }>} */
const kinds = [];
let seq = 0;

/**
 * @param {{ id: string, label: string | ((selection: any) => string), match: (selection: any) => boolean, order?: number }} kind
 *   `match` gets the selection as the panel holds it: one element, or an array of them. `order` defaults to 100;
 *   the built-ins sit between 10 and 90, the fallback at 1000.
 * @returns {() => void} unregister (tests, hot reload)
 */
export function registerKind(kind) {
  if (!kind || typeof kind.id !== 'string' || !kind.id)
    throw new Error('registerKind: id required');
  if (kinds.some((k) => k.id === kind.id)) throw new Error(`kind "${kind.id}" already registered`);
  const entry = {
    id: kind.id,
    label: kind.label,
    match: kind.match,
    order: Number.isFinite(kind.order) ? kind.order : 100,
    seq: seq++,
  };
  kinds.push(entry);
  kinds.sort((a, b) => a.order - b.order || a.seq - b.seq);
  return () => {
    const i = kinds.indexOf(entry);
    if (i >= 0) kinds.splice(i, 1);
  };
}

const asList = (selection) => (Array.isArray(selection) ? selection : selection ? [selection] : []);

/** The one element a selection stands for (a one-element array is that element); null when several or none. */
export function singleOf(selection) {
  const list = asList(selection);
  return list.length === 1 ? list[0] : null;
}

/** The kind entry that claims this selection. */
export function resolveKind(selection) {
  for (const k of kinds) {
    if (k.match(selection)) return k;
  }
  // unreachable while the fallback is registered; never throw from a render
  return kinds[kinds.length - 1];
}

/** The chip text for this selection. */
export function kindChipOf(selection) {
  const k = resolveKind(selection);
  if (!k) return '';
  return typeof k.label === 'function' ? k.label(selection) : k.label;
}

const ARTBOARD_SELECTOR = /^\[data-dc-screen="[^"]+"\]$/;
/** A whole-artboard selection has no element id; its selector names the screen. */
export function isArtboardSelection(el) {
  if (!el || Array.isArray(el)) return false;
  if (el.id) return false;
  return ARTBOARD_SELECTOR.test(el.selector || '') || !!el.artboardId;
}

const TEXT_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'span',
  'label',
  'li',
  'blockquote',
  'figcaption',
  'em',
  'strong',
  'small',
  'a',
]);

// ── the built-ins ──────────────────────────────────────────────────────────────────────────
registerKind({
  id: 'multi',
  label: 'Mixed',
  order: 10,
  match: (s) => Array.isArray(s) && s.length > 1,
});
registerKind({
  id: 'artboard',
  order: 20,
  label: (s) => {
    const el = singleOf(s);
    return (
      ARTBOARD_KIND_CHIPS[el?.attrs?.['data-dc-kind'] || 'digital'] ?? ARTBOARD_KIND_CHIPS.digital
    );
  },
  match: (s) => isArtboardSelection(singleOf(s)),
});
registerKind({
  id: 'image',
  label: 'Image',
  order: 30,
  match: (s) => {
    const el = singleOf(s);
    return !!el && ((el.tag || '').toLowerCase() === 'img' || !!el.photoAsset);
  },
});
registerKind({
  id: 'button',
  label: 'Button',
  order: 40,
  match: (s) => {
    const el = singleOf(s);
    return !!el && ((el.tag || '').toLowerCase() === 'button' || el.attrs?.role === 'button');
  },
});
registerKind({
  id: 'text',
  label: 'Text',
  order: 50,
  match: (s) => {
    const el = singleOf(s);
    return !!el && TEXT_TAGS.has((el.tag || '').toLowerCase()) && !!String(el.text || '').trim();
  },
});
registerKind({ id: KIND_FALLBACK, label: 'Frame', order: 1000, match: () => true });
