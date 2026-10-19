// S5.18 (G2, 03 `ai-copy`) — what Run on a copy writes into the canvas's `.meta.json` sidecar.
//
// The copy is a new `<DCArtboard>` in the .tsx (canvas-edit.ts `copyArtboard`). The sidecar is what the rest of the
// shell reads about an artboard that is NOT in the JSX: its NAME (the scope chip, "Choose artboards…", the chat
// list's where line read `sections[].artboards[]` / `artboards[]`) and — when the canvas has explicit
// `layout.artboards[]` positions — WHERE it sits. Without an entry the chip shows the copy's id, and with explicit
// positions elsewhere the copy fell on the default-grid cell of its JSX index: on top of the next artboard.
//
// Pure: `metaWithCopy(meta, …)` returns the next meta, or null when nothing needs writing (idempotent: the copy's
// entries already there, or the sidecar lists nothing the copy could join). The route writes it through the same
// door a layout write uses (`api.writeCanvasMetaText`: hooks + cell announce). Versioned-file safe: only entries of
// the shapes v1 already reads are added, no new field.

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

// Mirrors VP_GRID + synthDefaultGrid in canvas-lib.tsx (and bin/_canvas-rects-static.mjs, the headless mirror).
const VP_GRID = { cols: 3, w: 1280, h: 820, gutter: 80 };

interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function attr(tag: string, name: string): string | null {
  const s = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  if (s) return s[1] ?? null;
  const e = tag.match(new RegExp(`\\b${name}\\s*=\\s*\\{\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\}`));
  return e ? (e[1] ?? null) : null;
}

/** Every artboard's rect as the canvas draws it: the default grid in JSX order, `layout.artboards[]` over it. */
export function artboardRects(source: string, layout: unknown): Rect[] {
  const seeds: Array<{ id: string; w: number; h: number }> = [];
  const re = /<DCArtboard\b([^>]*)>/g;
  let m = re.exec(source);
  let auto = 0;
  while (m !== null) {
    const tag = m[1] ?? '';
    seeds.push({
      id: attr(tag, 'id') || `__ab_${auto}`,
      w: Number.parseFloat(attr(tag, 'width') ?? '') || VP_GRID.w,
      h: Number.parseFloat(attr(tag, 'height') ?? '') || VP_GRID.h,
    });
    auto += 1;
    m = re.exec(source);
  }
  const cellW = seeds.reduce((mx, s) => Math.max(mx, s.w), 0) || VP_GRID.w;
  const cellH = seeds.reduce((mx, s) => Math.max(mx, s.h), 0) || VP_GRID.h;
  const byId = new Map<string, Json>();
  for (const r of Array.isArray(layout) ? layout : []) {
    if (isObj(r) && typeof r.id === 'string') byId.set(r.id, r);
  }
  return seeds.map((s, i) => {
    const d = {
      x: (i % VP_GRID.cols) * (cellW + VP_GRID.gutter),
      y: Math.floor(i / VP_GRID.cols) * (cellH + VP_GRID.gutter),
    };
    const e = byId.get(s.id);
    return {
      id: s.id,
      x: typeof e?.x === 'number' && Number.isFinite(e.x) ? e.x : d.x,
      y: typeof e?.y === 'number' && Number.isFinite(e.y) ? e.y : d.y,
      w: s.w,
      h: s.h,
    };
  });
}

const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * Where the copy goes: right beside the original (03: "lands right beside the original"), else below it, else
 * past the right edge of everything — the first spot clear of every other artboard.
 */
export function placeCopy(
  rects: Rect[],
  copyId: string,
  artboardId: string
): { x: number; y: number } | null {
  const orig = rects.find((r) => r.id === artboardId);
  const me = rects.find((r) => r.id === copyId);
  if (!orig || !me) return null;
  const others = rects.filter((r) => r.id !== copyId);
  const gap = VP_GRID.gutter;
  const right = Math.max(...others.map((r) => r.x + r.w));
  const candidates = [
    { x: orig.x + orig.w + gap, y: orig.y },
    { x: orig.x, y: orig.y + orig.h + gap },
    { x: right + gap, y: orig.y },
  ];
  for (const c of candidates) {
    const box = { ...me, ...c };
    if (!others.some((o) => overlaps(box, o, 8))) return c;
  }
  return candidates[2] ?? null;
}

/**
 * S5.19 (G2) — BESIDE the original, always (03: "lands right beside the original"). When the slot on the right is
 * taken, the artboards to the right of the original in the same row band move over by the copy's width + a
 * gutter (their new places go into the same sidecar write, so the copy's Undo puts them back with it). Falls
 * back to `placeCopy` (below / past the right edge) only when shifting the row would itself overlap something.
 */
export function placeBeside(
  rects: Rect[],
  copyId: string,
  artboardId: string
): { at: { x: number; y: number }; shifts: Array<{ id: string; x: number; y: number }> } | null {
  const orig = rects.find((r) => r.id === artboardId);
  const me = rects.find((r) => r.id === copyId);
  if (!orig || !me) return null;
  const others = rects.filter((r) => r.id !== copyId);
  const gap = VP_GRID.gutter;
  const at = { x: orig.x + orig.w + gap, y: orig.y };
  const box = { ...me, ...at };
  if (!others.some((o) => overlaps(box, o, 8))) return { at, shifts: [] };
  const dx = me.w + gap;
  const band = { ...me, x: orig.x, y: orig.y };
  const movers = others.filter(
    (o) => o.id !== orig.id && o.x >= orig.x + orig.w - 1 && overlaps(o, band)
  );
  const moved = new Map(movers.map((o) => [o.id, { ...o, x: o.x + dx }]));
  const after = others.map((o) => moved.get(o.id) ?? o);
  if (after.some((o) => overlaps(box, o, 8))) return null;
  for (const m of moved.values())
    if (after.some((o) => o.id !== m.id && overlaps(m, o))) return null;
  return {
    at,
    shifts: movers.map((o) => ({ id: o.id, x: o.x + dx, y: o.y })),
  };
}

/** The label the copy's `<DCArtboard>` carries in `source`, or null. */
export function copyLabelOf(source: string, copyId: string): string | null {
  const re = /<DCArtboard\b([^>]*)>/g;
  let m = re.exec(source);
  while (m !== null) {
    const tag = m[1] ?? '';
    if (attr(tag, 'id') === copyId) return attr(tag, 'label');
    m = re.exec(source);
  }
  return null;
}

/** The list (a section's `artboards`, else the top-level one) that names `artboardId`, with its entry's index. */
function listOf(meta: Json, artboardId: string): { list: Json[]; at: number } | null {
  const lists: unknown[] = [];
  if (Array.isArray(meta.sections))
    for (const s of meta.sections)
      if (isObj(s) && Array.isArray(s.artboards)) lists.push(s.artboards);
  if (Array.isArray(meta.artboards)) lists.push(meta.artboards);
  for (const l of lists) {
    const list = l as Json[];
    const at = list.findIndex((e) => isObj(e) && e.id === artboardId);
    if (at >= 0) return { list, at };
  }
  return null;
}

/**
 * The sidecar with the copy in it. `source` is the canvas .tsx AFTER the copy landed. Returns null when there is
 * nothing to add (the copy is already listed/placed and the sidecar names nothing for it to join).
 */
export function metaWithCopy(
  meta: Json,
  o: { source: string; artboardId: string; copyId: string; label: string }
): Json | null {
  const next = structuredClone(meta) as Json;
  let changed = false;

  // 1. its name, beside the original's entry (same list, same shape, minus the original's note)
  const home = listOf(next, o.artboardId);
  if (home && !home.list.some((e) => isObj(e) && e.id === o.copyId)) {
    const { note: _note, ...rest } = home.list[home.at] as Json;
    home.list.splice(home.at + 1, 0, { ...rest, id: o.copyId, label: o.label });
    changed = true;
  }

  // 2. its place, only when the canvas has explicit positions (otherwise the default grid already seats it
  //    beside the original, in JSX order)
  const layout = isObj(next.layout) ? next.layout : null;
  const placed = layout && Array.isArray(layout.artboards) ? (layout.artboards as Json[]) : null;
  if (placed && placed.length > 0 && !placed.some((e) => isObj(e) && e.id === o.copyId)) {
    const rects = artboardRects(o.source, placed);
    const beside = placeBeside(rects, o.copyId, o.artboardId);
    const at = beside?.at ?? placeCopy(rects, o.copyId, o.artboardId);
    if (at) {
      for (const sh of beside?.shifts ?? []) {
        const e = placed.find((p) => isObj(p) && p.id === sh.id);
        if (e) e.x = sh.x;
        else placed.push({ id: sh.id, x: sh.x, y: sh.y });
      }
      placed.push({ id: o.copyId, x: at.x, y: at.y });
      changed = true;
    }
  }
  return changed ? next : null;
}
