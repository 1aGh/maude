/**
 * @file       annotations/board-ops.ts — `--flow` / `--board` specs → create/connect ops
 * @scope      apps/studio/annotations/board-ops.ts
 * @purpose    The layout engine behind `maude design annotate --flow | --board` and the Templates
 *             panel: a typed spec (`{ nodes, edges }`, or `{ groups, layout, connections }`) expands
 *             into the ordered create / connect ops the AI write engine (ai-write.ts) applies. Lifted
 *             out of `bin/annotate.mjs` (S4.5) so the client (S4.13) and the verb expand the SAME spec
 *             through the SAME code (rule 14); the verb's output is byte-identical to before.
 *
 *             Pure: no I/O, no process exit. A bad spec throws `BoardSpecError` (the verb prints
 *             `annotate: <message>` and exits 2, as it always did).
 */

export class BoardSpecError extends Error {}

/** One expanded op: the verb's op vocabulary, plus the relative `flowX/flowY` / `boardX/boardY` offsets. */
export type BoardOp = Record<string, unknown>;

interface FlowNode {
  id: string;
  label?: unknown;
  shape?: unknown;
}
interface FlowEdge {
  from: string;
  to: string;
  label?: unknown;
}
interface Card {
  text?: unknown;
  color?: unknown;
}
interface Group {
  title?: unknown;
  color?: unknown;
  /** A named column tone ({@link SECTION_TONES}); an explicit `color` wins over it. */
  tone?: unknown;
  cards?: unknown;
}

// Flow-node look — the blue ink + paired tint read on light AND dark canvases
// (the verb cannot know the viewer's theme).
export const NODE_INK = '#3b82f6';
export const NODE_FILL = '#e0ebfd';
export const NODE_W = 180;
export const NODE_H = 80;
export const FLOW_GAP_X = 100;
export const FLOW_GAP_Y = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Flow mode — layered left→right layout of nodes + bound connector edges.

// Shared by --flow and --board layout:"flow" (which delegates to flowToOps) —
// checked once, in flowToOps, so neither caller can bypass it. A relationship
// array (edges) manufactures ops just as surely as an entity array does.
const FLOW_MAX_NODES = 200;
const FLOW_MAX_EDGES = 400;

export function flowToOps(flow: { nodes?: unknown; edges?: unknown }): BoardOp[] {
  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as FlowNode[];
  const edges = (Array.isArray(flow.edges) ? flow.edges : []) as FlowEdge[];
  if (!nodes.length) throw new BoardSpecError('flow: needs at least one node');
  if (nodes.length > FLOW_MAX_NODES) {
    throw new BoardSpecError(`flow: nodes[] has ${nodes.length}, max ${FLOW_MAX_NODES}`);
  }
  if (edges.length > FLOW_MAX_EDGES) {
    throw new BoardSpecError(`flow: edges[] has ${edges.length}, max ${FLOW_MAX_EDGES}`);
  }
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) {
      throw new BoardSpecError(`flow: edge references unknown node (${e.from} → ${e.to})`);
    }
  }
  // Longest-path layering via Kahn; cycle leftovers keep their seeded layer.
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    (adj.get(e.from) as string[]).push(e.to);
    indeg.set(e.to, (indeg.get(e.to) as number) + 1);
  }
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift() as string;
    for (const t of adj.get(id) as string[]) {
      layer.set(t, Math.max(layer.get(t) as number, (layer.get(id) as number) + 1));
      indeg.set(t, (indeg.get(t) as number) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) as number;
    if (!byLayer.has(l)) byLayer.set(l, []);
    (byLayer.get(l) as string[]).push(id);
  }
  const ops: BoardOp[] = [];
  for (const [l, list] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((id, i) => {
      const node = nodes.find((n) => n.id === id) as FlowNode;
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

function cardText(card: unknown): string {
  if (typeof card === 'string') return card;
  const t = (card as Card | null | undefined)?.text;
  return typeof t === 'string' ? t : '';
}

function cardColor(card: unknown): string | undefined {
  const c = card && typeof card === 'object' ? (card as Card).color : undefined;
  return typeof c === 'string' ? c : undefined;
}

/**
 * Column tones — the names canvas 15 draws a section in (`.an-sec--<tone>`), as the hex a section
 * stores. `grey` is the section default, so a grey column reads like an untoned one.
 */
export const SECTION_TONES = Object.freeze({
  grey: '#8b8b94',
  yellow: '#e0b92e',
  green: '#4caf72',
  coral: '#e57b66',
  sky: '#4f9fd8',
  lilac: '#9b7fd1',
}) as Readonly<Record<string, string>>;

/** The order the default ramp walks the tones in: a progress board reads grey → yellow → green. */
const TONE_RAMP = ['grey', 'yellow', 'green', 'sky', 'lilac', 'coral'];

/** A group's section colour: its explicit hex, else its named tone, else none (the model default). */
function groupColor(g: Group): string | undefined {
  if (typeof g.color === 'string') return g.color;
  if (g.tone === undefined || g.tone === null) return undefined;
  const hex = typeof g.tone === 'string' ? SECTION_TONES[g.tone] : undefined;
  if (!hex) {
    throw new BoardSpecError(
      `board: unknown tone ${JSON.stringify(g.tone)} (one of ${Object.keys(SECTION_TONES).join(', ')})`
    );
  }
  return hex;
}

/**
 * A hand-written column board that names no colour or tone anywhere gets a tone per column (the
 * canvas draws a plan grey / yellow / green) — the verb applies it to agent-composed JSON only. A
 * starter template is not passed through here: it carries no colours, so the panel and the verb
 * keep expanding the very same board.
 */
export function withDefaultTones(spec: Record<string, unknown>): Record<string, unknown> {
  const groups = Array.isArray(spec.groups) ? (spec.groups as Group[]) : null;
  if (!groups || groups.length < 2 || spec.layout === 'radial' || spec.layout === 'flow')
    return spec;
  if (groups.some((g) => !g || typeof g !== 'object' || g.color != null || g.tone != null))
    return spec;
  // Three or fewer: first grey, last green, a yellow between; more walks the ramp in order.
  const tones =
    groups.length <= 3
      ? groups.map((_, i) => (i === 0 ? 'grey' : i === groups.length - 1 ? 'green' : 'yellow'))
      : groups.map((_, i) => TONE_RAMP[i % TONE_RAMP.length] as string);
  return { ...spec, groups: groups.map((g, i) => ({ ...g, tone: tones[i] })) };
}

const cardsOf = (g: Group | null | undefined): unknown[] =>
  Array.isArray(g?.cards) ? (g?.cards as unknown[]) : [];

/**
 * "columns" — one titled section per group, its cards stacked INSIDE it (they
 * are the section's children). Each section's height grows with its own card
 * count, so a half-filled board never collides with its neighbour.
 */
function boardColumns(groups: Group[]): BoardOp[] {
  const ops: BoardOp[] = [];
  groups.forEach((g, i) => {
    const cards = cardsOf(g);
    const h = cards.length
      ? BOARD_HEADER_H + cards.length * (BOARD_CARD_H + BOARD_CARD_GAP)
      : BOARD_EMPTY_SECTION_H;
    const colX = i * (BOARD_COL_W + BOARD_COL_GAP);
    ops.push({
      op: 'create',
      type: 'section',
      ref: `@sec${i}`,
      text: typeof g.title === 'string' && g.title ? g.title : `Group ${i + 1}`,
      color: groupColor(g),
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
function boardRadial(spec: { title?: unknown }, groups: Group[]): BoardOp[] {
  const cards = groups.flatMap((g) => cardsOf(g));
  const pad = BOARD_RADIAL_RADIUS + Math.max(BOARD_RADIAL_CARD_W, BOARD_RADIAL_CARD_H);
  const ops: BoardOp[] = [
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

export function boardToOps(spec: Record<string, unknown>): BoardOp[] {
  const layout = typeof spec.layout === 'string' ? spec.layout : 'columns';
  if (layout === 'flow') {
    if (!Array.isArray(spec.nodes) || !spec.nodes.length) {
      throw new BoardSpecError('board: layout "flow" needs a nodes[] array');
    }
    return flowToOps({ nodes: spec.nodes, edges: spec.edges });
  }
  const groups = (Array.isArray(spec.groups) ? spec.groups : []) as Group[];
  if (!groups.length)
    throw new BoardSpecError('board: needs a non-empty groups[] array (or layout: "flow")');
  if (groups.length > BOARD_MAX_GROUPS) {
    throw new BoardSpecError(`board: groups[] has ${groups.length}, max ${BOARD_MAX_GROUPS}`);
  }
  let totalCards = 0;
  for (const g of groups) {
    const n = cardsOf(g).length;
    if (n > BOARD_MAX_CARDS_PER_GROUP) {
      throw new BoardSpecError(
        `board: group "${g?.title ?? '?'}" has ${n} cards, max ${BOARD_MAX_CARDS_PER_GROUP}`
      );
    }
    totalCards += n;
  }
  if (totalCards > BOARD_MAX_TOTAL_CARDS) {
    throw new BoardSpecError(
      `board: ${totalCards} total cards across groups, max ${BOARD_MAX_TOTAL_CARDS}`
    );
  }
  const ops = layout === 'radial' ? boardRadial(spec, groups) : boardColumns(groups);
  const connections = (Array.isArray(spec.connections) ? spec.connections : []) as Array<{
    from?: unknown;
    to?: unknown;
    label?: unknown;
  } | null>;
  if (connections.length > BOARD_MAX_CONNECTIONS) {
    throw new BoardSpecError(
      `board: connections[] has ${connections.length}, max ${BOARD_MAX_CONNECTIONS}`
    );
  }
  for (const c of connections) {
    if (!c || typeof c.from !== 'string' || typeof c.to !== 'string') {
      throw new BoardSpecError('board: each connections[] entry needs string "from"/"to"');
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
export function applyOriginOffset(ops: BoardOp[], origin: { x: number; y: number }): BoardOp[] {
  return ops.map((op) => {
    const { flowX, flowY, boardX, boardY, ...rest } = op as {
      flowX?: number;
      flowY?: number;
      boardX?: number;
      boardY?: number;
    } & BoardOp;
    if (flowX !== undefined) return { ...rest, x: origin.x + flowX, y: origin.y + (flowY ?? 0) };
    if (boardX !== undefined) return { ...rest, x: origin.x + boardX, y: origin.y + (boardY ?? 0) };
    return rest;
  });
}
