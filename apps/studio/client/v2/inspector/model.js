// client/v2/inspector/model.js — S2.2: the inspector frame's pure parts (no DOM, no React, no fetch).
//
//   titleOf / crumbsOf   the name and the path above it ("Desktop › Nav › Book a call")
//   tokensUsed           the design-system tokens an element's CSS refers to
//   cssTextOf            Copy CSS: the declarations the element carries, never a canvas-only attribute
//   validateElementId    the id rule of V2-1.4 §5.5, said in plain words

import { tagWord } from '../../../editing/crumbs.ts';
import { isArtboardSelection, kindChipOf, singleOf } from './kinds/index.js';

/** "div", "h1.dc-text-editing", "button.cta" — a tag with classes, i.e. the CSS selector the tree fell back to. */
const DOTTED_SELECTOR = /^[a-z][a-z0-9-]*[.#][\w.#-]+$/;
// a name the designer typed ("hero") stays a name; the node's own tag, or tag.class, is not one
const isSelectorLabel = (label, tag) =>
  DOTTED_SELECTOR.test(label) || (!!tag && label === String(tag).toLowerCase());

const collapse = (t) =>
  String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** The Figma frame name a pasted picture carries (`data-source="figma"` + `data-source-name`), else ''. */
const figmaNameOf = (el) =>
  el?.attrs?.['data-source'] === 'figma' ? collapse(el.attrs['data-source-name']) : '';

function findNode(nodes, id, index, trail = []) {
  for (const n of nodes || []) {
    if (n.id === id && (index == null || n.index === index)) return { node: n, trail };
    if (n.children?.length) {
      const hit = findNode(n.children, id, index, [...trail, n]);
      if (hit) return hit;
    }
  }
  return null;
}

/** The name above the rows: the layer's name, else the element's own text, else its tag. */
export function titleOf(selection, layersTree) {
  if (Array.isArray(selection) && selection.length > 1) {
    // S2.9 — "4 artboards" when every one is a board
    const boards = selection.every((el) => isArtboardSelection(el));
    return `${selection.length} ${boards ? 'artboards' : 'objects'}`;
  }
  const el = singleOf(selection);
  if (!el) return '';
  if (isArtboardSelection(el))
    return (
      collapse(el.attrs?.['data-dc-label']) ||
      el.artboardId ||
      el.attrs?.['data-dc-screen'] ||
      'Artboard'
    );
  // S10.7 — a token of the Design system canvas is named by the designer's label (data-ds-label)
  // (S10.10: a component master the same way)
  const token = collapse(
    el.attrs?.['data-ds-token'] || el.attrs?.['data-ds-master'] ? el.attrs['data-ds-label'] : ''
  );
  if (token) return token;
  // 14 · ed-edge-paste: a picture pasted from Figma carries the frame's name ("Hero / v3"), not its file name
  const fromFigma = figmaNameOf(el);
  if (fromFigma) return fromFigma;
  const hit = el.id ? findNode(layersTree?.nodes, el.id, el.index) : null;
  // the Layers tree labels an unnamed node by its selector ("h1.dc-text-editing", "div.__remotion-player"): a
  // label that is the tag's own selector is no name at all
  const label = collapse(hit?.node?.label);
  if (label && !isSelectorLabel(label, hit?.node?.tag)) return label;
  const text = collapse(el.text);
  // V2-8.5 c3 (14 R4) — a FRAME's text is everything inside it, glued ("Brand systems Logos, ty…"): it is named by
  // its own words, the same rung the breadcrumb ends on, else the kind word
  if (text && kindChipOf(el) === 'Frame' && Array.isArray(el.crumbs)) {
    const own = collapse(el.crumbs[el.crumbs.length - 1]?.label);
    if (own) return clip(own, 48);
  } else if (text) return clip(text, 48);
  // V2-8.5 C2 (14 R4) — the kind word, never "div" / "h1.dc-text-editing"
  return tagWord(el.tag || 'div');
}

/** Artboard, then each ancestor, then the element. [] when the tree has not got it (never invented). */
export function crumbsOf(layersTree, el) {
  if (!el || Array.isArray(el) || !el.id) return [];
  const hit = findNode(layersTree?.nodes, el.id, el.index);
  if (!hit) return [];
  const trail = [...hit.trail, hit.node].map((n) => {
    if (n === hit.node && figmaNameOf(el)) return figmaNameOf(el);
    const label = collapse(n.label);
    return label && !isSelectorLabel(label, n.tag) ? label : tagWord(n.tag || 'div');
  });
  return [layersTree.artboardId, ...trail].filter(Boolean);
}

/**
 * Where an object sits among its frame's children: "Set by Services · 2 of 3" (14 Editing, ed-obj-enter). `parent` is
 * the frame's name by the same rule the crumbs use; `index` / `count` count the frame's element children and stay
 * null when the tree does not know the object (never invented).
 * @returns {{ parent: string | null, index: number | null, count: number | null }}
 */
export function placementOf(layersTree, el) {
  const none = { parent: null, index: null, count: null };
  if (!el || Array.isArray(el) || !el.id) return none;
  const hit = findNode(layersTree?.nodes, el.id, el.index);
  if (!hit) return none;
  const frame = hit.trail[hit.trail.length - 1];
  if (!frame) return none;
  const label = collapse(frame.label);
  const siblings = (frame.children || []).filter((n) => n?.tag);
  const at = siblings.indexOf(hit.node);
  return {
    parent:
      label && !isSelectorLabel(label, frame.tag) ? clip(label, 24) : tagWord(frame.tag || 'div'),
    index: at >= 0 ? at + 1 : null,
    count: at >= 0 ? siblings.length : null,
  };
}

/** Every id the layers tree knows, other than this element's own occurrences. */
export function takenIds(layersTree, ownId) {
  const out = new Set();
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n.id && n.id !== ownId && !n.synthetic) out.add(n.id);
      if (n.children?.length) walk(n.children);
    }
  })(layersTree?.nodes);
  return out;
}

export const humanToken = (name) => {
  const words = name.replace(/^--/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The tokens the element's CSS refers to — once each, in the order they are first used. */
export function tokensUsed(el) {
  const seen = new Set();
  const out = [];
  for (const map of [el?.authored, el?.customStyles]) {
    for (const value of Object.values(map || {})) {
      for (const m of String(value).matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ name: m[1], label: humanToken(m[1]) });
      }
    }
  }
  return out;
}

const declarations = (el) => [
  ...Object.entries(el?.authored || {}),
  ...Object.entries(el?.customStyles || {}),
];

/** Copy CSS: `prop: value;` lines. Canvas-only (`data-cd-*`) names never appear in a copy. */
export function cssTextOf(el) {
  return declarations(el)
    .filter(([k]) => !k.startsWith('data-cd-'))
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n');
}

/** How many properties the element carries — the Advanced row's count. */
export function propertyCount(el) {
  return declarations(el).filter(([k]) => !k.startsWith('data-cd-')).length;
}

// The server's rule (element-ids.ts ELEMENT_ID_RE / ELEMENT_ID_MAX / COMPUTED_ID_RE); the model test holds
// the two equal, because the shell cannot import the server module.
export const ELEMENT_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const ELEMENT_ID_MAX = 48;
export const COMPUTED_ID_RE = /^[0-9a-f]{8}$/;

/** A computed id (8 hex) is transient — shown as a placeholder, not offered as a name. */
export function hasUsableId(el) {
  return typeof el?.id === 'string' && el.id !== '' && !COMPUTED_ID_RE.test(el.id);
}

/**
 * The id field's check, before anything is written. `current` is the id the element has now, `taken` the
 * other ids in the canvas.
 * @returns {{ ok: true, id: string } | { ok: false, code: 'same' } | { ok: false, code: 'invalid' | 'taken', message: string }}
 */
export function validateElementId(raw, current, taken) {
  const id = String(raw ?? '').trim();
  if (id === current) return { ok: false, code: 'same' };
  if (!id || id.length > ELEMENT_ID_MAX || !ELEMENT_ID_RE.test(id)) {
    return {
      ok: false,
      code: 'invalid',
      message: `An id uses lower-case letters, numbers and dashes, starts with a letter, and stays under ${ELEMENT_ID_MAX + 1} characters.`,
    };
  }
  if (taken?.has(id)) {
    return {
      ok: false,
      code: 'taken',
      message: `“${id}” is already another element’s id. Pick a different one.`,
    };
  }
  return { ok: true, id };
}
