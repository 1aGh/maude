// edit-ops/clipboard.ts — V2-clipboard-objects (14 Editing ed-ab-menu, ed-obj-order): Cut / Copy /
// Paste of objects and artboards, as edit-ops on the one dispatch route (decision
// `maude/v2-clipboard-objects-split`: copy an element / artboard source range, paste as an edit-op).
//
//   object.copy    the selected objects' JSX (document order)       — a READ: nothing is written
//   artboard.copy  params.artboards' whole `<DCArtboard>` ranges     — a READ
//   object.cut     object.copy, then the objects leave the file       — one write, one ⌘Z
//   canvas.paste   params.clip = the handle a copy / cut answered     — one write, one ⌘Z
//
// The BYTES never travel: a copy / cut keeps the copied text HERE (server memory, per project server)
// and answers a handle `{ id, kind, count, from }` in `detail.clip`. The shell holds that handle (its
// clipboard, client/clipboard-relay.ts) and is the only one that names it on a paste — it overwrites
// whatever `params.clip` a canvas sent. So a paste can only ever write text this server itself read
// out of a canvas on disk: no raw JSX arrives from any client, and the 64 KiB body bound stays.
//
// A copy never carries an element id or a lock (V2-1.4 §5.2, the duplicate rule): every `data-cd-id` /
// `data-cd-locked` is dropped when the range is read and again when it is written; a pasted root that
// is a DOM element gets a fresh readable id (so the canvas selects it), its descendants stay lazy. A
// pasted artboard gets a fresh artboard id and label ("Desktop" → "Desktop 2", copyId / copyName).
//
// Where a paste lands:
//   objects    after `targets[0]` (the selected object), as its next siblings; else inside
//              `params.artboard` (its page root when it has exactly one element child), at the end;
//              else inside the clip's own artboard when it is on this canvas; else the first artboard.
//   artboards  after `params.artboard` (the selected artboard), else after the last one; `params.at`
//              {x, y} places the first in the layout lane and the rest in a row beside it.

import { randomBytes } from 'node:crypto';

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { applyDeleteElement, CanvasEditError, escapeAttr } from '../canvas-edit.ts';
import {
  copyWithoutIds,
  generateElementId,
  type IdElement,
  seedOf,
  usedIds,
  walkIdElements,
  withIdAttr,
} from '../element-ids.ts';
import { artboardLabels, copyId, copyName } from './duplicate-at-width.ts';
import { isCoord } from './layout-patch.ts';
import { lineIndent, reindent } from './siblings.ts';
import type { EditOp, ElementRef, LayoutPatch, ResolvedEditOp } from './types.ts';

export type ClipKind = 'objects' | 'artboards';

/** What a copy / cut answers in `detail.clip` (and all the shell ever holds). No bytes. */
export interface ClipHandle {
  id: string;
  kind: ClipKind;
  count: number;
  /** designRoot-relative canvas the text was read from */
  from: string;
}

interface Clip extends ClipHandle {
  /** each item's JSX, ids stripped, continuation lines de-indented */
  items: string[];
  /** artboards: each item's artboard id / label in the source (the copy is named after them) */
  names: Array<{ id: string; label: string; width: number | null }>;
  /** objects: the artboard they came from (a paste with nowhere else to go lands there) */
  artboard: string | null;
  bytes: number;
}

export const CLIP_ID_RE = /^c_[0-9a-f]{16}$/;
/** Objects / artboards one copy may hold (the op's own target bound is 200). */
export const MAX_CLIP_ITEMS = 50;
/** Clips the server keeps (the shell holds one; older handles are other windows' or stale). */
const MAX_CLIPS = 16;
/** Text the server keeps for every clip together. */
const MAX_CLIP_BYTES = 16 * 1024 * 1024;
const ARTBOARD_GAP = 80;

// ── the store (per server process: a restart forgets — "copy it again") ─────────────────────

const clips = new Map<string, Clip>();

function keep(clip: Omit<Clip, 'id' | 'bytes'>): ClipHandle {
  const id = `c_${randomBytes(8).toString('hex')}`;
  const bytes = clip.items.reduce((n, t) => n + t.length * 2, 0);
  clips.set(id, { ...clip, id, bytes });
  let total = 0;
  for (const c of clips.values()) total += c.bytes;
  for (const [k, c] of clips) {
    if (clips.size <= MAX_CLIPS && total <= MAX_CLIP_BYTES) break;
    if (k === id) break; // never evict the one just kept
    clips.delete(k);
    total -= c.bytes;
  }
  return { id, kind: clip.kind, count: clip.items.length, from: clip.from };
}

/** Tests only. */
export function _resetClips(): void {
  clips.clear();
}

// ── reading a range ───────────────────────────────────────────────────────────────────────────

function fail(file: string, message: string, id = ''): never {
  throw new CanvasEditError(message, { canvas: file, id });
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The element's text as a clip item: ids and locks dropped, continuation lines de-indented. */
function itemOf(source: string, elements: IdElement[], el: IdElement): string {
  const text = copyWithoutIds(source, elements, el.start, el.end);
  return reindent(text, lineIndent(source, el.start), '');
}

const NOT_AN_OBJECT = 'Copy works on objects; select one first.';

function objectsOf(source: string, req: ResolvedEditOp): { els: IdElement[]; all: IdElement[] } {
  const walk = walkIdElements(source, req.file);
  if (!walk.ok) return fail(req.file, 'This canvas does not parse; fix it before editing.');
  if (req.targets.length === 0) return fail(req.file, NOT_AN_OBJECT);
  if (req.targets.length > MAX_CLIP_ITEMS)
    return fail(req.file, 'That is too many objects to copy at once.');
  const picked: IdElement[] = [];
  for (const t of req.targets) {
    const el = walk.elements.find((e) => e.id === t.element);
    if (!el) return fail(req.file, 'One of the objects is not on this canvas.', t.element);
    if (el.tag === 'DCArtboard' || el.tag === 'DCSection' || el.tag === 'DesignCanvas')
      return fail(req.file, NOT_AN_OBJECT, t.element);
    if (!picked.includes(el)) picked.push(el);
  }
  // an object inside another picked object travels with it (no copy twice)
  const inside = (e: IdElement) =>
    picked.some((p) => p !== e && p.start <= e.start && e.end <= p.end);
  const els = picked.filter((e) => !inside(e)).sort((a, b) => a.start - b.start);
  return { els, all: walk.elements };
}

function artboardsOf(source: string, req: ResolvedEditOp): { els: IdElement[]; all: IdElement[] } {
  const walk = walkIdElements(source, req.file);
  if (!walk.ok) return fail(req.file, 'This canvas does not parse; fix it before editing.');
  const ids = req.params.artboards;
  if (!Array.isArray(ids) || ids.length === 0) return fail(req.file, 'Select an artboard to copy.');
  if (ids.length > MAX_CLIP_ITEMS)
    return fail(req.file, 'That is too many artboards to copy at once.');
  const els: IdElement[] = [];
  for (const id of ids) {
    const el =
      typeof id === 'string'
        ? walk.elements.find((e) => e.tag === 'DCArtboard' && e.artboard === id)
        : undefined;
    if (!el) return fail(req.file, 'That artboard is not on this canvas.');
    if (!els.includes(el)) els.push(el);
  }
  return { els: els.sort((a, b) => a.start - b.start), all: walk.elements };
}

const widthOf = (attrs: string): number | null => {
  const m = /\bwidth=\{\s*(\d{1,5})\s*\}/.exec(attrs);
  return m ? Number(m[1]) : null;
};

function readArtboards(source: string, req: ResolvedEditOp): Omit<Clip, 'id' | 'bytes'> {
  const { els, all } = artboardsOf(source, req);
  const labels = artboardLabels(source);
  return {
    kind: 'artboards',
    from: req.file,
    items: els.map((el) => itemOf(source, all, el)),
    names: els.map((el) => {
      const id = el.artboard as string;
      const open = source.slice(el.start, source.indexOf('>', el.nameEnd) + 1);
      return { id, label: labels.get(id) ?? id, width: widthOf(open) };
    }),
    artboard: null,
  };
}

function readObjects(source: string, req: ResolvedEditOp) {
  const { els, all } = objectsOf(source, req);
  return {
    els,
    clip: {
      kind: 'objects' as const,
      from: req.file,
      items: els.map((el) => itemOf(source, all, el)),
      names: [],
      artboard: req.targets[0]?.artboard ?? null,
    },
  };
}

// ── the copy / cut ops ────────────────────────────────────────────────────────────────────────

const countWords = (n: number, one: string, many: string) =>
  n === 1 ? `1 ${one}` : `${n} ${many}`;

export const objectCopy: EditOp = {
  id: 'object.copy',
  read: true,
  locked: 'allow', // a locked object can be copied (Figma's rule); the copy starts unlocked
  apply(source, req) {
    const { clip } = readObjects(source, req);
    return { source, detail: { clip: keep(clip) } };
  },
};

export const artboardCopy: EditOp = {
  id: 'artboard.copy',
  read: true,
  locked: 'allow',
  apply(source, req) {
    return { source, detail: { clip: keep(readArtboards(source, req)) } };
  },
};

export const objectCut: EditOp = {
  id: 'object.cut',
  apply(source, req) {
    const { els, clip } = readObjects(source, req);
    let out = source;
    // last first: removing a later range never moves an earlier one
    for (const el of [...els].reverse())
      out = applyDeleteElement(req.file, out, el.id as string).source;
    const handle = keep(clip);
    return {
      source: out,
      detail: { clip: handle },
      action: { kind: 'edit', label: `Cut ${countWords(handle.count, 'object', 'objects')}` },
    };
  },
};

// ── the paste ─────────────────────────────────────────────────────────────────────────────────

const WRAP_HEAD = 'const __maudeClip = (\n';
const WRAP_TAIL = '\n);\n';

/**
 * One clip item as written: re-parsed on its own (exactly one JSX element, nothing around it), every id
 * and lock dropped again, the root's walked element returned for its id seed. Null = not one element.
 */
function checkItem(item: string, file: string): { text: string; root: IdElement } | null {
  const synth = `${WRAP_HEAD}${item}${WRAP_TAIL}`;
  let parsed: { program?: { body?: unknown[] }; errors?: unknown[] };
  try {
    parsed = parseSync('clip.tsx', synth, { sourceType: 'module' });
  } catch {
    return null;
  }
  if (parsed.errors?.length || parsed.program?.body?.length !== 1) return null;
  const walk = walkIdElements(synth, file);
  if (!walk.ok) return null;
  const from = WRAP_HEAD.length;
  const to = from + item.length;
  const roots = walk.elements.filter((e) => e.parent === -1);
  const root = roots[0];
  if (roots.length !== 1 || !root || root.start !== from || root.end !== to) return null;
  return { text: copyWithoutIds(synth, walk.elements, from, to), root };
}

function clipOf(req: ResolvedEditOp): Clip {
  const id = req.params.clip;
  if (typeof id !== 'string' || !CLIP_ID_RE.test(id))
    return fail(req.file, 'Nothing to paste. Copy an object or an artboard first.');
  const clip = clips.get(id);
  if (!clip) return fail(req.file, 'That copy is gone; copy it again.');
  return clip;
}

/** Where objects land inside an artboard: its page root when it has exactly one element child. */
function containerOf(source: string, all: IdElement[], board: IdElement): IdElement {
  const kids = board.kids.map((i) => all[i]).filter((e): e is IdElement => !!e);
  const only = kids.length === 1 ? kids[0] : undefined;
  if (only && /^[a-z]/.test(only.tag) && !source.slice(only.start, only.end).endsWith('/>'))
    return only;
  return board;
}

function pasteObjects(source: string, req: ResolvedEditOp, clip: Clip) {
  const walk = walkIdElements(source, req.file);
  if (!walk.ok) return fail(req.file, 'This canvas does not parse; fix it before editing.');
  const all = walk.elements;
  const used = usedIds(all);
  const anchorRef = req.targets[0];
  const anchor = anchorRef ? all.find((e) => e.id === anchorRef.element) : undefined;
  if (anchorRef && !anchor) return fail(req.file, 'That object is not on this canvas.');
  if (anchor && (anchor.tag === 'DCArtboard' || anchor.tag === 'DCSection'))
    return fail(req.file, 'Paste goes beside an object or into an artboard.');

  let at: number;
  let indent: string;
  let artboard: string;
  if (anchor) {
    at = anchor.end;
    indent = lineIndent(source, anchor.start);
    artboard = anchorRef?.artboard ?? anchor.artboard ?? '';
  } else {
    const boards = all.filter((e) => e.tag === 'DCArtboard' && e.artboard);
    const want =
      (typeof req.params.artboard === 'string' && req.params.artboard) ||
      (clip.from === req.file ? clip.artboard : null);
    const board =
      (want ? boards.find((b) => b.artboard === want) : undefined) ??
      (typeof req.params.artboard === 'string' ? undefined : boards[0]);
    if (!board) return fail(req.file, 'That artboard is not on this canvas.');
    if (source.slice(board.start, board.end).endsWith('/>'))
      return fail(req.file, 'That artboard has no room for objects yet.');
    const box = containerOf(source, all, board);
    const close = source.lastIndexOf('</', box.end - 1);
    let end = close;
    while (end > 0 && /\s/.test(source[end - 1] as string)) end--;
    at = end;
    const own = lineIndent(source, box.start);
    indent = own + (own.includes('\t') ? '\t' : '  ');
    artboard = board.artboard as string;
  }

  const created: ElementRef[] = [];
  let block = '';
  for (const raw of clip.items) {
    const item = checkItem(raw, req.file);
    if (!item || ['DCArtboard', 'DCSection', 'DesignCanvas'].includes(item.root.tag))
      return fail(req.file, 'That copy can not be pasted here.');
    let text = item.text;
    if (/^[a-z]/.test(item.root.tag)) {
      const id = generateElementId(seedOf(item.root), used);
      text = withIdAttr(text, id);
      created.push({ artboard, element: id });
    }
    block += `\n${indent}${reindent(text, '', indent)}`;
  }
  const s = new MagicString(source);
  s.appendLeft(at, block);
  return { source: s.toString(), created };
}

function pasteArtboards(source: string, req: ResolvedEditOp, clip: Clip) {
  const walk = walkIdElements(source, req.file);
  if (!walk.ok) return fail(req.file, 'This canvas does not parse; fix it before editing.');
  const boards = walk.elements.filter((e) => e.tag === 'DCArtboard' && e.artboard);
  const want = typeof req.params.artboard === 'string' ? req.params.artboard : null;
  const after = (want ? boards.find((b) => b.artboard === want) : undefined) ?? boards.at(-1);
  if (!after) return fail(req.file, 'This canvas has no artboards to paste beside.');
  const ids = new Set(boards.map((b) => b.artboard as string));
  const labels = new Set(artboardLabels(source).values());
  const indent = lineIndent(source, after.start);
  const created: ElementRef[] = [];
  const set: NonNullable<LayoutPatch['set']> = [];
  const place = isRec(req.params.at) && isCoord(req.params.at.x) && isCoord(req.params.at.y);
  let x = place ? Math.round((req.params.at as { x: number }).x) : 0;
  const y = place ? Math.round((req.params.at as { y: number }).y) : 0;
  let block = '';
  clip.items.forEach((raw, i) => {
    const item = checkItem(raw, req.file);
    const name = clip.names[i];
    if (!item || item.root.tag !== 'DCArtboard' || !name)
      fail(req.file, 'That copy can not be pasted here.');
    const id = copyId(name.id, ids);
    ids.add(id);
    const label = copyName(name.label, labels);
    labels.add(label);
    block += `\n${indent}${reindent(renameBoard(item.text, id, label, req.file), '', indent)}`;
    created.push({ artboard: id, element: id });
    if (place) {
      set.push({ id, x, y });
      x += (name.width ?? 1440) + ARTBOARD_GAP;
    }
  });
  const s = new MagicString(source);
  s.appendLeft(after.end, block);
  return { source: s.toString(), created, layout: set.length ? { set } : undefined };
}

/** `<DCArtboard id="…" label="…">` of a checked item with a new id and label (the opening tag only). */
function renameBoard(text: string, id: string, label: string, file: string): string {
  const synth = `${WRAP_HEAD}${text}${WRAP_TAIL}`;
  const parsed = parseSync('clip.tsx', synth, { sourceType: 'module' }) as {
    program: { body: Array<Record<string, unknown>> };
  };
  // const __maudeClip = ( <DCArtboard …> ) — the declarator's init, through the parentheses
  const decl = parsed.program.body[0]?.declarations as Array<{ init?: Record<string, unknown> }>;
  let node = decl?.[0]?.init;
  while (node && node.type === 'ParenthesizedExpression')
    node = node.expression as Record<string, unknown>;
  const opening = node?.openingElement as { attributes?: Array<Record<string, unknown>> };
  const attr = (n: string) =>
    opening?.attributes?.find(
      (a) => a.type === 'JSXAttribute' && (a.name as { name?: unknown })?.name === n
    ) as { start: number; end: number } | undefined;
  const idAttr = attr('id');
  if (!idAttr) return fail(file, 'That copy can not be pasted here.');
  const ms = new MagicString(synth);
  ms.overwrite(idAttr.start, idAttr.end, `id="${escapeAttr(id)}"`);
  const labelAttr = attr('label');
  if (labelAttr) ms.overwrite(labelAttr.start, labelAttr.end, `label="${escapeAttr(label)}"`);
  else ms.appendLeft(idAttr.end, ` label="${escapeAttr(label)}"`);
  const out = ms.toString();
  return out.slice(WRAP_HEAD.length, out.length - WRAP_TAIL.length);
}

export const canvasPaste: EditOp = {
  id: 'canvas.paste',
  apply(source, req) {
    const clip = clipOf(req);
    const done =
      clip.kind === 'artboards'
        ? pasteArtboards(source, req, clip)
        : pasteObjects(source, req, clip);
    const check = walkIdElements(done.source, req.file);
    if (!check.ok) return fail(req.file, 'That paste would break the canvas; nothing changed.');
    const what =
      clip.kind === 'artboards'
        ? countWords(clip.items.length, 'artboard', 'artboards')
        : countWords(clip.items.length, 'object', 'objects');
    return {
      source: done.source,
      created: done.created,
      ...('layout' in done && done.layout ? { layout: done.layout } : {}),
      action: { kind: 'edit', label: `Paste ${what}` },
    };
  },
};

export const CLIPBOARD_OPS: readonly EditOp[] = [objectCopy, artboardCopy, objectCut, canvasPaste];
