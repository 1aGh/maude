// client/v2/left-panel/advanced-model.js — S11.9: the words and rules of the left panel's two Advanced folds
// (06 · ad-left), kept out of the components so they can be pinned without a DOM.
//
// Canvases › Advanced: "updated just now" after the count, the project folder row.
// Layers › Advanced: the counts line and the select-by-selector field (what a typed selector may be).

/** "just now" · "2 min ago" · "3 h ago" — how long ago the tree was last read. */
export function updatedWord(now, at) {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return 'updated just now';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'updated just now';
  const m = Math.round(s / 60);
  if (m < 60) return `updated ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `updated ${h} h ago`;
  return 'updated a while ago';
}

/** The project folder a diagnostics answer names, or '' (a cloud tab has none — the row is then absent). */
export function folderOf(facts) {
  const f = facts?.folder;
  return typeof f === 'string' ? f : '';
}

/** `system/<name>` — the design system's folder under the design root (06: "Design system system/alligators"). */
export const dsFolderLabel = (name) => (name ? `system/${name}` : '');

// ── Layers › Advanced ───────────────────────────────────────────────────────────────────────────────────

/** A selector longer than this is not one a person typed; the field refuses it before it is sent. */
export const SELECTOR_MAX_LEN = 200;
/** The most elements one selector selects (scoped, then capped). */
export const SELECT_CAP = 500;

export const SELECTOR_WORDS = Object.freeze({
  long: `A selector is ${SELECTOR_MAX_LEN} characters or fewer.`,
  invalid: 'That isn’t a valid selector.',
  none: 'Nothing matched.',
  capped: `Selected the first ${SELECT_CAP}.`,
  placeholder: 'section#hero a',
});

/** The browser's own selector parser, on an empty fragment: throws a SyntaxError on a bad selector. */
export function parseSelector(selector) {
  const frag = globalThis.document?.createDocumentFragment?.();
  if (!frag) return;
  frag.querySelector(selector);
}

/**
 * What ↵ in the selector field does with `text`.
 *   { kind: 'empty' }                      nothing typed — send nothing
 *   { kind: 'error', error }               refuse inline, nothing is sent
 *   { kind: 'select', selector }           send `selector` to the canvas
 * `parse(selector)` throws on invalid syntax; it is injected so the rule is testable without a DOM.
 */
export function checkSelector(text, parse = parseSelector) {
  const selector = String(text ?? '').trim();
  if (!selector) return { kind: 'empty' };
  if (selector.length > SELECTOR_MAX_LEN) return { kind: 'error', error: SELECTOR_WORDS.long };
  try {
    parse(selector);
  } catch {
    return { kind: 'error', error: SELECTOR_WORDS.invalid };
  }
  return { kind: 'select', selector };
}

/** Total layers in a layers tree (`{ nodes: [{ children }] }`), synthetic groups not counted. */
export function countLayers(tree) {
  let n = 0;
  const walk = (list) => {
    for (const node of list || []) {
      if (!node.synthetic) n++;
      if (node.children?.length) walk(node.children);
    }
  };
  walk(tree?.nodes);
  return n;
}

/** The "On this canvas" line: "15 artboards · 214 layers" (a part it does not know yet is left out). */
export function countsLine({ artboards, layers } = {}) {
  const parts = [];
  if (Number.isFinite(artboards) && artboards >= 0)
    parts.push(artboards === 1 ? '1 artboard' : `${artboards} artboards`);
  if (Number.isFinite(layers) && layers > 0)
    parts.push(layers === 1 ? '1 layer' : `${layers} layers`);
  return parts.join(' · ');
}

/** `section · cd-91be07` — what "Show tags and ids" prints after a layer's name. */
export function tagLabel(node) {
  if (!node || node.synthetic) return '';
  const tag = typeof node.tag === 'string' ? node.tag.toLowerCase() : '';
  const id = typeof node.id === 'string' ? node.id : '';
  return [tag, id].filter(Boolean).join(' · ');
}
