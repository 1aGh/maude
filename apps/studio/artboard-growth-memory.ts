/**
 * @file       artboard-growth-memory.ts — V2-8.5 c7 (08 ak-web-hug).
 * @scope      apps/studio/artboard-growth-memory.ts
 * @purpose    A section added to a page is written into the canvas file, and a file change reloads the canvas frame:
 *             whatever the page's height was a moment ago lives only in the OLD frame's memory. So the last height of
 *             each hugging page, and a fingerprint of its sections, are kept in this frame's sessionStorage — the new
 *             load compares with them and can say "+ 373 px" and name the section that arrived. Per canvas address and
 *             artboard id; a blocked or unreadable store is "nothing remembered" (the first look is the baseline).
 */

export interface GrowthMemory {
  /** the page's height when it was last measured */
  h: number;
  /** a fingerprint per section (`sectionSigs`) */
  sigs: string[];
}

const key = (id: string): string =>
  typeof location === 'undefined' ? '' : `dc-grow:${location.pathname}${location.search}#${id}`;

export function readGrowthMemory(id: string | undefined): GrowthMemory | null {
  try {
    if (!id || !key(id) || typeof sessionStorage === 'undefined') return null;
    const o = JSON.parse(sessionStorage.getItem(key(id)) || 'null');
    if (!o || !Number.isFinite(o.h) || !Array.isArray(o.sigs)) return null;
    return { h: Number(o.h), sigs: o.sigs.filter((s: unknown) => typeof s === 'string').slice(0, 200) };
  } catch {
    return null;
  }
}

export function writeGrowthMemory(id: string | undefined, patch: Partial<GrowthMemory>): void {
  try {
    if (!id || !key(id) || typeof sessionStorage === 'undefined') return;
    const cur = readGrowthMemory(id) ?? { h: 0, sigs: [] };
    sessionStorage.setItem(key(id), JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* storage blocked: the first look of the next load is the baseline */
  }
}

/** A section's fingerprint: its tag and its first words, numbered when two look alike. */
export function sectionSigs(
  kids: ReadonlyArray<{ tagName: string; textContent: string | null }>
): string[] {
  const seen = new Map<string, number>();
  return kids.map((k) => {
    const base = `${k.tagName.toLowerCase()}|${(k.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}#${n}`;
  });
}
