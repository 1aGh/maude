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

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { AiBatch, AiOpError, CREATE_SIZE, describeTypes } from '../annotations/ai-write.ts';
import { readBoardFile, writeBoardFileAtomic } from '../annotations/board-io.ts';
import { MAX_BOARD_BYTES } from '../annotations/constants.ts';
import { serializeBoard } from '../annotations/schema.ts';
import {
  fileSlug,
  findElementById,
  loadArtboards,
  loadElements,
  resolveDesignRoot,
} from './read-annotations.mjs';

// Flow-node look — the blue ink + paired tint read on light AND dark canvases
// (the verb cannot know the viewer's theme).
const NODE_INK = '#3b82f6';
const NODE_FILL = '#e0ebfd';
const NODE_W = 180;
const NODE_H = 80;
const FLOW_GAP_X = 100;
const FLOW_GAP_Y = 60;

const HELP = `annotate — the AI whiteboard write verb (DDR-242, via \`maude design annotate\`)

Usage:
  maude design annotate <rel-path> [--ops <file|-> | --flow <file|-> | --board <file|->]
                        [--near <artboardId>] [--in <artboardId>]
                        [--pin <cdId|selector>] [--no-pointer]
                        [--canvas-state <path>] [--rects <path>]
                        [--root <repo>] [--dry-run]

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
--board <file|->    { title?, layout?, groups?, nodes?, edges?, connections? } — a whole
                    template: layout "columns" (default; "grid"/"lanes" alias it) = one
                    titled section per group with its cards (string or {text,color?})
                    inside; "radial" = a centre topic with cards ringed around it;
                    "flow" = nodes/edges as in --flow. connections: [{from,to,label?}]
                    between minted refs (@sec<i>, @sec<i>card<j>, @center, @idea<i>).

Placement (creates without x/y, and whole --flow/--board layouts):
  --near <artboard>   beside the artboard (right of it)
  --in <artboard>     inside the artboard (top-left + 40px). Unknown id = error.
  --pin <cdId|sel>    beside a DOM element from a --rects manifest; a created
                      sticky/text also gets a pointer arrow to it (--no-pointer or
                      "pointer": false to skip). Unknown element = error.
  Any create op may carry its own "in"/"near"/"pin" to override for that op.
  --canvas-state <p>  artboard rects; --rects <p> a \`maude design canvas-rects\` manifest.

Output: { ok, via: "server"|"file", file, created, updated, deleted, refs }.
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
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const flagKey = eq > 0 ? a.slice(0, eq) : a;
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-pointer') out.pointer = false;
    else if (flagKey in VALUE_FLAGS) {
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

/**
 * Wave H F2 — the annotate egress allowlist. The dev-server is loopback-only
 * (DDR-054); a POST target that is not a loopback http(s) origin is refused so
 * a poisoned `_server.json.url` can't exfiltrate the board off-box.
 */
function isLoopbackHttpUrl(base) {
  let u;
  try {
    u = new URL(base);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
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
  if (placement.in) {
    const board = artboards.find((r) => r.id === placement.in);
    if (!board) fail(`--in: unknown artboard "${placement.in}"`, 2);
    origin = { x: board.x + 40, y: board.y + 40 };
  } else if (placement.pin) {
    const el = findElementById(elements, placement.pin);
    if (!el) fail(`--pin: element "${placement.pin}" not found in the --rects manifest`, 2);
    pinnedEl = el;
    origin = { x: el.x + el.w + 40, y: el.y };
  } else {
    const nearBoard = placement.near ? artboards.find((r) => r.id === placement.near) : null;
    if (nearBoard) origin = { x: nearBoard.x + nearBoard.w + 80, y: nearBoard.y };
    else {
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
    artboards,
    elements,
  };
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
  const w = Number.isFinite(op.w) ? op.w : (CREATE_SIZE[type]?.w ?? 160);
  const { x, y, pinnedEl } = place(pl, op, w);
  const id = batch.create(type, { ...fields, x, y });
  if (pinnedEl && pl.pointer && op.pointer !== false && (type === 'sticky' || type === 'text')) {
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
      default:
        throw new AiOpError(`ops: unknown op "${op.op}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow mode — layered left→right layout of nodes + bound connector edges.

// Shared by --flow and --board layout:"flow" (which delegates to flowToOps) —
// checked once, in flowToOps, so neither caller can bypass it. A relationship
// array (edges) manufactures ops just as surely as an entity array does.
const FLOW_MAX_NODES = 200;
const FLOW_MAX_EDGES = 400;

function flowToOps(flow) {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow.edges) ? flow.edges : [];
  if (!nodes.length) fail('flow: needs at least one node', 2);
  if (nodes.length > FLOW_MAX_NODES) {
    fail(`flow: nodes[] has ${nodes.length}, max ${FLOW_MAX_NODES}`, 2);
  }
  if (edges.length > FLOW_MAX_EDGES) {
    fail(`flow: edges[] has ${edges.length}, max ${FLOW_MAX_EDGES}`, 2);
  }
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) {
      fail(`flow: edge references unknown node (${e.from} → ${e.to})`, 2);
    }
  }
  // Longest-path layering via Kahn; cycle leftovers keep their seeded layer.
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    adj.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }
  const layer = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    for (const t of adj.get(id)) {
      layer.set(t, Math.max(layer.get(t), layer.get(id) + 1));
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  const byLayer = new Map();
  for (const id of ids) {
    const l = layer.get(id);
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l).push(id);
  }
  const ops = [];
  for (const [l, list] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((id, i) => {
      const node = nodes.find((n) => n.id === id);
      ops.push({
        op: 'create',
        type: 'shape',
        shape: typeof node.shape === 'string' ? node.shape : 'rounded',
        ref: `@${id}`,
        text: typeof node.label === 'string' ? node.label : String(id),
        w: NODE_W,
        h: NODE_H,
        // Relative to the placement origin (applyOriginOffset).
        flowX: l * (NODE_W + FLOW_GAP_X),
        flowY: i * (NODE_H + FLOW_GAP_Y),
      });
    });
  }
  for (const e of edges) {
    ops.push({ op: 'connect', from: `@${e.from}`, to: `@${e.to}`, label: e.label });
  }
  return ops;
}

// ─────────────────────────────────────────────────────────────────────────────
// Board mode — a typed template spec expands into ops the same way --flow
// does. Named presets (retro / kanban / social calendar / roadmap / brainstorm
// / checklist / user flow) are spec fixtures in the `whiteboard` skill, not
// code: this is only the generic layout engine they share.

const BOARD_COL_W = 280;
const BOARD_COL_GAP = 40;
const BOARD_CARD_W = 240;
const BOARD_CARD_H = 90;
const BOARD_CARD_GAP = 20;
const BOARD_HEADER_H = 60;
const BOARD_EMPTY_SECTION_H = 500;
const BOARD_RADIAL_RADIUS = 320;
const BOARD_RADIAL_CENTER_W = 200;
const BOARD_RADIAL_CENTER_H = 100;
const BOARD_RADIAL_CARD_W = 200;
const BOARD_RADIAL_CARD_H = 80;

// --board is arbitrary agent-composed JSON: cap it BEFORE expansion, so an
// unbounded groups/cards array can't burn CPU/memory before the board byte cap.
const BOARD_MAX_GROUPS = 20;
const BOARD_MAX_CARDS_PER_GROUP = 50;
const BOARD_MAX_TOTAL_CARDS = 300;
const BOARD_MAX_CONNECTIONS = 400;

function cardText(card) {
  return typeof card === 'string' ? card : typeof card?.text === 'string' ? card.text : '';
}

function cardColor(card) {
  return typeof card === 'object' && card && typeof card.color === 'string'
    ? card.color
    : undefined;
}

/**
 * "columns" — one titled section per group, its cards stacked INSIDE it (they
 * are the section's children). Each section's height grows with its own card
 * count, so a half-filled board never collides with its neighbour.
 */
function boardColumns(groups) {
  const ops = [];
  groups.forEach((g, i) => {
    const cards = Array.isArray(g.cards) ? g.cards : [];
    const h = cards.length
      ? BOARD_HEADER_H + cards.length * (BOARD_CARD_H + BOARD_CARD_GAP)
      : BOARD_EMPTY_SECTION_H;
    const colX = i * (BOARD_COL_W + BOARD_COL_GAP);
    ops.push({
      op: 'create',
      type: 'section',
      ref: `@sec${i}`,
      text: typeof g.title === 'string' && g.title ? g.title : `Group ${i + 1}`,
      color: typeof g.color === 'string' ? g.color : undefined,
      boardX: colX,
      boardY: 0,
      w: BOARD_COL_W,
      h,
      parent: null,
    });
    cards.forEach((c, j) => {
      ops.push({
        op: 'create',
        type: 'sticky',
        ref: `@sec${i}card${j}`,
        text: cardText(c),
        color: cardColor(c),
        boardX: colX + (BOARD_COL_W - BOARD_CARD_W) / 2,
        boardY: BOARD_HEADER_H + j * (BOARD_CARD_H + BOARD_CARD_GAP),
        w: BOARD_CARD_W,
        h: BOARD_CARD_H,
        parent: `@sec${i}`,
      });
    });
  });
  return ops;
}

/** "radial" — a central topic shape with idea cards in a ring (brainstorm). */
function boardRadial(spec, groups) {
  const cards = groups.flatMap((g) => (Array.isArray(g.cards) ? g.cards : []));
  const pad = BOARD_RADIAL_RADIUS + Math.max(BOARD_RADIAL_CARD_W, BOARD_RADIAL_CARD_H);
  const ops = [
    {
      op: 'create',
      type: 'shape',
      shape: 'ellipse',
      ref: '@center',
      text: typeof spec.title === 'string' && spec.title ? spec.title : 'Topic',
      boardX: pad - BOARD_RADIAL_CENTER_W / 2,
      boardY: pad - BOARD_RADIAL_CENTER_H / 2,
      w: BOARD_RADIAL_CENTER_W,
      h: BOARD_RADIAL_CENTER_H,
    },
  ];
  const n = cards.length;
  cards.forEach((c, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
    const cx = pad + BOARD_RADIAL_RADIUS * Math.cos(angle);
    const cy = pad + BOARD_RADIAL_RADIUS * Math.sin(angle);
    ops.push({
      op: 'create',
      type: 'sticky',
      ref: `@idea${i}`,
      text: cardText(c),
      color: cardColor(c),
      boardX: cx - BOARD_RADIAL_CARD_W / 2,
      boardY: cy - BOARD_RADIAL_CARD_H / 2,
      w: BOARD_RADIAL_CARD_W,
      h: BOARD_RADIAL_CARD_H,
    });
  });
  return ops;
}

function boardToOps(spec) {
  const layout = typeof spec.layout === 'string' ? spec.layout : 'columns';
  if (layout === 'flow') {
    if (!Array.isArray(spec.nodes) || !spec.nodes.length) {
      fail('board: layout "flow" needs a nodes[] array', 2);
    }
    return flowToOps({ nodes: spec.nodes, edges: spec.edges });
  }
  const groups = Array.isArray(spec.groups) ? spec.groups : [];
  if (!groups.length) fail('board: needs a non-empty groups[] array (or layout: "flow")', 2);
  if (groups.length > BOARD_MAX_GROUPS) {
    fail(`board: groups[] has ${groups.length}, max ${BOARD_MAX_GROUPS}`, 2);
  }
  let totalCards = 0;
  for (const g of groups) {
    const n = Array.isArray(g?.cards) ? g.cards.length : 0;
    if (n > BOARD_MAX_CARDS_PER_GROUP) {
      fail(`board: group "${g?.title ?? '?'}" has ${n} cards, max ${BOARD_MAX_CARDS_PER_GROUP}`, 2);
    }
    totalCards += n;
  }
  if (totalCards > BOARD_MAX_TOTAL_CARDS) {
    fail(`board: ${totalCards} total cards across groups, max ${BOARD_MAX_TOTAL_CARDS}`, 2);
  }
  const ops = layout === 'radial' ? boardRadial(spec, groups) : boardColumns(groups);
  const connections = Array.isArray(spec.connections) ? spec.connections : [];
  if (connections.length > BOARD_MAX_CONNECTIONS) {
    fail(`board: connections[] has ${connections.length}, max ${BOARD_MAX_CONNECTIONS}`, 2);
  }
  for (const c of connections) {
    if (!c || typeof c.from !== 'string' || typeof c.to !== 'string') {
      fail('board: each connections[] entry needs string "from"/"to"', 2);
    }
    ops.push({ op: 'connect', from: c.from, to: c.to, label: c.label });
  }
  return ops;
}

/**
 * --flow and --board emit a relative offset (flowX/flowY, boardX/boardY)
 * instead of absolute x/y, so ONE placement resolution positions the whole
 * diagram/board as a unit.
 */
function applyOriginOffset(ops, origin) {
  return ops.map((op) => {
    const { flowX, flowY, boardX, boardY, ...rest } = op;
    if (flowX !== undefined) return { ...rest, x: origin.x + flowX, y: origin.y + flowY };
    if (boardX !== undefined) return { ...rest, x: origin.x + boardX, y: origin.y + boardY };
    return rest;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Write — the live server's op endpoint, else a direct canonical file write.

/**
 * POST the ops to a live, loopback dev-server. Returns the parsed response,
 * `null` when no server answers or it predates the op route (then the caller
 * writes the file), and fails on any other refusal or a timeout — a file write
 * would bypass the server and its live room.
 */
async function postOps(designRoot, file, ops) {
  const serverJsonPath = join(designRoot, '_server.json');
  if (!existsSync(serverJsonPath)) return null;
  let base = null;
  try {
    const srv = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
    base = typeof srv.url === 'string' ? srv.url.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
  // Security (Wave H F2): only ever POST to a loopback origin — a poisoned
  // `url` can't turn the verb into an exfiltration primitive. Anything else
  // silently falls back to the file write (the local intent still succeeds).
  if (!base || !isLoopbackHttpUrl(base)) return null;
  let res;
  try {
    res = await fetch(`${base}/_api/annotations/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file,
        actionId: `ai-annotate-${Math.random().toString(36).slice(2, 12)}`,
        ops,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // No server answering (a stale _server.json) → the file write is safe.
    // A server that IS there but too slow must not be bypassed: writing the
    // file would reseed its live room from a stale snapshot and erase what
    // collaborators did meanwhile (security review A2).
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      fail('the dev-server did not answer in time — nothing written; try again', 1);
    }
    return null;
  }
  // Only a server too old to have the op route falls back to the file.
  if (res.status === 404 || res.status === 405) return null;
  // Inside a cloud workspace (MAUDE_WORKSPACE_MODE=1) the studio treats a
  // loopback request without the proxy's role header as read-only; the
  // workspace's own file write IS the agent's channel there (the workspace
  // agent syncs it). Anywhere else a read-only refusal stands — a local write
  // the hub refuses to sync is a silent fork.
  if (res.status === 403 && process.env.MAUDE_WORKSPACE_MODE === '1') return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    fail(`the server refused the batch: ${body?.error ?? res.status} — nothing written`, 1);
  }
  return res.json().catch(() => ({ ok: true, rejected: [] }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main

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
  const slug = fileSlug(relPath, designRel);
  // The canvas path the server keys its board by — relative to the design
  // root, whether the caller wrote `ui/X.tsx` or `.design/ui/X.tsx` (the slug
  // above tolerates both; the server must get the same file, or every op is
  // refused as `gone` against a board that doesn't exist).
  const designPrefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  let canvasRel = String(relPath).replace(/^\/+/, '');
  if (canvasRel.startsWith(designPrefix)) canvasRel = canvasRel.slice(designPrefix.length);

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

  const batch = new AiBatch(boardFile.elements);
  const pl = buildPlacement(batch, artboards, elements, {
    near: args.near,
    in: args.in,
    pin: args.pin,
    pointer: args.pointer,
  });

  let ops;
  if (args.flow != null) {
    ops = applyOriginOffset(flowToOps(parseJsonInput(readInput(args.flow), '--flow')), pl.origin);
  } else if (args.board != null) {
    ops = applyOriginOffset(
      boardToOps(parseJsonInput(readInput(args.board), '--board')),
      pl.origin
    );
  } else {
    const payload = parseJsonInput(readInput(args.ops), '--ops');
    ops = Array.isArray(payload?.ops) ? payload.ops : Array.isArray(payload) ? payload : null;
    if (!ops) fail('ops: expected { ops: [...] } (or a bare array)', 2);
  }

  try {
    runOps(batch, pl, ops);
  } catch (err) {
    if (err instanceof AiOpError) fail(err.message, 2);
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
    const res = await postOps(designRoot, `${designRel}/${canvasRel}`, batch.ops);
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
    ...(rejected.length ? { rejected } : {}),
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  if (rejected.length) process.exitCode = 1;
}

await main();
