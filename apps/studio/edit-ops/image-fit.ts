// edit-ops/image-fit.ts — `image.place` and `image.replace` (S2.15, ed-img: "drop a photo on a frame and it fills it").
//
// `placeAsset` is the one request S8's Assets tab (↵ / drag), Generate and a Finder drop make (S8-slices § cross-lane
// contracts): `image.place { asset | assets, mode, artboard?, natural?, alt?, from? }` with `targets[0]` the frame (or
// picture) it lands on. The canvas, the shell and an agent all end in this write: one request, one file write, one undo.
//
//   mode 'fill'          the picture fills the frame, cropped to fit (object-fit: cover). On a frame that already holds
//                        ONE picture (or on the picture itself) the source is swapped and the box, the fit and the crop
//                        stay — "dragging onto MVP zápasu replaces its photo". On the artboard it is the first child,
//                        absolute, inset 0 — a picture behind the content.
//   mode 'loose'         in the flow, last child, at its natural width capped at the container (`natural` = {w, h} px).
//   mode 'fill-in-order' the n-th picture inside the target takes the n-th asset; the rest are placed loose, after.
//   mode 'grid'          one `display: grid` wrapper (ceil(sqrt(n)) columns, a space gap) with a square, cropped picture each.
//   mode 'auto'          (S8.14, a drop from Finder) the server picks with edit-ops/place-plan.ts: the target's EMPTY pictures
//                        (an <img> with no src) fill in order, else several pictures go in a tidy grid, else one is put in
//                        loose (on a frame it fills it). `emptyOnly: true` makes 'fill-in-order' take only empty pictures
//                        and report every slot it filled in `created` (the drop selects them).
//
// What is written is plain TSX any v1 peer reads: an `<img src="assets/<sha8>.<ext>" alt="" style={{…}} />` with a fresh
// readable `data-cd-id`. `from: {name}` (a Figma paste) adds the inert `data-source="figma"` / `data-source-name`.
// A swapped source drops `data-photo-edit` / `data-photo-asset`: a per-use edit belongs to the picture it was made on.
// Refused (nothing written): a path that is not `assets/<flat-name>` (no `..`, no scheme), an unknown mode, more than
// 50 assets, a size that is not a positive number, a locked picture, a source the file computes.
//
// Same result by hand: `canvas-tsx.md` § "Place, replace and crop an image".

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { applyEdit, applyRemove, readAttributeState } from '../canvas-edit.ts';
import {
  generateElementId,
  type IdElement,
  insertIds,
  usedIds,
  walkIdElements,
} from '../element-ids.ts';
import { refuse } from './constraints.ts';
import { type PlaceTargetKind, planPlacement } from './place-plan.ts';
import { lineIndent, siblingModel } from './siblings.ts';
import type { EditOp, ElementRef, ResolvedEditOp } from './types.ts';

// 'auto' (S8.14): the server picks — empty frames fill in order, else a tidy grid, else loose (edit-ops/place-plan.ts)
export const PLACE_MODES = ['fill', 'fill-in-order', 'grid', 'loose', 'auto'] as const;
export type PlaceMode = (typeof PLACE_MODES)[number];
export const MAX_ASSETS = 50;
const MAX_NATURAL = 100_000;
const MAX_ALT = 200;
const MAX_SOURCE_NAME = 120;

/** A contained project asset: `assets/<flat name>` — no `..`, no scheme, no subfolder (content-addressed names). */
export const ASSET_SRC_RE = /^assets\/[A-Za-z0-9._-]+$/;
export const isAssetSrc = (v: unknown): v is string =>
  typeof v === 'string' && ASSET_SRC_RE.test(v) && !v.includes('..');

const NOT_AN_ASSET = 'That picture is not in this project’s assets.';

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export const styleText = (style: Array<[string, string]>): string =>
  `{{ ${style.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }}`;

const attrText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── reading the walk ───────────────────────────────────────────────────────────────────────────

export interface Walked {
  elements: IdElement[];
}

export function walkOrRefuse(source: string, req: ResolvedEditOp): Walked {
  const w = walkIdElements(source, req.file);
  if (!w.ok) return refuse(req, 'This canvas does not parse; fix it before editing.');
  return { elements: w.elements };
}

/** The element `ref` names in the walk. */
export function elementOf(walk: Walked, ref: ElementRef): IdElement | undefined {
  return walk.elements.find((e) => e.id === ref.element);
}

/** A picture: an `<img>`, or a tiled picture (`data-image-tile`). */
export const isPicture = (e: IdElement): boolean =>
  e.tag === 'img' || (e.tag === 'div' && hasAttr(e, 'data-image-tile'));
const hasAttr = (e: IdElement, name: string): boolean => e.attrs.some(([k]) => k === name);

/** Stamp an element that has no authored id yet; returns the new source and the id (re-walk afterwards). */
export function stampElement(
  source: string,
  req: ResolvedEditOp,
  el: IdElement,
  tag = el.tag
): { source: string; id: string } {
  if (el.id) return { source, id: el.id };
  const walk = walkOrRefuse(source, req);
  const id = generateElementId({ tag }, usedIds(walk.elements));
  return { source: insertIds(source, [{ nameEnd: el.nameEnd, id }]), id };
}

// ── inserting a child ──────────────────────────────────────────────────────────────────────────

/**
 * Put `child` into `parent` as its last child (`end`) or its first (`start`). A self-closing parent opens up.
 * Returns the new source; the caller parse-checks.
 */
export function insertChild(
  source: string,
  req: ResolvedEditOp,
  parent: IdElement,
  child: string,
  where: 'start' | 'end' = 'end'
): string {
  const s = new MagicString(source);
  const indent = lineIndent(source, parent.start);
  const unit = indent.includes('\t') ? '\t' : '  ';
  const text = source.slice(parent.start, parent.end);
  if (text.endsWith('/>')) {
    if (!/^[a-z]/.test(parent.tag) && parent.tag !== 'DCArtboard')
      return refuse(req, 'Put it in a frame, not in a component.');
    s.overwrite(
      parent.end - 2,
      parent.end,
      `>\n${indent}${unit}${child}\n${indent}</${parent.tag}>`
    );
    return s.toString();
  }
  if (where === 'start') {
    const first = siblingModel(source, req.file).byParent.get(parent.start)?.kids[0];
    if (first) {
      const ls = source.lastIndexOf('\n', first.start - 1) + 1;
      if (/^\s*$/.test(source.slice(ls, first.start))) {
        s.appendLeft(ls, `${source.slice(ls, first.start)}${child}\n`);
      } else {
        s.appendLeft(first.start, child);
      }
      return s.toString();
    }
  }
  const close = source.lastIndexOf('</', parent.end);
  const own = /^\s*$/.test(source.slice(source.lastIndexOf('\n', close - 1) + 1, close));
  if (own) s.appendLeft(source.lastIndexOf('\n', close - 1), `\n${indent}${unit}${child}`);
  else s.appendLeft(close, child);
  return s.toString();
}

function parses(source: string, file: string): boolean {
  return !parseSync(file.endsWith('.tsx') ? file : `${file}.tsx`, source, { sourceType: 'module' })
    .errors?.length;
}

// ── params ─────────────────────────────────────────────────────────────────────────────────────

interface PlaceParams {
  assets: string[];
  mode: PlaceMode;
  /** fill-in-order takes only the EMPTY pictures (no src) and reports every slot it filled in `created` */
  emptyOnly: boolean;
  natural: { w: number; h: number } | null;
  /** P8 c8 (14 ed-edge-paste): loose on an artboard — ON its page at this artboard-local point, absolute */
  at: { x: number; y: number } | null;
  alt: string;
  from: string | null;
}

function placeParams(req: ResolvedEditOp): PlaceParams {
  const p = req.params;
  const list = Array.isArray(p.assets) ? p.assets : p.asset !== undefined ? [p.asset] : [];
  if (!list.length) return refuse(req, 'Pick a picture to place.');
  if (list.length > MAX_ASSETS) return refuse(req, `Place up to ${MAX_ASSETS} pictures at a time.`);
  for (const a of list) if (!isAssetSrc(a)) return refuse(req, NOT_AN_ASSET);
  const mode = p.mode === undefined ? 'fill' : p.mode;
  if (typeof mode !== 'string' || !(PLACE_MODES as readonly string[]).includes(mode))
    return refuse(req, 'Place it to fill, loose, in order or in a grid.');
  let natural: PlaceParams['natural'] = null;
  if (p.natural !== undefined) {
    const n = p.natural;
    if (
      !isRec(n) ||
      typeof n.w !== 'number' ||
      typeof n.h !== 'number' ||
      !Number.isFinite(n.w) ||
      !Number.isFinite(n.h) ||
      n.w <= 0 ||
      n.h <= 0 ||
      n.w > MAX_NATURAL ||
      n.h > MAX_NATURAL
    )
      return refuse(req, 'The size of that picture is not a number.');
    natural = { w: Math.round(n.w), h: Math.round(n.h) };
  }
  let at: PlaceParams['at'] = null;
  if (p.at !== undefined) {
    const a = p.at;
    if (
      !isRec(a) ||
      typeof a.x !== 'number' ||
      typeof a.y !== 'number' ||
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y) ||
      Math.abs(a.x) > MAX_NATURAL ||
      Math.abs(a.y) > MAX_NATURAL
    )
      return refuse(req, 'Where to put that picture is not a point.');
    at = { x: Math.round(a.x), y: Math.round(a.y) };
  }
  const alt = typeof p.alt === 'string' ? p.alt.slice(0, MAX_ALT) : '';
  let from: string | null = null;
  if (p.from !== undefined) {
    if (!isRec(p.from) || (p.from.name !== undefined && typeof p.from.name !== 'string'))
      return refuse(req, 'Where that picture came from is not a name.');
    from = typeof p.from.name === 'string' ? p.from.name.slice(0, MAX_SOURCE_NAME) : '';
  }
  if (p.emptyOnly !== undefined && typeof p.emptyOnly !== 'boolean')
    return refuse(req, 'Only the empty frames is a yes or no.');
  return {
    assets: list as string[],
    mode: mode as PlaceMode,
    emptyOnly: p.emptyOnly === true,
    natural,
    at,
    alt,
    from,
  };
}

// ── the new picture ────────────────────────────────────────────────────────────────────────────

type Style = Array<[string, string]>;

const FILL_STYLE: Style = [
  ['display', 'block'],
  ['width', '100%'],
  ['height', '100%'],
  ['objectFit', 'cover'],
];
const BEHIND_STYLE: Style = [
  ['position', 'absolute'],
  ['left', '0'],
  ['top', '0'],
  ['width', '100%'],
  ['height', '100%'],
  ['objectFit', 'cover'],
];

function looseStyle(natural: PlaceParams['natural']): Style {
  const s: Style = [['display', 'block']];
  if (natural) s.push(['width', `${natural.w}px`]);
  s.push(['maxWidth', '100%'], ['height', 'auto']);
  return s;
}

/** A picture placed at a point: absolute, at its natural width (a page cannot be wider than itself, so no cap). */
function atStyle(at: { x: number; y: number }, natural: PlaceParams['natural']): Style {
  const s: Style = [
    ['position', 'absolute'],
    ['left', `${at.x}px`],
    ['top', `${at.y}px`],
  ];
  if (natural) s.push(['width', `${natural.w}px`]);
  s.push(['height', 'auto']);
  return s;
}

function imgText(id: string, src: string, alt: string, style: Style, from: string | null): string {
  const origin =
    from === null
      ? ''
      : ` data-source="figma"${from ? ` data-source-name="${attrText(from)}"` : ''}`;
  return `<img data-cd-id="${id}" src="${src}" alt="${attrText(alt)}"${origin} style=${styleText(style)} />`;
}

// ── swapping a source ──────────────────────────────────────────────────────────────────────────

/** Point a picture at `asset`. Returns the new source (unchanged when it already shows that file). */
export function swapSource(
  source: string,
  req: ResolvedEditOp,
  el: IdElement,
  asset: string,
  artboard: string
): string {
  if (el.locked) return refuse(req, 'That picture is locked; unlock it first.', el.id ?? undefined);
  const stamped = stampElement(source, req, el);
  let out = stamped.source;
  const ref: ElementRef = { artboard, element: stamped.id };
  const tile = el.tag === 'div';
  const srcAttr = tile ? 'data-image-tile' : 'src';
  const state = readAttributeState(req.file, out, ref.element, srcAttr);
  if (state.kind === 'expression')
    return refuse(req, 'That picture is chosen by the code; change it there.', ref.element);
  if (state.kind === 'literal' && state.value === asset) return source;
  out = applyEdit(req.file, out, ref.element, srcAttr, asset).source;
  if (tile) {
    const bg = readAttributeState(req.file, out, ref.element, 'style.backgroundImage');
    if (bg.kind === 'expression')
      return refuse(req, 'That picture is chosen by the code; change it there.', ref.element);
    out = applyEdit(
      req.file,
      out,
      ref.element,
      'style.backgroundImage',
      JSON.stringify(`url("${asset}")`)
    ).source;
  }
  for (const a of ['data-photo-edit', 'data-photo-asset']) {
    if (readAttributeState(req.file, out, ref.element, a).kind !== 'absent')
      out = applyRemove(req.file, out, ref.element, a).source;
  }
  return out;
}

/** The pictures inside `target`, document order (the target itself excluded). */
function picturesIn(walk: Walked, target: IdElement): IdElement[] {
  return walk.elements.filter(
    (e) => e.tag === 'img' && e.start > target.start && e.end <= target.end
  );
}

/** A picture with nothing in it yet: an `<img>` with no `src` (or an empty one), not locked. */
export const isEmptyPicture = (e: IdElement): boolean => {
  if (e.tag !== 'img' || e.locked) return false;
  const src = e.attrs.find(([k]) => k === 'src');
  return !src || src[1] === '';
};

/** The empty pictures inside `target`, document order. */
export const emptyPicturesIn = (walk: Walked, target: IdElement): IdElement[] =>
  picturesIn(walk, target).filter(isEmptyPicture);

/** Direct element children of a frame, as the walk sees them. */
const kidsOf = (walk: Walked, e: IdElement): IdElement[] =>
  e.kids.map((i) => walk.elements[i]).filter((k): k is IdElement => !!k);

function containerOf(
  source: string,
  req: ResolvedEditOp
): { walk: Walked; target: IdElement; artboard: string } {
  const walk = walkOrRefuse(source, req);
  const t = req.targets[0];
  const artboardParam = req.params.artboard;
  let target: IdElement | undefined;
  if (t) target = elementOf(walk, t);
  else if (typeof artboardParam === 'string')
    target = walk.elements.find((e) => e.tag === 'DCArtboard' && e.artboard === artboardParam);
  if (!target) return refuse(req, 'That frame is not on this canvas.');
  if (!target.artboard) return refuse(req, 'Place it inside an artboard.');
  return { walk, target, artboard: target.artboard };
}

// ── image.place ────────────────────────────────────────────────────────────────────────────────

export const imagePlace: EditOp = {
  id: 'image.place',
  apply(source, req) {
    const p = placeParams(req);
    const { walk, target, artboard } = containerOf(source, req);
    if (p.mode === 'auto') {
      const kind: PlaceTargetKind = isPicture(target)
        ? 'picture'
        : target.tag === 'DCArtboard'
          ? 'artboard'
          : 'frame';
      const plan = planPlacement(kind, p.assets.length, emptyPicturesIn(walk, target).length);
      p.mode = plan.mode;
      p.emptyOnly = plan.mode === 'fill-in-order';
    }
    const created: ElementRef[] = [];
    const used = usedIds(walk.elements);
    const newId = (): string => {
      const id = generateElementId({ tag: 'img' }, used);
      used.add(id);
      return id;
    };
    const fromName = p.from;
    const first = p.assets[0] as string;
    let out = source;

    const put = (
      asset: string,
      style: Style,
      where: 'start' | 'end',
      parent: IdElement = target
    ) => {
      const id = newId();
      out = insertChild(out, req, parent, imgText(id, asset, p.alt, style, fromName), where);
      created.push({ artboard, element: id });
    };

    if (p.mode === 'fill') {
      if (p.assets.length > 1)
        return refuse(req, 'Fill takes one picture; use a grid or in order.');
      if (isPicture(target)) {
        out = swapSource(source, req, target, first, artboard);
        return { source: out };
      }
      const kids = kidsOf(walk, target);
      const only = kids.length === 1 && kids[0] && isPicture(kids[0]) ? kids[0] : null;
      if (only) {
        out = swapSource(source, req, only, first, artboard);
        return { source: out };
      }
      if (target.tag === 'DCArtboard') put(first, BEHIND_STYLE, 'start');
      else put(first, FILL_STYLE, 'end');
    } else if (p.mode === 'loose') {
      // a picture pasted onto an artboard with a point goes ON its page (the artboard's one element child), absolute
      const page = kidsOf(walk, target);
      const onBoard = !!p.at && p.assets.length === 1 && target.tag === 'DCArtboard';
      const host = onBoard && page.length === 1 && page[0] ? page[0] : target;
      if (onBoard && p.at) put(first, atStyle(p.at, p.natural), 'end', host);
      else
        for (const a of p.assets)
          put(a, looseStyle(p.assets.length === 1 ? p.natural : null), 'end');
    } else if (p.mode === 'fill-in-order') {
      // swapSource may stamp an id: re-walk so each slot is read from the current bytes
      const find = (w: Walked): IdElement =>
        (req.targets[0]
          ? elementOf(w, req.targets[0])
          : w.elements.find((e) => e.tag === 'DCArtboard' && e.artboard === artboard)) as IdElement;
      let i = 0;
      for (; i < p.assets.length; i++) {
        let w = walkOrRefuse(out, req);
        // emptyOnly: a slot that was filled is no longer empty, so the next empty one is always the first left
        let slot = p.emptyOnly ? emptyPicturesIn(w, find(w))[0] : picturesIn(w, find(w))[i];
        if (!slot) break;
        if (p.emptyOnly) {
          // every slot it fills is reported, so the drop can select them: give a slot without an id one first
          if (!slot.id) {
            const st = stampElement(out, req, slot);
            out = st.source;
            w = walkOrRefuse(out, req);
            slot = elementOf(w, { artboard, element: st.id }) ?? slot;
          }
          created.push({ artboard, element: slot.id as string });
        }
        out = swapSource(out, req, slot, p.assets[i] as string, artboard);
      }
      for (; i < p.assets.length; i++) {
        const w = walkOrRefuse(out, req);
        for (const id of usedIds(w.elements)) used.add(id);
        const id = newId();
        out = insertChild(
          out,
          req,
          find(w),
          imgText(id, p.assets[i] as string, p.alt, looseStyle(null), fromName),
          'end'
        );
        created.push({ artboard, element: id });
      }
    } else {
      // grid
      const cols = Math.max(1, Math.ceil(Math.sqrt(p.assets.length)));
      const gid = generateElementId({ tag: 'div', dcElement: 'grid' }, used);
      used.add(gid);
      const cells = p.assets
        .map((a) => {
          const id = newId();
          created.push({ artboard, element: id });
          return imgText(
            id,
            a,
            p.alt,
            [
              ['display', 'block'],
              ['width', '100%'],
              ['aspectRatio', '1 / 1'],
              ['objectFit', 'cover'],
            ],
            fromName
          );
        })
        .join('');
      const wrapper = `<div data-cd-id="${gid}" style=${styleText([
        ['display', 'grid'],
        ['gridTemplateColumns', `repeat(${cols}, 1fr)`],
        ['gap', 'var(--space-2)'],
      ])}>${cells}</div>`;
      out = insertChild(out, req, target, wrapper, 'end');
      created.unshift({ artboard, element: gid });
    }
    if (!parses(out, req.file))
      return refuse(req, 'That picture would break the canvas; nothing was written.');
    return { source: out, created };
  },
};

// ── image.replace ──────────────────────────────────────────────────────────────────────────────

export const imageReplace: EditOp = {
  id: 'image.replace',
  apply(source, req) {
    const t = req.targets[0];
    if (!t) return refuse(req, 'Select a picture first.');
    const asset = req.params.asset;
    if (!isAssetSrc(asset)) return refuse(req, NOT_AN_ASSET, t.element);
    const walk = walkOrRefuse(source, req);
    const el = elementOf(walk, t);
    if (!el || !isPicture(el)) return refuse(req, 'That is not a picture.', t.element);
    return { source: swapSource(source, req, el, asset, t.artboard) };
  },
};
