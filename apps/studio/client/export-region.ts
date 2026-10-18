// client/export-region.ts — S2.13: the Export area's rectangle as it crosses from the (untrusted) canvas iframe to the
// shell's Export sheet. The canvas posts `open-export {detail}`; `detail.region.rect` is world px. Nothing it sends is
// believed: four finite numbers within sane bounds or nothing at all (the sheet then opens as it always did).

export interface ExportRegion {
  rect: { x: number; y: number; w: number; h: number };
}

const COORD = 1_000_000;
const SIZE = 100_000;

/** A clean `{ rect }` from an `open-export` detail, or undefined. */
export function exportRegionOf(detail: unknown): ExportRegion | undefined {
  if (!detail || typeof detail !== 'object') return undefined;
  const region = (detail as Record<string, unknown>).region;
  if (!region || typeof region !== 'object') return undefined;
  const rect = (region as Record<string, unknown>).rect;
  if (!rect || typeof rect !== 'object') return undefined;
  const { x, y, w, h } = rect as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!num(x) || !num(y) || !num(w) || !num(h)) return undefined;
  if (Math.abs(x) > COORD || Math.abs(y) > COORD) return undefined;
  if (w <= 0 || h <= 0 || w > SIZE || h > SIZE) return undefined;
  return { rect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } };
}
