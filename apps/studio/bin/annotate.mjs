#!/usr/bin/env bun
// annotate.mjs — the AI annotation WRITE verb (DDR-242 AD9).
//
// An agent creates, updates, moves, re-parents, re-orders, groups and deletes
// whiteboard elements through a typed ops vocabulary — or lays out a whole
// flow diagram / board template. Every request becomes the SAME element ops
// the canvas sends (`put | patch | delete`, annotations/ops.ts), built by the
// registry-driven engine in annotations/ai-write.ts: field names, text slots,
// bindability and geometry all come from the element registry, so a new
// element type needs no change here.
//
// Write path: with a live dev-server (`<designRoot>/_server.json`, loopback
// only) the ops go through `POST /_api/annotations/ops` — merged under the one
// merge rule and broadcast to every open canvas. Without one, the resulting
// board is written directly (canonical, atomic tmp + rename). A board file that
// exists but can't be read is never written over.
//
// Created elements are stamped `author: {kind: 'ai'}`; AI writes never enter a
// user's undo stack (they arrive over the sync channel, DDR-100 §3). Updates
// are field patches that carry the values the agent read, so they merge with a
// concurrent human edit instead of replacing the board.
//
// Reached via `maude design annotate` (DDR-062), never a raw bin path.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { makeHostLookup } from '../annotations/ai-read.ts';
import { AiBatch, AiOpError, CREATE_SIZE, describeTypes } from '../annotations/ai-write.ts';
// the character-level text merge (ai-write no longer side-effect-imports it — canvas-lib graph)
import '../annotations/ops-merge.ts';
import { readBoardFile, writeBoardFileAtomic } from '../annotations/board-io.ts';
import {
  applyOriginOffset,
  BoardSpecError,
  boardToOps,
  flowToOps,
  NODE_FILL,
  NODE_INK,
  withDefaultTones,
} from '../annotations/board-ops.ts';
import { MAX_BOARD_BYTES } from '../annotations/constants.ts';
import { serializeBoard } from '../annotations/schema.ts';
import { TEMPLATES, templateBoard } from '../annotations/templates.ts';
import { STICKERS_DIR } from '../paths.ts';
import { PostOpsError, postOps } from './_annotate-post.mjs';
import { loadMetaLayout, resolveArtboards } from './_canvas-rects-static.mjs';
import {
  canvasRelFromArg,
  fileSlug,
  findElementById,
  loadArtboards,
  loadElements,
  resolveDesignRoot,
} from './read-annotations.mjs';

const HELP = `annotate — the AI whiteboard write verb (DDR-242, via \`maude design annotate\`)

Usage:
  maude design annotate <rel-path> [--ops <file|-> | --flow <file|-> | --board <file|-|template-id>]
                        [--near <artboardId>] [--in <artboardId>]
                        [--pin <cdId|selector>] [--no-pointer]
                        [--sticker <pack>/<id>] [--to <ab:…|el:…>]
                        [--wrap-section [<id,…>] [--title <text>]] [--resolve <id,…>]
                        [--canvas-state <path>] [--rects <path>]
                        [--root <repo>] [--dry-run]

<rel-path> is the canvas: relative to the design root ("ui/Foo.tsx"), with the
design-root prefix (".design/ui/Foo.tsx") or absolute. A path outside the design
root exits 2 and writes nothing.

Ops JSON ({ "ops": [ … ] } or a bare array; "-" or omitted = stdin). Coordinates
are WORLD coordinates — the same ones read-annotations prints. Targets are ids
or "@refs" minted earlier in the batch.

  { "op": "create", "type": <type>, "ref"?: "@a", "x"?, "y"?, "w"?, "h"?,
    "parent"?: <section|@ref|null>, …fields }
      Without x/y the element is auto-placed (see placement below). Without
      "parent" it joins the section its centre lands in; null = top level.
      "text" always means the type's text (sticky/text body, shape label,
      section title). Shapes: "shape": rounded|rect|ellipse|diamond|triangle|
      triangle-down (default rounded, blue node look). Arrows: "from"/"to"
      (bound, follow their hosts) or x1/y1/x2/y2 (free).
  { "op": "connect", "from": <id>, "to": <id>, "label"? }   bound arrow
      An end may also be a CANVAS host: "ab:<artboard>" or "el:<artboard>/<element-id>[#n]"
      (the stamped id from canvas-rects). The end follows that artboard / element; if it is
      moved to the trash the arrow keeps its bind and shows it as pointing at something gone.
      Needs the host's geometry (--rects / --canvas-state) or the end's x/y as its cached point.
  { "op": "create", "type": "sticky"|"text"|"image", …, "to": "ab:…"|"el:…" }
      the new note also gets a bound arrow to that host (pass "from" only on arrows).
  { "op": "sticker", "sticker": "<pack>/<id>", x?, y?, w?, h?, "to"?, … }
      a Stickers-gallery picture (an image, 160 × 160 by default), authored by AI.
  { "op": "resolve", "id": <sticky> | "ids": [<sticky>, …] }   resolved by AI (a person's stays);
      a locked sticky is refused. { "op": "update", "id", "resolved": null } reopens it.
  { "op": "wrap-section", "ids": [<id>, …], "text"?: <title> }   one new section around them
  { "op": "update", "id": <id>, …fields }                   patch fields; null resets
  { "op": "move", "id": <id>, "x", "y" } | { …, "dx", "dy" } then joins the section
      it lands in ("keepParent": true to stay); a bound arrow end follows its host
  { "op": "reparent", "id": <id>, "parent": <section|null> } keeps its world position
  { "op": "reorder", "id": <id>, "to": front|back|forward|backward }
      | { …, "before"|"after": <sibling id> }
  { "op": "group", "ids": [<id>, …] }
  { "op": "delete", "id": <id> }     a section's children move up; bound arrows keep their end
  { "op": "set-text", "id", "text" } · { "op": "set-color", "id", "color" }  (= update)

Types and their fields (from the element registry):
${describeTypes()}

--flow <file|->     { nodes: [{ id, label, shape? }], edges: [{ from, to, label? }] } —
                    auto-laid-out left→right, wired by BOUND arrows.
--board <template-id>  one of the starter templates the studio's Templates panel offers:
                    ${TEMPLATES.map((t) => t.id).join(' · ')}
                    (the same spec the panel expands; an id wins over a file of that name)
--board <file|->    { title?, layout?, groups?, nodes?, edges?, connections? } — a whole
                    template: layout "columns" (default; "grid"/"lanes" alias it) = one
                    titled section per group with its cards (string or {text,color?})
                    inside; "radial" = a centre topic with cards ringed around it;
                    "flow" = nodes/edges as in --flow. connections: [{from,to,label?}]
                    between minted refs (@sec<i>, @sec<i>card<j>, @center, @idea<i>).
                    A group may carry tone (grey|yellow|green|coral|sky|lilac) or color (#hex);
                    a column board naming neither gets grey / yellow / green by position.

Shortcut flags (combine with any of the above, or use alone — alone, stdin is not read;
add --ops - to also read ops from it):
  --sticker <pack>/<id>   place that Stickers-gallery picture (pack slug / file or file name
                          without the extension: "project-status/group-100")
  --to <ref>              bind an arrow from every sticky / text / sticker this call creates to
                          that canvas host; with no --in/--near/--pin they land beside it
  --wrap-section [ids]    wrap the given ids — or, with none, everything this call created at
                          the top level — in one section; --title names it
  --resolve <ids>         resolve those stickies (as AI)
Votes, ballots and stamps are people's own: the verb refuses to write them.

Placement (creates without x/y, and whole --flow/--board layouts):
  (none)              a whole --flow/--board layout lands in FREE space: clear of the canvas's
                      artboards (read from its source + .meta.json) and of existing annotations.
  --near <artboard>   beside the artboard (right of it)
  --in <artboard>     inside the artboard (top-left + 40px). Unknown id = error.
  --pin <cdId|sel>    beside a DOM element from a --rects manifest; a created
                      sticky/text also gets a pointer arrow to it (--no-pointer or
                      "pointer": false to skip). Unknown element = error.
  Any create op may carry its own "in"/"near"/"pin" to override for that op.
  --canvas-state <p>  artboard rects; --rects <p> a \`maude design canvas-rects\` manifest.

Output: { ok, via: "server"|"file", file, created, updated, deleted, refs }, plus
resolved: [ids] when stickies were resolved and section: <id> when --wrap-section ran.
--dry-run prints { dryRun: true, ops } (the element ops) and writes nothing.
Invalid requests fail loud (exit 2) and write nothing.`;

// ─────────────────────────────────────────────────────────────────────────────
// Argv

function parseArgv(argv) {
  const out = {
    positional: [],
    ops: null,
    flow: null,
    board: null,
    near: null,
    in: null,
    pin: null,
    pointer: true,
    canvasState: null,
    rects: null,
    root: null,
    sticker: null,
    to: null,
    title: null,
    resolve: null,
    wrapSection: null, // true = wrap what this call created; a string = the ids to wrap
    dryRun: false,
    help: false,
  };
  const VALUE_FLAGS = {
    '--ops': 'ops',
    '--flow': 'flow',
    '--board': 'board',
    '--near': 'near',
    '--in': 'in',
    '--pin': 'pin',
    '--canvas-state': 'canvasState',
    '--rects': 'rects',
    '--root': 'root',
    '--sticker': 'sticker',
    '--to': 'to',
    '--title': 'title',
    '--resolve': 'resolve',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const flagKey = eq > 0 ? a.slice(0, eq) : a;
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-pointer') out.pointer = false;
    else if (flagKey === '--wrap-section') {
      // Optional value: the ids, or nothing (= what this call created).
      if (eq > 0) out.wrapSection = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
        i += 1;
        out.wrapSection = argv[i];
      } else out.wrapSection = true;
    } else if (flagKey in VALUE_FLAGS) {
      if (eq > 0) out[VALUE_FLAGS[flagKey]] = a.slice(eq + 1);
      else {
        i += 1;
        out[VALUE_FLAGS[flagKey]] = argv[i];
      }
    } else out.positional.push(a);
  }
  return out;
}

function fail(msg, code = 1) {
  process.stderr.write(`annotate: ${msg}\n`);
  process.exit(code);
}

function readInput(spec) {
  if (!spec || spec === '-') {
    try {
      return readFileSync(0, 'utf8'); // stdin
    } catch {
      return '';
    }
  }
  const p = isAbsolute(spec) ? spec : resolve(process.cwd(), spec);
  if (!existsSync(p)) fail(`input not found: ${p}`, 2);
  return readFileSync(p, 'utf8');
}

function parseJsonInput(raw, what) {
  if (!raw?.trim()) fail(`${what}: empty input`, 2);
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${what}: invalid JSON — ${err?.message ?? err}`, 2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Placement — where a create without x/y lands.

function buildPlacement(batch, artboards, elements, placement) {
  // Priority: --pin (beside the element) > --in (inside the artboard) > --near
  // (beside the artboard) > right of the existing board > a sane top-left.
  // Unknown --in/--pin targets are a hard error (never a silent mis-place);
  // --near stays lenient (an unmatched id falls through).
  let origin = { x: 100, y: 100 };
  let pinnedEl = null;
  let implicit = false;
  if (placement.in) {
    const board = artboards.find((r) => r.id === placement.in);
    if (!board) fail(`--in: unknown artboard "${placement.in}"`, 2);
    origin = { x: board.x + 40, y: board.y + 40 };
  } else if (placement.pin) {
    const el = findElementById(elements, placement.pin);
    if (!el) fail(`--pin: element "${placement.pin}" not found in the --rects manifest`, 2);
    pinnedEl = el;
    origin = { x: el.x + el.w + 40, y: el.y };
  } else if (placement.toBox && !placement.near) {
    // --to a host whose geometry is known: beside it, like --pin.
    origin = { x: placement.toBox.x + placement.toBox.w + 40, y: placement.toBox.y };
  } else {
    const nearBoard = placement.near ? artboards.find((r) => r.id === placement.near) : null;
    if (nearBoard) origin = { x: nearBoard.x + nearBoard.w + 80, y: nearBoard.y };
    else {
      implicit = true;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      for (const el of batch.scene.childrenOf(null)) {
        const b = batch.worldBox(el.id);
        if (!b) continue;
        maxX = Math.max(maxX, b.x + b.w);
        minY = Math.min(minY, b.y);
      }
      if (Number.isFinite(maxX)) origin = { x: maxX + 80, y: Math.max(0, minY) };
    }
  }
  return {
    origin,
    cursor: { ...origin },
    pinnedEl,
    pointer: placement.pointer !== false,
    implicit,
    artboards,
    elements,
  };
}

/** Stable JSON — object keys sorted, so two specs compare by content, not by key order. */
function stableJson(v) {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x
  );
}

/** Is this spec exactly one of the starter templates' boards? */
function isTemplateSpec(spec) {
  const mine = stableJson(spec);
  return TEMPLATES.some((t) => stableJson(t.board) === mine);
}

const FREE_GAP = 80;

/**
 * The relative extent of a whole-layout (--flow / --board) op list — the box its flowX/boardX
 * offsets span from the placement origin. Null when no op carries an offset.
 */
function relativeBounds(ops) {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const op of ops) {
    const x = op.boardX ?? op.flowX;
    if (x === undefined) continue;
    const y = op.boardY ?? op.flowY ?? 0;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + (Number.isFinite(op.w) ? op.w : 0));
    y1 = Math.max(y1, y + (Number.isFinite(op.h) ? op.h : 0));
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/**
 * A whole layout placed without --near/--in/--pin must land in FREE space: never on an artboard,
 * never on an existing top-level annotation. Starting from the default origin, slide the layout
 * right past whatever it would cover until nothing is under it (bounded; every step clears at
 * least one obstacle, so it ends on the far side of the busiest column).
 */
function freeOrigin(pl, batch, rel) {
  const obstacles = pl.obstacleBoards.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  for (const el of batch.scene.childrenOf(null)) {
    const b = batch.worldBox(el.id);
    if (b) obstacles.push(b);
  }
  let { x, y } = pl.origin;
  const hit = (o) =>
    x + rel.x0 < o.x + o.w + FREE_GAP / 2 &&
    o.x < x + rel.x1 + FREE_GAP / 2 &&
    y + rel.y0 < o.y + o.h + FREE_GAP / 2 &&
    o.y < y + rel.y1 + FREE_GAP / 2;
  for (let i = 0; i <= obstacles.length; i += 1) {
    const blocker = obstacles.filter(hit).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
    if (!blocker) break;
    x = blocker.x + blocker.w + FREE_GAP - rel.x0;
  }
  return { x, y };
}

/** A per-op "in"/"near"/"pin" override — the same rules as the flags, for one op. */
function opPlacement(pl, op) {
  if (op.pin) {
    const el = findElementById(pl.elements, op.pin);
    if (!el) fail(`op.pin: element "${op.pin}" not found in the --rects manifest`, 2);
    return { x: el.x + el.w + 40, y: el.y, pinnedEl: el };
  }
  if (op.in) {
    const board = pl.artboards.find((r) => r.id === op.in);
    if (!board) fail(`op.in: unknown artboard "${op.in}"`, 2);
    return { x: board.x + 40, y: board.y + 40, pinnedEl: null };
  }
  if (op.near) {
    const board = pl.artboards.find((r) => r.id === op.near);
    if (!board) fail(`op.near: unknown artboard "${op.near}"`, 2);
    return { x: board.x + board.w + 80, y: board.y, pinnedEl: null };
  }
  return null;
}

/** Resolve an op's x/y: explicit wins, then a per-op override, then the batch cursor. */
function place(pl, op, w) {
  const override = op.in || op.near || op.pin ? opPlacement(pl, op) : null;
  if (override) {
    return {
      x: Number.isFinite(op.x) ? op.x : override.x,
      y: Number.isFinite(op.y) ? op.y : override.y,
      pinnedEl: override.pinnedEl,
    };
  }
  const x = Number.isFinite(op.x) ? op.x : pl.cursor.x;
  const y = Number.isFinite(op.y) ? op.y : pl.cursor.y;
  if (!Number.isFinite(op.x)) pl.cursor.x = x + w + 40;
  return { x, y, pinnedEl: pl.pinnedEl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ops → the engine.

function createOp(batch, pl, op) {
  const type = op.type;
  // Placement keys are resolved here, never passed on as element fields.
  const { in: _in, near: _near, pin: _pin, pointer: _pointer, ...fields } = op;
  if (type === 'shape') {
    fields.shape ??= 'rounded';
    if (fields.color === undefined) fields.color = NODE_INK;
    if (fields.fill === undefined) fields.fill = NODE_FILL;
    fields.width ??= 3;
  }
  if (type === 'arrow' || type === 'pen') return batch.create(type, fields);
  // `to` makes a note point at something; `from` only means something on an arrow. Neither is a
  // field of a box element — silently dropping one would hide a mistake.
  const { to, from, ...boxFields } = fields;
  if (from !== undefined) {
    throw new AiOpError(
      `create ${type}: "from" is an arrow end — use "to" to point this ${type} at something`
    );
  }
  const w = Number.isFinite(op.w) ? op.w : (CREATE_SIZE[type]?.w ?? 160);
  const { x, y, pinnedEl } = place(pl, op, w);
  const id = batch.create(type, { ...boxFields, x, y });
  if (to !== undefined) {
    batch.connect({ from: id, to });
  } else if (
    pinnedEl &&
    pl.pointer &&
    op.pointer !== false &&
    (type === 'sticky' || type === 'text')
  ) {
    batch.pointer(id, { x: pinnedEl.x, y: pinnedEl.y, w: pinnedEl.w, h: pinnedEl.h });
  }
  return id;
}

function runOps(batch, pl, ops) {
  for (const op of ops) {
    if (!op || typeof op !== 'object') throw new AiOpError('ops: every entry must be an object');
    switch (op.op) {
      case 'create':
        createOp(batch, pl, op);
        break;
      case 'connect':
        batch.connect(op);
        break;
      case 'update':
        batch.update(op);
        break;
      case 'set-text':
        if (typeof op.text !== 'string') throw new AiOpError('set-text: text must be a string');
        batch.update({ id: op.id, text: op.text });
        break;
      case 'set-color':
        if (typeof op.color !== 'string' || !op.color) {
          throw new AiOpError('set-color: color must be a non-empty string');
        }
        batch.update({ id: op.id, color: op.color });
        break;
      case 'move':
        batch.move(op);
        break;
      case 'reparent':
        batch.reparent(op);
        break;
      case 'reorder':
        batch.reorder(op);
        break;
      case 'group':
        batch.group(op);
        break;
      case 'delete':
        batch.delete(op);
        break;
      case 'resolve':
        batch.resolveStickies(op);
        break;
      case 'wrap-section':
        batch.wrapSection(op);
        break;
      case 'sticker':
        throw new AiOpError('sticker: internal — the picture should have been placed first');
      default:
        throw new AiOpError(`ops: unknown op "${op.op}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stickers — a Stickers-gallery picture placed by the agent (--sticker / {"op":"sticker"}).

/** Default drop size of a sticker (the gallery's `STICKER_DROP_SIZE`). */
const STICKER_SIZE = 160;
const PACK_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const STICKER_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function stickerPacks() {
  try {
    return readdirSync(STICKERS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * `<pack>/<id>` → the bundled picture: the pack slug, the catalogue id (the file name without its
 * extension — a board's `sticker.id` is a dot-free catalogue word) and the file. Unknown packs and
 * stickers are errors that name what exists.
 */
function findSticker(spec) {
  const m = /^([^/]+)\/([^/]+)$/.exec(String(spec ?? ''));
  if (!m || !PACK_RE.test(m[1]) || !STICKER_FILE_RE.test(m[2])) {
    throw new AiOpError(
      `sticker: want "<pack>/<id>" (e.g. project-status/group-100), got ${JSON.stringify(spec)}`
    );
  }
  const [, pack, want] = m;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(STICKERS_DIR, pack, 'manifest.json'), 'utf8'));
  } catch {
    throw new AiOpError(
      `sticker: no pack "${pack}" (packs: ${stickerPacks().join(', ') || 'none bundled'})`
    );
  }
  const stem = (f) => f.replace(/\.[^.]+$/, '');
  const list = Array.isArray(manifest?.stickers) ? manifest.stickers : [];
  const hit = list.find(
    (s) =>
      typeof s?.file === 'string' &&
      STICKER_FILE_RE.test(s.file) &&
      (s.file === want || stem(s.file) === want)
  );
  if (!hit) {
    throw new AiOpError(
      `sticker: "${pack}" has no "${want}" (try one of: ${list
        .slice(0, 8)
        .map((s) => stem(String(s?.file)))
        .join(', ')}…)`
    );
  }
  const word = Array.isArray(hit.keywords) ? hit.keywords.find((k) => typeof k === 'string') : '';
  return { pack, id: stem(hit.file), file: hit.file, alt: word ? String(word).slice(0, 80) : '' };
}

/**
 * Turn every `{"op":"sticker", "sticker":"pack/id", …}` into the `create image` op the engine takes:
 * the bundled picture is copied to the project's content-addressed `assets/` (the canvas-safe lane
 * the gallery uses), the image carries `sticker: {pack, id}` and the stickers' drop size. A dry run
 * computes the same name and writes nothing.
 */
async function prepareStickers(ops, { root, designRel, write }) {
  const out = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object' || op.op !== 'sticker') {
      out.push(op);
      continue;
    }
    const { op: _op, sticker: spec, flip, ...rest } = op;
    const s = findSticker(spec);
    const bytes = readFileSync(join(STICKERS_DIR, s.pack, s.file));
    const asset = await import('./_import-asset.mjs');
    const ext = asset.sniffRasterKind(bytes);
    if (!ext) throw new AiOpError(`sticker: ${s.pack}/${s.id} is not a png/jpeg`);
    const href = write
      ? asset.writeContainedAsset(root, designRel, bytes, ext).path
      : `assets/${asset.assetName(bytes, ext)}`;
    out.push({
      ...rest,
      op: 'create',
      type: 'image',
      href,
      ...(rest.alt === undefined && s.alt ? { alt: s.alt } : {}),
      w: rest.w ?? STICKER_SIZE,
      h: rest.h ?? STICKER_SIZE,
      sticker: { pack: s.pack, id: s.id, ...(flip === true ? { flip: true } : {}) },
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
/** The canvas's artboards from its source + meta, with no browser — [] when it can't be read. */
function canvasArtboards(designRoot, canvasRel) {
  try {
    const abs = resolve(designRoot, canvasRel);
    if (!existsSync(abs)) return [];
    const meta = abs.replace(/\.(tsx|html)$/i, '.meta.json');
    return resolveArtboards(readFileSync(abs, 'utf8'), loadMetaLayout(meta));
  } catch {
    return [];
  }
}

// Main — the write is the live server's op endpoint (_annotate-post.mjs), else a direct
// canonical file write.

async function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const relPath = args.positional[0];
  if (!relPath) fail(`missing <rel-path>.\n\n${HELP}`, 2);
  if ([args.ops, args.flow, args.board].filter((v) => v != null).length > 1) {
    fail('--ops, --flow, and --board are mutually exclusive', 2);
  }

  const repoRoot = args.root
    ? resolve(args.root)
    : process.env.CLAUDE_PROJECT_DIR
      ? resolve(process.env.CLAUDE_PROJECT_DIR)
      : process.cwd();
  const { designRel, designRoot } = resolveDesignRoot(repoRoot);
  // The canvas path the server keys its board by — relative to the design
  // root, whether the caller wrote `ui/X.tsx`, `.design/ui/X.tsx` or an
  // absolute path (V2-2.8 B3). The slug and the server must get the same file,
  // or every op is refused as `gone` against a board that doesn't exist.
  const canvasRel = canvasRelFromArg(relPath, repoRoot, designRel);
  if (!canvasRel) {
    fail(
      `${JSON.stringify(String(relPath))} is outside ${designRoot} — give a canvas inside it; nothing written`,
      2
    );
  }
  const slug = fileSlug(canvasRel, designRel);

  const boardFile = readBoardFile(designRoot, slug);
  if (boardFile.tooLarge) {
    fail(`${slug}.annotations.json exceeds ${MAX_BOARD_BYTES} bytes — refusing to read it`, 2);
  }
  if (boardFile.unreadable) {
    fail(`${slug}.annotations.json is not a valid board — refusing to write over it`, 2);
  }

  let artboards = args.canvasState
    ? loadArtboards(
        isAbsolute(args.canvasState) ? args.canvasState : resolve(process.cwd(), args.canvasState)
      )
    : [];
  let elements = [];
  if (args.rects) {
    const rectsPath = isAbsolute(args.rects) ? args.rects : resolve(process.cwd(), args.rects);
    elements = loadElements(rectsPath);
    if (!artboards.length) artboards = loadArtboards(rectsPath);
  }
  // Geometry for FREE-SPACE placement only: the passed artboards, else the canvas's own (JSX sizes
  // + .meta.json positions, the merge `canvas-rects` falls back to). Kept apart from `artboards`
  // so a note's host lookup still depends on the geometry the caller actually passed.
  const obstacleBoards = artboards.length ? artboards : canvasArtboards(designRoot, canvasRel);

  // Canvas hosts (`ab:` / `el:` bound ends) are looked up in the geometry the caller passed; the
  // artboards also let a new note ride with the artboard its centre lands on (contract S4 Q3).
  const hosts =
    artboards.length || elements.length ? makeHostLookup(artboards, elements) : undefined;
  const batch = new AiBatch(boardFile.elements, { hosts, artboards });
  const toBox = args.to ? (hosts?.(args.to)?.box ?? null) : null;
  const pl = buildPlacement(batch, artboards, elements, {
    near: args.near,
    in: args.in,
    pin: args.pin,
    pointer: args.pointer,
    toBox,
  });

  // The shortcut flags can stand alone; only then is stdin not read for ops.
  const flagOnly =
    args.ops == null &&
    args.flow == null &&
    args.board == null &&
    (args.sticker != null || args.wrapSection != null || args.resolve != null);

  // A whole layout lands where nothing is: slide it clear of artboards and existing notes.
  const placeLayout = (rel) => {
    const b = pl.implicit ? relativeBounds(rel) : null;
    if (b) {
      pl.obstacleBoards = obstacleBoards;
      pl.origin = freeOrigin(pl, batch, b);
      pl.cursor = { ...pl.origin };
    }
    return applyOriginOffset(rel, pl.origin);
  };

  let ops;
  let sectionId = null;
  let resolvedIds = null;
  try {
    if (flagOnly) {
      ops = [];
    } else if (args.flow != null) {
      ops = placeLayout(flowToOps(parseJsonInput(readInput(args.flow), '--flow')));
    } else if (args.board != null) {
      const template = templateBoard(args.board);
      const spec = template ?? parseJsonInput(readInput(args.board), '--board');
      // A starter template's own spec (by id or as a file) stays colourless, so the panel and the
      // verb expand the same board; any other column board gets a tone per column.
      ops = placeLayout(
        boardToOps(template || isTemplateSpec(spec) ? spec : withDefaultTones(spec))
      );
    } else {
      const payload = parseJsonInput(readInput(args.ops), '--ops');
      ops = Array.isArray(payload?.ops) ? payload.ops : Array.isArray(payload) ? payload : null;
      if (!ops) fail('ops: expected { ops: [...] } (or a bare array)', 2);
    }
    if (args.sticker != null) ops.push({ op: 'sticker', sticker: args.sticker });
    // --to: every note this call creates points at the host (an op's own "to" wins).
    if (args.to != null) {
      ops = ops.map((o) =>
        o?.op === 'create' && ['sticky', 'text'].includes(o.type) && o.to === undefined
          ? { ...o, to: args.to }
          : o?.op === 'sticker' && o.to === undefined
            ? { ...o, to: args.to }
            : o
      );
    }
    ops = await prepareStickers(ops, { root: repoRoot, designRel, write: !args.dryRun });
    // A sticker made by --sticker/--to is a create op by now: --to reaches it too.
    runOps(batch, pl, ops);

    if (args.wrapSection != null) {
      let ids;
      if (typeof args.wrapSection === 'string') {
        ids = args.wrapSection
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      } else {
        // Whatever this call put at the top level (arrows keep their hosts and stay out).
        ids = batch.created.filter((id) => {
          const e = batch.state.get(id);
          return e && e.type !== 'arrow' && !batch.scene.effectiveParent(e);
        });
      }
      sectionId = batch.wrapSection({ ids, text: args.title ?? undefined });
    }
    if (args.resolve != null) {
      const ids = String(args.resolve)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      resolvedIds = batch.resolveStickies({ ids });
    }
  } catch (err) {
    if (err instanceof AiOpError || err instanceof BoardSpecError) fail(err.message, 2);
    throw err;
  }

  const text = serializeBoard(batch.elements);
  if (text.length > MAX_BOARD_BYTES) {
    fail(
      `result exceeds the ${MAX_BOARD_BYTES}-byte board cap (${text.length}) — nothing written`,
      1
    );
  }
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({ dryRun: true, ops: batch.ops })}\n`);
    return;
  }

  const file = join(designRoot, `${slug}.annotations.json`);
  let via = 'file';
  let rejected = [];
  if (batch.ops.length) {
    let res = null;
    try {
      res = await postOps(designRoot, `${designRel}/${canvasRel}`, batch.ops);
    } catch (err) {
      if (err instanceof PostOpsError) fail(err.message, err.code);
      throw err;
    }
    if (res) {
      via = 'server';
      rejected = Array.isArray(res.rejected) ? res.rejected : [];
    } else {
      try {
        writeBoardFileAtomic(designRoot, slug, text);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err), 2);
      }
    }
  }

  const refs = Object.fromEntries(batch.refs);
  const out = {
    ok: rejected.length === 0,
    via,
    file,
    created: batch.created.length,
    updated: batch.updated.size,
    deleted: batch.deleted.length,
    refs,
    ...(resolvedIds ? { resolved: resolvedIds } : {}),
    ...(sectionId ? { section: sectionId } : {}),
    ...(rejected.length ? { rejected } : {}),
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  if (rejected.length) process.exitCode = 1;
}

await main();
