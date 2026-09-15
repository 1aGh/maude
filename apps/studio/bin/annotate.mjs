#!/usr/bin/env bun
// annotate.mjs — the AI annotation WRITE verb (FigJam v3).
//
// `read-annotations` made the annotation layer machine-READABLE; this verb
// closes the loop: an AI agent (or any tool) creates stickies, labelled
// shapes, BOUND connectors, groups — or a whole auto-laid-out flow diagram —
// through a typed ops vocabulary (never raw SVG). Everything renders through
// the CANONICAL serializer (`annotations-model.ts` — the same code the canvas
// uses) and passes the same allowlist sanitizer before a byte is written, so
// the verb can never emit a shape the canvas wouldn't.
//
// Runs under Bun (the .sh wrapper enforces it) because the model is TS.
//
// Write path: when `<designRoot>/_server.json` points at a live dev-server the
// merged SVG goes through `PUT /_api/annotations` — the server sanitizes,
// persists, and broadcasts through the collab bridge so every open canvas
// updates in real time. With no server, the file is written directly (already
// sanitized). Either way the result is LWW over the whole SVG — the same
// trade-off the canvas itself has (documented; agents should read-then-write).
//
// Every created stroke is stamped `data-author="ai"` (provenance) and the
// verb prints a ref → id map so a follow-up call can target what it made.
// AI writes never enter any user's local undo stack (they arrive over the
// sync channel, not through the canvas's commitStrokes).
//
// Reached via `maude design annotate` (DDR-062), never a raw bin path.
//
// Usage:
//   maude design annotate <rel-path> [--ops <file|->] [--flow <file|->]
//                         [--near <artboardId>] [--canvas-state <path>]
//                         [--root <repo>] [--dry-run]
//
// Ops JSON (--ops / stdin):
//   { "ops": [
//     { "op": "create", "type": "sticky", "ref": "@a", "text": "…",
//       "x"?, "y"?, "w"?, "h"?, "color"? },
//     { "op": "create", "type": "text", "text": "…", "x"?, "y"?, "fontSize"? },
//     { "op": "create", "type": "shape", "shape": "rect|rounded|ellipse|diamond|triangle|triangle-down",
//       "ref"?, "label"?, "x"?, "y"?, "w"?, "h"?, "color"?, "fill"? },
//     { "op": "create", "type": "arrow", "x1", "y1", "x2", "y2" },
//     { "op": "connect", "from": "<id|@ref>", "to": "<id|@ref>", "label"? },
//     { "op": "group", "ids": ["<id|@ref>", …] },
//     { "op": "delete", "id": "<id>" }
//   ] }
//
// Flow JSON (--flow): { "nodes": [{ "id", "label", "shape"? }],
//                       "edges": [{ "from", "to", "label"? }] }
// Nodes are auto-laid-out left→right by dependency layer and connected with
// BOUND arrows, so `read-annotations --graph` reads the diagram back as the
// same graph.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { anchorPoint, facingAnchor } from '../annotations-bindings.ts';
import {
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_SECTION_COLOR,
  DEFAULT_STICKY_COLOR,
  gid,
  rid,
  SECTION_DEFAULT_H,
  SECTION_DEFAULT_W,
  STICKY_CORNER_RADIUS,
  STICKY_DEFAULT_H,
  STICKY_DEFAULT_W,
  sanitizeAnnotationSvg,
  strokeToSvgEl,
  svgToStrokes,
} from '../annotations-model.ts';
import {
  fileSlug,
  findElementById,
  loadArtboards,
  loadElements,
  parseAnnotations,
  resolveDesignRoot,
} from './read-annotations.mjs';

// Mirrors MAX_ANNOTATIONS_BYTES (sync/codec.ts) — kept literal here so the bin
// stays import-light; the server enforces the same cap on the PUT path anyway.
const MAX_ANNOTATIONS_BYTES = 1024 * 1024;

const SVG_HEADER = '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1">';

// Flow-node visual defaults — the blue ink + paired tint read on light AND
// dark canvases (the verb cannot know the viewer's theme).
const NODE_INK = '#3b82f6';
const NODE_FILL = '#e0ebfd';
const TEXT_INK = '#1a1a1a';
const NODE_W = 180;
const NODE_H = 80;
const FLOW_GAP_X = 100;
const FLOW_GAP_Y = 60;

const HELP = `annotate.mjs — AI annotation WRITE verb (DDR-062 via \`maude design annotate\`)

Usage:
  maude design annotate <rel-path> [--ops <file|->] [--flow <file|->]
                        [--board <file|->]
                        [--near <artboardId>] [--in <artboardId>]
                        [--pin <cdId|selector>] [--no-pointer]
                        [--canvas-state <path>] [--rects <path>]
                        [--root <repo>] [--dry-run]

Args:
  <rel-path>          Canvas path relative to the design root (e.g. "ui/Foo.tsx").
  --ops <file|->      Ops JSON ({ ops: [...] }); "-" or omitted = stdin.
  --flow <file|->     Flow JSON ({ nodes, edges }) — auto-laid-out diagram of
                      bound connectors. Mutually exclusive with --ops/--board.
  --board <file|->    Board JSON ({ title?, layout?, groups?, nodes?, edges?,
                      connections? }) — a whole tidy TEMPLATE (retro, kanban,
                      social calendar, roadmap, brainstorm, checklist,
                      user-flow), the "generate a FigJam-style template"
                      surface (feature-whiteboard-ai-toolkit). Named presets
                      are NOT built in here — they're spec fixtures documented
                      in the \`whiteboard\` skill; this is the generic engine:
                        layout: "columns" (default; "grid"/"lanes" alias it) —
                          one titled section per groups[].title, its
                          groups[].cards (string[] or {text,color?}[]) stacked
                          inside as stickies. An empty cards[] still gets a
                          clean, evenly-spaced blank section (a board the team
                          fills in live).
                        layout: "radial" — a central shape/"title" (brainstorm
                          topic) with every group's cards ringed around it.
                        layout: "flow" — needs nodes[]/edges[] instead of
                          groups[]; delegates straight to --flow's auto-layout
                          (a user-flow / flowchart diagram of labelled shapes
                          wired by bound connectors).
                      connections?: [{from,to,label?}] adds bound arrows
                      between refs the expansion minted (@sec<i> per section,
                      @sec<i>card<j> per card, @center/@idea<i> for radial).
                      Mutually exclusive with --ops/--flow.
  --near <artboard>   Place beside this artboard (outside it, to the right).
  --in <artboard>     Place INSIDE this artboard (top-left + a 40px inset).
                      Requires --canvas-state or --rects. Unknown id = error.
  --pin <cdId|sel>    Place beside this ELEMENT (from a --rects manifest) —
                      "drop a note next to the CTA button". Unknown id/selector
                      = error (never a silent mis-place). A created sticky/text
                      also gets a pointer arrow to the element unless
                      --no-pointer or the op sets "pointer": false.
  --canvas-state <p>  Artboard rects JSON (same shape read-annotations takes).
  --rects <p>         A \`maude design canvas-rects\` geometry manifest
                      ({ artboards, elements }) — feature-whiteboard-ai-toolkit.
                      Supplies --pin's element lookup, and --in/--near's
                      artboard lookup when --canvas-state isn't also given.
  --root <repo>       Repo root. Default: $CLAUDE_PROJECT_DIR, then cwd.
  --dry-run           Print the merged SVG to stdout instead of writing.

Per-op overrides: any "create" op may carry its own "in"/"near"/"pin" field
(and "pointer": false) to place just that op differently from the batch
default — the same resolution rules as the CLI flags above.

Ops vocabulary: create (sticky | text | shape | arrow) · connect (bound arrow
between hosts, by id or @ref) · group · delete · move · set-text · set-color.
Created strokes carry data-author="ai" and fresh ids; the verb prints
{ ok, via, file, refs }.

move/set-text/set-color (id-preserving, feature-whiteboard-ai-toolkit):
  { "op": "move", "id": "<id|@ref>", "x": N, "y": N }
  { "op": "set-text", "id": "<id|@ref>", "text": "…" }     (or a section's label)
  { "op": "set-color", "id": "<id|@ref>", "color": "#…" }
Every other attribute on the stroke (fontSize, bold/italic/dashed, rotation,
groupIds, cornerRadius, …) is preserved byte-for-byte — the target is parsed
through the CANONICAL parser and re-serialized through the CANONICAL
serializer, not reconstructed from defaults. Works on a stroke created earlier
in the SAME batch (by @ref) or an existing one from the file. Not every tool
supports every op (arrows/pen have no single position; anchored text has no
independent position; shapes have no single color/text field) — unsupported
combinations fail loud (exit 2) rather than silently no-op or mis-write.
DDR-100 deliberately omitted "update" for LWW honesty — these stay id-
preserving but are still whole-file last-write-wins like every other op.

The write is last-write-wins over the whole SVG — read before you write.`;

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
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--no-pointer') {
      out.pointer = false;
    } else if (flagKey in VALUE_FLAGS) {
      if (eq > 0) {
        out[VALUE_FLAGS[flagKey]] = a.slice(eq + 1);
      } else {
        i += 1;
        out[VALUE_FLAGS[flagKey]] = argv[i];
      }
    } else {
      out.positional.push(a);
    }
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

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wave H F2 — the annotate egress allowlist. The dev-server is loopback-only
 * (DDR-054); a PUT target that is not a loopback http(s) origin is refused so
 * a poisoned `_server.json.url` can't exfiltrate the canvas SVG off-box.
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
// Existing-canvas context — host geometry for binds, placement origin.

/** Fabricate a bbox-shaped rect Stroke for an EXISTING annotation so the
 *  binding helpers (which only read strokeBBox) work against parsed data. */
function fakeHost(ann) {
  return {
    id: ann.id,
    tool: 'rect',
    color: '#000',
    width: 1,
    x: ann.x ?? 0,
    y: ann.y ?? 0,
    w: ann.w ?? 0,
    h: ann.h ?? 0,
  };
}

const BINDABLE_PARSED = new Set(['rect', 'ellipse', 'polygon', 'sticky', 'image']);

// ─────────────────────────────────────────────────────────────────────────────
// Op application

function buildContext(existing, artboards, elements, placement) {
  // Placement origin, priority: --pin (beside the element) > --in (inside the
  // artboard) > --near (beside the artboard, existing behavior) > right of the
  // existing annotation extent > a sane top-left. Unknown --in/--pin targets
  // are a hard error (never a silent mis-place) — --near stays lenient
  // (pre-existing behavior: an unmatched id silently falls through).
  let origin = { x: 100, y: 100 };
  let pinnedEl = null;
  if (placement?.in) {
    const board = artboards.find((r) => r.id === placement.in);
    if (!board) fail(`--in: unknown artboard "${placement.in}"`, 2);
    origin = { x: board.x + 40, y: board.y + 40 };
  } else if (placement?.pin) {
    const el = findElementById(elements, placement.pin);
    if (!el) fail(`--pin: element "${placement.pin}" not found in the --rects manifest`, 2);
    pinnedEl = el;
    origin = { x: el.x + el.w + 40, y: el.y };
  } else {
    const nearBoard = placement?.near ? artboards.find((r) => r.id === placement.near) : null;
    if (nearBoard) {
      origin = { x: nearBoard.x + nearBoard.w + 80, y: nearBoard.y };
    } else if (existing.length) {
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      for (const a of existing) {
        if (a.x == null) continue;
        maxX = Math.max(maxX, a.x + (a.w || 0));
        minY = Math.min(minY, a.y ?? 0);
      }
      if (Number.isFinite(maxX)) origin = { x: maxX + 80, y: Math.max(0, minY) };
    }
  }
  return {
    origin,
    cursor: { ...origin },
    pinnedEl, // element the GLOBAL --pin resolved, or null
    pointer: placement?.pointer !== false, // --no-pointer disables pointer arrows entirely
    artboards, // for per-op "in"/"near" overrides
    elements, // for per-op "pin" overrides
    refs: new Map(), // '@ref' → minted id
    newById: new Map(), // id → new Stroke
    created: [], // Stroke[] in creation order
    groupExisting: [], // { id, groupId } injections into existing elements
    deletes: [], // existing ids to remove
    existingById: new Map(existing.map((a) => [a.id, a])),
    replaces: new Map(), // id -> patched full Stroke (move/set-text/set-color)
    rawSvg: '', // set by main() before applyOps — the pre-batch SVG, for ensureFullStrokes
    fullStrokes: null, // lazy id -> full Stroke cache, populated on first move/set-text/set-color
  };
}

/**
 * Per-op "in"/"near"/"pin" placement override — the same resolution rules as
 * the CLI flags (buildContext, above), scoped to ONE op. Returns null when the
 * op carries none of the three (the caller then falls back to ctx.cursor).
 */
function resolveOpPlacement(ctx, op) {
  if (op.pin) {
    const el = findElementById(ctx.elements, op.pin);
    if (!el) fail(`op.pin: element "${op.pin}" not found in the --rects manifest`, 2);
    return { x: el.x + el.w + 40, y: el.y, pinnedEl: el };
  }
  if (op.in) {
    const board = ctx.artboards.find((r) => r.id === op.in);
    if (!board) fail(`op.in: unknown artboard "${op.in}"`, 2);
    return { x: board.x + 40, y: board.y + 40, pinnedEl: null };
  }
  if (op.near) {
    const board = ctx.artboards.find((r) => r.id === op.near);
    if (!board) fail(`op.near: unknown artboard "${op.near}"`, 2);
    return { x: board.x + board.w + 80, y: board.y, pinnedEl: null };
  }
  return null;
}

function resolveTarget(ctx, idOrRef) {
  if (typeof idOrRef !== 'string' || !idOrRef) return null;
  const id = idOrRef.startsWith('@') ? ctx.refs.get(idOrRef) : idOrRef;
  if (!id) return null;
  const created = ctx.newById.get(id);
  if (created) return { id, stroke: created, isNew: true };
  const existing = ctx.existingById.get(id);
  if (existing && BINDABLE_PARSED.has(existing.tool)) {
    return { id, stroke: fakeHost(existing), isNew: false };
  }
  return null;
}

function mint(ctx, ref) {
  const id = rid();
  if (typeof ref === 'string' && ref.startsWith('@')) ctx.refs.set(ref, id);
  return id;
}

/**
 * Resolves an op's placement, returning { x, y, pinnedEl }. An op-level
 * in/near/pin override takes priority over the batch's ctx.cursor; explicit
 * op.x/op.y always win over either. `pinnedEl` (an op-level pin, or the
 * GLOBAL --pin when the op has no override of its own) is what createSticky/
 * createText use to attach a pointer arrow.
 */
function autoPlace(ctx, w, op) {
  const override = op.in || op.near || op.pin ? resolveOpPlacement(ctx, op) : null;
  if (override) {
    const x = Number.isFinite(op.x) ? op.x : override.x;
    const y = Number.isFinite(op.y) ? op.y : override.y;
    return { x, y, pinnedEl: override.pinnedEl };
  }
  const x = Number.isFinite(op.x) ? op.x : ctx.cursor.x;
  const y = Number.isFinite(op.y) ? op.y : ctx.cursor.y;
  if (!Number.isFinite(op.x)) ctx.cursor.x = x + w + 40;
  return { x, y, pinnedEl: ctx.pinnedEl };
}

function pushCreated(ctx, stroke) {
  ctx.created.push(stroke);
  ctx.newById.set(stroke.id, stroke);
  return stroke;
}

/**
 * A visual pointer from a note to a DOM element (--pin). Not a magnetic BIND
 * (annotate.mjs:18 — binds only host on annotation strokes, DDR-100) — a DOM
 * element isn't part of this SVG, so the arrow is a one-time snapshot
 * computed via the SAME facing-anchor math createConnect uses, against a
 * fabricated rect host built from the element's manifest rect.
 */
function pointerArrowTo(ctx, fromStroke, el) {
  const elHost = { id: `_el_${el.cdId ?? 'x'}`, tool: 'rect', x: el.x, y: el.y, w: el.w, h: el.h };
  const fromCenter = centerOf(fromStroke);
  const toCenter = [el.x + el.w / 2, el.y + el.h / 2];
  const sb = facingAnchor(fromStroke, toCenter[0], toCenter[1]);
  const eb = facingAnchor(elHost, fromCenter[0], fromCenter[1]);
  if (!sb || !eb) return null;
  const p1 = anchorPoint(fromStroke, sb.nx, sb.ny);
  const p2 = anchorPoint(elHost, eb.nx, eb.ny);
  if (!p1 || !p2) return null;
  return pushCreated(ctx, {
    id: rid(),
    tool: 'arrow',
    color: DEFAULT_COLOR,
    width: 3,
    x1: p1[0],
    y1: p1[1],
    x2: p2[0],
    y2: p2[1],
    author: 'ai',
  });
}

function createSticky(ctx, op) {
  const w = Number.isFinite(op.w) ? op.w : STICKY_DEFAULT_W;
  const h = Number.isFinite(op.h) ? op.h : STICKY_DEFAULT_H;
  const { x, y, pinnedEl } = autoPlace(ctx, w, op);
  const stroke = pushCreated(ctx, {
    id: mint(ctx, op.ref),
    tool: 'sticky',
    color: typeof op.color === 'string' ? op.color : DEFAULT_STICKY_COLOR,
    x,
    y,
    w,
    h,
    text: typeof op.text === 'string' ? op.text : '',
    fontSize: Number.isFinite(op.fontSize) ? op.fontSize : DEFAULT_FONT_SIZE,
    cornerRadius: STICKY_CORNER_RADIUS,
    author: 'ai',
  });
  if (pinnedEl && ctx.pointer && op.pointer !== false) pointerArrowTo(ctx, stroke, pinnedEl);
  return stroke;
}

function createSection(ctx, op) {
  const w = Number.isFinite(op.w) ? op.w : SECTION_DEFAULT_W;
  const h = Number.isFinite(op.h) ? op.h : SECTION_DEFAULT_H;
  const { x, y } = autoPlace(ctx, w, op);
  return pushCreated(ctx, {
    id: mint(ctx, op.ref),
    tool: 'section',
    x,
    y,
    w,
    h,
    label: typeof op.label === 'string' && op.label ? op.label : 'Section',
    color: typeof op.color === 'string' ? op.color : DEFAULT_SECTION_COLOR,
    author: 'ai',
  });
}

function createText(ctx, op) {
  const { x, y, pinnedEl } = autoPlace(ctx, 160, op);
  const stroke = pushCreated(ctx, {
    id: mint(ctx, op.ref),
    tool: 'text',
    color: typeof op.color === 'string' ? op.color : TEXT_INK,
    fontSize: Number.isFinite(op.fontSize) ? op.fontSize : DEFAULT_FONT_SIZE,
    text: typeof op.text === 'string' ? op.text : '',
    x,
    y,
    author: 'ai',
  });
  if (pinnedEl && ctx.pointer && op.pointer !== false) pointerArrowTo(ctx, stroke, pinnedEl);
  return stroke;
}

function createShape(ctx, op) {
  const w = Number.isFinite(op.w) ? op.w : NODE_W;
  const h = Number.isFinite(op.h) ? op.h : NODE_H;
  const { x, y } = autoPlace(ctx, w, op);
  const ink = typeof op.color === 'string' ? op.color : NODE_INK;
  const fill = op.fill === null ? null : typeof op.fill === 'string' ? op.fill : NODE_FILL;
  const kind = typeof op.shape === 'string' ? op.shape : 'rounded';
  const id = mint(ctx, op.ref);
  let shape;
  if (kind === 'ellipse' || kind === 'circle') {
    shape = {
      id,
      tool: 'ellipse',
      color: ink,
      width: 3,
      cx: x + w / 2,
      cy: y + h / 2,
      rx: w / 2,
      ry: h / 2,
      fill,
      author: 'ai',
    };
  } else if (kind === 'diamond' || kind === 'triangle' || kind === 'triangle-down') {
    shape = {
      id,
      tool: 'polygon',
      shape: kind,
      color: ink,
      width: 3,
      x,
      y,
      w,
      h,
      fill,
      author: 'ai',
    };
  } else {
    shape = {
      id,
      tool: 'rect',
      color: ink,
      width: 3,
      x,
      y,
      w,
      h,
      fill,
      cornerRadius: kind === 'rect' || kind === 'square' ? 0 : 8,
      author: 'ai',
    };
  }
  pushCreated(ctx, shape);
  if (typeof op.label === 'string' && op.label) {
    // Anchored label — renders centered in the host (the canvas convention).
    // Wave G widened anchored text to every closed shape, polygons included.
    pushCreated(ctx, {
      id: rid(),
      tool: 'text',
      color: TEXT_INK,
      fontSize: DEFAULT_FONT_SIZE,
      text: op.label,
      anchorId: id,
      author: 'ai',
    });
  }
  return shape;
}

function createConnect(ctx, op) {
  const from = resolveTarget(ctx, op.from);
  const to = resolveTarget(ctx, op.to);
  if (!from || !to) {
    fail(
      `connect: unknown ${!from ? `"from" (${op.from})` : `"to" (${op.to})`} — targets must be existing bindable ids or @refs created earlier in the batch`,
      2
    );
  }
  const fromCenter = centerOf(from.stroke);
  const toCenter = centerOf(to.stroke);
  const sb = facingAnchor(from.stroke, toCenter[0], toCenter[1]);
  const eb = facingAnchor(to.stroke, fromCenter[0], fromCenter[1]);
  if (!sb || !eb) fail('connect: could not derive anchors (zero-extent host?)', 2);
  const p1 = anchorPoint(from.stroke, sb.nx, sb.ny);
  const p2 = anchorPoint(to.stroke, eb.nx, eb.ny);
  if (!p1 || !p2) fail('connect: could not derive endpoints', 2);
  const arrow = pushCreated(ctx, {
    id: mint(ctx, op.ref),
    tool: 'arrow',
    color: typeof op.color === 'string' ? op.color : DEFAULT_COLOR,
    width: 3,
    x1: p1[0],
    y1: p1[1],
    x2: p2[0],
    y2: p2[1],
    startBind: { hostId: from.id, nx: sb.nx, ny: sb.ny },
    endBind: { hostId: to.id, nx: eb.nx, ny: eb.ny },
    author: 'ai',
  });
  if (typeof op.label === 'string' && op.label) {
    pushCreated(ctx, {
      id: rid(),
      tool: 'text',
      color: TEXT_INK,
      fontSize: 12,
      text: op.label,
      x: (p1[0] + p2[0]) / 2 + 6,
      y: (p1[1] + p2[1]) / 2 - 18,
      author: 'ai',
    });
  }
  return arrow;
}

function centerOf(stroke) {
  if (stroke.tool === 'ellipse') return [stroke.cx, stroke.cy];
  return [stroke.x + (stroke.w ?? 0) / 2, stroke.y + (stroke.h ?? 0) / 2];
}

function applyGroup(ctx, op) {
  const ids = Array.isArray(op.ids) ? op.ids : [];
  const resolved = [];
  for (const raw of ids) {
    const id = typeof raw === 'string' && raw.startsWith('@') ? ctx.refs.get(raw) : raw;
    if (!id) fail(`group: unknown ref ${raw}`, 2);
    resolved.push(id);
  }
  if (resolved.length < 2) fail('group: needs at least two ids', 2);
  const groupId = gid();
  for (const id of resolved) {
    const created = ctx.newById.get(id);
    if (created) {
      created.groupIds = [...(created.groupIds ?? []), groupId];
    } else if (ctx.existingById.has(id)) {
      ctx.groupExisting.push({ id, groupId });
    } else {
      fail(`group: id not found on canvas: ${id}`, 2);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// move / set-text / set-color — id-preserving mutation (feature-whiteboard-
// ai-toolkit). DDR-100 deliberately omitted "update" for LWW honesty; this is
// the additive answer: parse the FULL existing stroke via the CANONICAL
// parser (svgToStrokes — the same code the canvas itself uses), patch just
// the requested field, and re-serialize through the CANONICAL serializer —
// every other attribute (fontSize, bold/italic/dashed, rotation, groupIds,
// cornerRadius, …) survives untouched. `svgToStrokes` needs a DOMParser,
// which Bun doesn't ship — happy-dom is loaded ONLY when a move/set-text/
// set-color op actually appears in the batch, so the common create-only path
// pays zero cost for it.
//
// Security note (feature-whiteboard-ai-toolkit security review): this reads
// an on-disk .annotations.svg a peer/hub can write (DDR-054) or that landed
// via any git commit — content `sanitizeAnnotationSvg` was designed to gate
// only on WRITE. We now sanitize on READ too before it ever reaches the DOM
// parser. `GlobalRegistrator.register()` is still what we use (happy-dom's
// internals need its full global scaffolding — e.g. querySelector's error
// path reaches through `this.window`, not just a bare `DOMParser` reference,
// so patching `DOMParser` alone leaves the parse broken) — but register()
// itself records every property it overwrote, so we call `unregister()`
// (its documented inverse) IMMEDIATELY after the parse, before control ever
// returns to the batch's later loopback-gated PUT. That closes the window
// this feature's own security review flagged: fetch/Response/Request/URL
// never stay monkey-patched past this one parse.
async function ensureFullStrokes(ctx) {
  if (ctx.fullStrokes) return ctx.fullStrokes;
  let GlobalRegistrator;
  try {
    ({ GlobalRegistrator } = await import('@happy-dom/global-registrator'));
  } catch {
    // Packaging note (feature-whiteboard-ai-toolkit review): apps/studio's
    // package.json is a nested workspace manifest the npm tarball doesn't
    // ship, and unlike every other bin script here this is the first one
    // that needs a real third-party package at runtime — an npm-installed
    // maude may have no node_modules for it. Fail loud with the documented
    // escape hatch rather than an opaque "Cannot find package" stack trace.
    fail(
      'move/set-text/set-color need the happy-dom package, which is not installed — ' +
        "reinstall maude, or use delete + create instead (the vocabulary's existing fallback for full replacement)",
      1
    );
  }
  GlobalRegistrator.register({ settings: { disableJavaScriptEvaluation: true } });
  let strokes;
  try {
    strokes = svgToStrokes(sanitizeAnnotationSvg(ctx.rawSvg));
  } finally {
    await GlobalRegistrator.unregister();
  }
  ctx.fullStrokes = new Map(strokes.map((s) => [s.id, s]));
  return ctx.fullStrokes;
}

/**
 * Resolves an id or "@ref" to the mutable stroke — a just-created stroke in
 * THIS batch (mutated in place, not yet serialized), an EARLIER patch this
 * same batch already queued (checked before the cached original — otherwise
 * a second move/set-text/set-color on the same id would clobber the first
 * patch instead of building on it), or an existing one from the pre-batch SVG.
 */
async function resolveMutable(ctx, idOrRef, verb) {
  const id =
    typeof idOrRef === 'string' && idOrRef.startsWith('@') ? ctx.refs.get(idOrRef) : idOrRef;
  if (!id) fail(`${verb}: unknown ref "${idOrRef}"`, 2);
  const created = ctx.newById.get(id);
  if (created) return { id, stroke: created, isNew: true };
  if (ctx.replaces.has(id)) return { id, stroke: ctx.replaces.get(id), isNew: false };
  const byId = await ensureFullStrokes(ctx);
  const stroke = byId.get(id);
  if (!stroke) fail(`${verb}: unknown id "${id}"`, 2);
  return { id, stroke, isNew: false };
}

function commitMutation(ctx, target, patched) {
  if (target.isNew) Object.assign(target.stroke, patched);
  else ctx.replaces.set(target.id, { ...target.stroke, ...patched });
}

async function applyMove(ctx, op) {
  if (typeof op.id !== 'string' || !op.id) fail('move: missing id', 2);
  if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) fail('move: x/y must be finite numbers', 2);
  const target = await resolveMutable(ctx, op.id, 'move');
  const { stroke } = target;
  if (stroke.tool === 'ellipse') {
    commitMutation(ctx, target, { cx: op.x + stroke.rx, cy: op.y + stroke.ry });
    return;
  }
  if (stroke.tool === 'arrow' || stroke.tool === 'pen') {
    fail(`move: "${stroke.tool}" has no single position (multi-point) — use delete + create`, 2);
  }
  if (stroke.tool === 'text' && stroke.anchorId) {
    fail('move: anchored text derives its position from its host — move the host instead', 2);
  }
  if (stroke.x == null || stroke.y == null) {
    fail(`move: tool "${stroke.tool}" has no movable x/y`, 2);
  }
  commitMutation(ctx, target, { x: op.x, y: op.y });
}

async function applySetText(ctx, op) {
  if (typeof op.id !== 'string' || !op.id) fail('set-text: missing id', 2);
  if (typeof op.text !== 'string') fail('set-text: text must be a string', 2);
  const target = await resolveMutable(ctx, op.id, 'set-text');
  const { stroke } = target;
  const field = 'label' in stroke ? 'label' : 'text' in stroke ? 'text' : null;
  if (!field) fail(`set-text: tool "${stroke.tool}" has no text/label field`, 2);
  commitMutation(ctx, target, { [field]: op.text });
}

async function applySetColor(ctx, op) {
  if (typeof op.id !== 'string' || !op.id) fail('set-color: missing id', 2);
  if (typeof op.color !== 'string' || !op.color)
    fail('set-color: color must be a non-empty string', 2);
  const target = await resolveMutable(ctx, op.id, 'set-color');
  const { stroke } = target;
  if (!('color' in stroke)) {
    fail(`set-color: tool "${stroke.tool}" has no single color field — use delete + create`, 2);
  }
  commitMutation(ctx, target, { color: op.color });
}

/** Splice a re-serialized stroke into the SAME position the original element
 *  occupied — preserves document order/z, unlike delete-then-append. Mirrors
 *  deleteElement's g-wrapped-vs-flat matching. */
function replaceElement(svg, id, replacement) {
  const idEsc = escapeRe(id);
  const gOrTextRe = new RegExp(`<(g|text)\\b[^>]*data-id="${idEsc}"[^>]*>[\\s\\S]*?</\\1>`);
  if (gOrTextRe.test(svg)) return svg.replace(gOrTextRe, replacement);
  const flatRe = new RegExp(
    `<(?:path|rect|ellipse|polygon|image)\\b[^>]*data-id="${idEsc}"[^>]*/>`
  );
  if (flatRe.test(svg)) return svg.replace(flatRe, replacement);
  return null;
}

async function applyOps(ctx, ops) {
  for (const op of ops) {
    if (!op || typeof op !== 'object') fail('ops: every entry must be an object', 2);
    if (op.op === 'create') {
      if (op.type === 'sticky') createSticky(ctx, op);
      else if (op.type === 'section') createSection(ctx, op);
      else if (op.type === 'text') createText(ctx, op);
      else if (op.type === 'shape') createShape(ctx, op);
      else if (op.type === 'arrow') {
        if ([op.x1, op.y1, op.x2, op.y2].every(Number.isFinite)) {
          pushCreated(ctx, {
            id: mint(ctx, op.ref),
            tool: 'arrow',
            color: typeof op.color === 'string' ? op.color : DEFAULT_COLOR,
            width: 3,
            x1: op.x1,
            y1: op.y1,
            x2: op.x2,
            y2: op.y2,
            author: 'ai',
          });
        } else {
          createConnect(ctx, op); // from/to form
        }
      } else fail(`create: unknown type "${op.type}"`, 2);
    } else if (op.op === 'connect') {
      createConnect(ctx, op);
    } else if (op.op === 'group') {
      applyGroup(ctx, op);
    } else if (op.op === 'delete') {
      if (typeof op.id !== 'string' || !op.id) fail('delete: missing id', 2);
      ctx.deletes.push(op.id);
    } else if (op.op === 'move') {
      await applyMove(ctx, op);
    } else if (op.op === 'set-text') {
      await applySetText(ctx, op);
    } else if (op.op === 'set-color') {
      await applySetColor(ctx, op);
    } else {
      fail(`ops: unknown op "${op.op}"`, 2);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow mode — layered left→right layout of nodes + bound connector edges.

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
        label: typeof node.label === 'string' ? node.label : String(id),
        // Relative to the placement origin — autoPlace sees explicit coords.
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
// Board mode (feature-whiteboard-ai-toolkit) — a typed template spec expands
// into ops the same way --flow does. Named presets (retro / kanban / social-
// calendar / roadmap / brainstorm / checklist / user-flow) are NOT hardcoded
// here — they're spec fixtures documented in the `whiteboard` skill; this is
// just the generic layout engine they share.

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

// Security (feature-whiteboard-ai-toolkit review): --board is arbitrary JSON
// an agent composes; MAX_ANNOTATIONS_BYTES only rejects AFTER the full spec
// is expanded + serialized, so an unbounded groups/cards array could burn
// real CPU/memory before that cap ever fires. Cap generously (well above any
// real retro/kanban/roadmap board) up front instead.
const BOARD_MAX_GROUPS = 20;
const BOARD_MAX_CARDS_PER_GROUP = 50;
const BOARD_MAX_TOTAL_CARDS = 300;
const BOARD_MAX_CONNECTIONS = 400;
// Shared by --flow (top-level) and --board's layout:"flow" (which delegates
// straight to flowToOps) — checked once, in flowToOps itself, so neither
// caller can bypass it. A relationship array (edges) is just as capable of
// manufacturing unbounded connect ops as an entity array (nodes/cards) is —
// createConnect mints a fresh arrow (+ optional label text) stroke per call
// regardless of how few distinct nodes are involved.
const FLOW_MAX_NODES = 200;
const FLOW_MAX_EDGES = 400;

function cardText(card) {
  return typeof card === 'string' ? card : typeof card?.text === 'string' ? card.text : '';
}

function cardColor(card) {
  return typeof card === 'object' && card && typeof card.color === 'string'
    ? card.color
    : undefined;
}

/**
 * "columns" (default; "grid"/"lanes" are v1 aliases of the same engine) — one
 * titled section per group, its cards stacked inside it. Deterministic and
 * non-overlapping: each section's own height grows with its own card count,
 * so an empty column next to a seeded one (a half-filled retro board) never
 * collides with its neighbor.
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
      label: typeof g.title === 'string' && g.title ? g.title : `Group ${i + 1}`,
      color: typeof g.color === 'string' ? g.color : undefined,
      boardX: colX,
      boardY: 0,
      w: BOARD_COL_W,
      h,
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
      });
    });
  });
  return ops;
}

/**
 * "radial" — a central topic shape with idea cards arranged in a ring
 * (brainstorm). Cards flatten across every group's cards in order — a
 * brainstorm spec doesn't need multiple groups, but tolerates them.
 */
function boardRadial(spec, groups) {
  const cards = groups.flatMap((g) => (Array.isArray(g.cards) ? g.cards : []));
  const pad = BOARD_RADIAL_RADIUS + Math.max(BOARD_RADIAL_CARD_W, BOARD_RADIAL_CARD_H);
  const ops = [
    {
      op: 'create',
      type: 'shape',
      shape: 'ellipse',
      ref: '@center',
      label: typeof spec.title === 'string' && spec.title ? spec.title : 'Topic',
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

/**
 * Expand a typed board spec into ops (create + connect), positioned relative
 * to the placement origin via `boardX`/`boardY` — the same convention
 * `flowToOps` uses for `flowX`/`flowY` (applyOriginOffset, below, applies
 * either). `layout: "flow"` delegates straight to `flowToOps` so a user-flow
 * diagram shares ONE auto-layout implementation with plain `--flow`.
 */
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

  // Optional cross-references — "from"/"to" name a ref this expansion minted
  // (section refs are `@sec<i>`, 0-indexed by group order; card refs are
  // `@sec<i>card<j>`; the radial center is `@center`, ideas are `@idea<i>`).
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

// ─────────────────────────────────────────────────────────────────────────────
// SVG assembly — deletes + group injections on the existing string, new
// strokes serialized through the canonical serializer, sanitize, cap.

function deleteElement(svg, id) {
  const idEsc = escapeRe(id);
  let out = svg.replace(
    new RegExp(`<(g|text)\\b[^>]*data-id="${idEsc}"[^>]*>[\\s\\S]*?</\\1>`, 'g'),
    ''
  );
  out = out.replace(
    new RegExp(`<(?:path|rect|ellipse|polygon|image)\\b[^>]*data-id="${idEsc}"[^>]*/>`, 'g'),
    ''
  );
  // Cascade — anchored text hosted by the deleted shape goes with it (the
  // canvas deleteStrokes rule).
  out = out.replace(
    new RegExp(`<text\\b[^>]*data-anchor-id="${idEsc}"[^>]*>[\\s\\S]*?</text>`, 'g'),
    ''
  );
  return out;
}

function injectGroupAttr(svg, id, groupId) {
  const idEsc = escapeRe(id);
  const re = new RegExp(`(<[a-zA-Z]+\\b[^>]*data-id="${idEsc}"[^>]*?)(/?>)`);
  return svg.replace(re, (_whole, head, close) => {
    if (/data-group-ids="/.test(head)) {
      return (
        head.replace(
          /data-group-ids="([^"]*)"/,
          (_m, cur) => `data-group-ids="${cur} ${groupId}"`
        ) + close
      );
    }
    return `${head} data-group-ids="${groupId}"${close}`;
  });
}

/**
 * Shared by --flow and --board: both expansions emit ops with a relative
 * offset field (flowX/flowY, or boardX/boardY) instead of absolute x/y, so
 * ONE placement resolution (--near/--in/--pin/existing-extent, buildContext)
 * positions the whole diagram/board as a unit.
 */
function applyOriginOffset(ops, origin) {
  return ops.map((op) => {
    if ('flowX' in op) return { ...op, x: origin.x + op.flowX, y: origin.y + op.flowY };
    if ('boardX' in op) return { ...op, x: origin.x + op.boardX, y: origin.y + op.boardY };
    return op;
  });
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
  const svgPath = join(designRoot, `${slug}.annotations.svg`);

  let svg = '';
  if (existsSync(svgPath)) {
    try {
      svg = readFileSync(svgPath, 'utf8');
    } catch {
      svg = '';
    }
  }
  // Security (feature-whiteboard-ai-toolkit review): MAX_ANNOTATIONS_BYTES was
  // only ever checked on the MERGED OUTPUT. A file already at/near the cap
  // (peer-written per DDR-054, or git-committed by anyone) would still be
  // read in full and DOM-parsed on every move/set-text/set-color — the exact
  // "pay the cost before the check" pattern this feature's own board-size
  // caps exist to avoid, just via the read path instead of the write path.
  if (Buffer.byteLength(svg, 'utf8') > MAX_ANNOTATIONS_BYTES) {
    fail(`annotations file exceeds ${MAX_ANNOTATIONS_BYTES} bytes on disk — refusing to read`, 2);
  }
  const existing = parseAnnotations(svg);

  let artboards = args.canvasState
    ? loadArtboards(
        isAbsolute(args.canvasState) ? args.canvasState : resolve(process.cwd(), args.canvasState)
      )
    : [];

  // feature-whiteboard-ai-toolkit — --rects supplies element lookups for
  // --pin, and (absent a separate --canvas-state) artboard lookups for
  // --in/--near too: loadArtboards already understands a canvas-rects
  // manifest's { artboards, elements } shape.
  let elements = [];
  if (args.rects) {
    const rectsPath = isAbsolute(args.rects) ? args.rects : resolve(process.cwd(), args.rects);
    elements = loadElements(rectsPath);
    if (!artboards.length) artboards = loadArtboards(rectsPath);
  }

  const ctx = buildContext(existing, artboards, elements, {
    near: args.near,
    in: args.in,
    pin: args.pin,
    pointer: args.pointer,
  });
  ctx.rawSvg = svg;

  let ops;
  if (args.flow != null) {
    const flow = parseJsonInput(readInput(args.flow), '--flow');
    ops = applyOriginOffset(flowToOps(flow), ctx.origin);
  } else if (args.board != null) {
    const spec = parseJsonInput(readInput(args.board), '--board');
    ops = applyOriginOffset(boardToOps(spec), ctx.origin);
  } else {
    const payload = parseJsonInput(readInput(args.ops), '--ops');
    ops = Array.isArray(payload.ops) ? payload.ops : Array.isArray(payload) ? payload : null;
    if (!ops) fail('ops: expected { ops: [...] } (or a bare array)', 2);
  }

  await applyOps(ctx, ops);

  // Assemble. Deletes + group injections + move/set-text/set-color replaces
  // operate on the existing string; new strokes append before </svg> through
  // the canonical serializer.
  let merged = svg && /<svg[\s>]/i.test(svg) ? svg : `${SVG_HEADER}</svg>`;
  for (const id of ctx.deletes) merged = deleteElement(merged, id);
  for (const inj of ctx.groupExisting) merged = injectGroupAttr(merged, inj.id, inj.groupId);
  for (const [id, stroke] of ctx.replaces) {
    const next = replaceElement(merged, id, strokeToSvgEl(stroke));
    if (next === null) fail(`internal: replaced stroke "${id}" vanished before assembly`, 1);
    merged = next;
  }
  if (ctx.created.length) {
    const body = ctx.created.map((s) => strokeToSvgEl(s)).join('');
    const close = merged.lastIndexOf('</svg>');
    if (close < 0) fail('existing annotation file is not a valid SVG', 1);
    merged = merged.slice(0, close) + body + merged.slice(close);
  }
  merged = sanitizeAnnotationSvg(merged);
  const bytes = Buffer.byteLength(merged, 'utf8');
  if (bytes > MAX_ANNOTATIONS_BYTES) {
    fail(`result exceeds the 1 MB annotation cap (${bytes} bytes) — nothing written`, 1);
  }

  if (args.dryRun) {
    process.stdout.write(`${merged}\n`);
    return;
  }

  // Prefer the live server (sanitize + persist + collab broadcast — open
  // canvases update in real time); fall back to a direct file write.
  let via = 'file';
  const serverJsonPath = join(designRoot, '_server.json');
  if (existsSync(serverJsonPath)) {
    try {
      const srv = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
      const base = typeof srv.url === 'string' ? srv.url.replace(/\/+$/, '') : null;
      // Security (Wave H F2): `_server.json` is local dev-server state, but the
      // verb runs in an AGENT loop — only ever PUT to a loopback http(s) origin
      // so a poisoned/foreign `url` can't turn this into an SSRF primitive that
      // exfiltrates the whole canvas SVG to an arbitrary host. On anything else
      // (remote host, file:, javascript:) we silently fall back to the file
      // write — the local intent still succeeds, the egress is denied.
      if (base && isLoopbackHttpUrl(base)) {
        const res = await fetch(`${base}/_api/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          // `base` — the SVG this edit was merged onto, so a peer's strokes
          // that landed meanwhile are merged, not replaced (DDR-241).
          body: JSON.stringify({ file: `${designRel}/${relPath}`, svg: merged, base: svg }),
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) via = 'server';
      }
    } catch {
      /* stale _server.json / server down — fall through to the file write */
    }
  }
  if (via === 'file') {
    writeFileSync(svgPath, merged, 'utf8');
  }

  const refs = {};
  for (const [ref, id] of ctx.refs) refs[ref] = id;
  process.stdout.write(
    `${JSON.stringify({ ok: true, via, file: svgPath, bytes, created: ctx.created.length, deleted: ctx.deletes.length, refs })}\n`
  );
}

function parseJsonInput(raw, what) {
  if (!raw?.trim()) fail(`${what}: empty input`, 2);
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${what}: invalid JSON — ${err?.message ?? err}`, 2);
  }
}

await main();
